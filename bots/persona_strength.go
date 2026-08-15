package bots

import (
	"fmt"
	"runtime"
	"sync"

	"github.com/gameswithout/mahjong/rulesengine"
)

// Style creates matchups; it must not create a persona that is simply the
// correct choice at every table (docs/bot-playing-style-personas.md §9.3).
// The fidelity measurement in persona_fidelity.go answers "is this a style";
// this answers "is it a viable one", which is a different question and needs
// played hands rather than compared decisions.
//
// A persona that cannot stay inside the strength band without losing its
// identity is not a failure to hide — §9.3 says to label it a special
// challenge opponent rather than misrepresent it as equivalent.

// PersonaStrengthReport is one persona's measured results against a table of
// the reference persona.
type PersonaStrengthReport struct {
	RulesVersion   string
	AIVersion      string
	PersonaVersion string
	PersonaID      string
	ReferenceID    string
	Difficulty     Difficulty
	Hands          int
	BaseSeed       uint64

	// ExhaustiveDraws are hands nobody won. They are excluded from the
	// rates below, which are all shares of decided hands, so a persona that
	// merely causes more draws does not read as a persona that loses.
	ExhaustiveDraws int
	DecidedHands    int

	// FirstPlaceRate is the persona's share of decided hands, pooled over
	// all four seat rotations. The neutral expectation is 0.25.
	FirstPlaceRate float64
	// AverageWinningTai is the mean raw Tai of the hands it won — §2.5's
	// "average value of winning hands".
	AverageWinningTai float64
	// DealInRate is how often it was the seat that fed a discard win, as a
	// share of decided hands.
	DealInRate float64
	// AverageTaiPaid is the mean raw Tai of the hand it fed, over the hands
	// where it dealt in. Deal-in rate alone hides the difference between
	// feeding a cheap hand and an expensive one.
	AverageTaiPaid float64
}

// RunPersonaStrength plays hands seeded single hands with persona in one
// seat and the reference persona in the other three, rotating which
// physical seat the persona occupies so no seat's structural position
// biases the result. Both sides run the same difficulty, so the comparison
// isolates style from execution quality.
//
// Placement is measured by who won the hand rather than by settled Jade,
// for the reason PlayCalibrationHand documents: a freshly dealt hand always
// seats East as dealer, so a settlement-based measure would bake East's
// Dealer Tai into the result as a seat-position edge unrelated to policy.
func RunPersonaStrength(persona Persona, difficulty Difficulty, hands int, baseSeed uint64) (PersonaStrengthReport, error) {
	if hands <= 0 {
		return PersonaStrengthReport{}, fmt.Errorf("bots: strength hands must be positive, got %d", hands)
	}
	roster, err := Personas()
	if err != nil {
		return PersonaStrengthReport{}, err
	}
	reference := roster.Default()

	report := PersonaStrengthReport{
		RulesVersion:   RulesVersion,
		AIVersion:      AIVersion,
		PersonaVersion: PersonaVersion,
		PersonaID:      persona.ID,
		ReferenceID:    reference.ID,
		Difficulty:     difficulty,
		Hands:          hands,
		BaseSeed:       baseSeed,
	}

	type handTally struct {
		draw        bool
		won         bool
		winningTai  int
		dealtIn     bool
		taiPaid     int
		err         error
		handIndex   int
		personaSeat rulesengine.Seat
	}

	playHand := func(index int) handTally {
		seed := baseSeed + uint64(index)
		personaSeat := seatOrder[index%len(seatOrder)]
		seats := make(map[rulesengine.Seat]Policy, len(seatOrder))
		for _, seat := range seatOrder {
			seated := reference
			if seat == personaSeat {
				seated = persona
			}
			seats[seat] = NewPersonaPolicy(newDifficultyPolicy(difficulty), seated)
		}
		tally := handTally{handIndex: index, personaSeat: personaSeat}
		result, err := playStrengthHand(seed, seats)
		if err != nil {
			tally.err = err
			return tally
		}
		if result == nil || result.Kind == rulesengine.KindExhaustiveDraw || len(result.Winners) == 0 {
			tally.draw = true
			return tally
		}
		best := 0
		for _, winner := range result.Winners {
			if winner.Score.RawTai > best {
				best = winner.Score.RawTai
			}
			if winner.Seat == personaSeat {
				tally.won = true
				tally.winningTai = winner.Score.RawTai
			}
		}
		// Payer is set only for the discard and rob wins that have a single
		// feeder; a Zimo is paid by everyone and is nobody's deal-in.
		if result.Payer == personaSeat && !tally.won {
			tally.dealtIn = true
			tally.taiPaid = best
		}
		return tally
	}

	workers := runtime.GOMAXPROCS(0)
	if workers > hands {
		workers = hands
	}
	if workers < 1 {
		workers = 1
	}
	jobs := make(chan int)
	results := make(chan handTally, workers*2)
	var group sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		group.Add(1)
		go func() {
			defer group.Done()
			for index := range jobs {
				results <- playHand(index)
			}
		}()
	}
	go func() {
		for index := 0; index < hands; index++ {
			jobs <- index
		}
		close(jobs)
	}()
	go func() {
		group.Wait()
		close(results)
	}()

	var (
		wins, dealIns          int
		winningTaiSum, paidSum int
		firstErr               error
	)
	for tally := range results {
		if tally.err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("hand %d (seed %d): %w", tally.handIndex, baseSeed+uint64(tally.handIndex), tally.err)
			}
			continue
		}
		if tally.draw {
			report.ExhaustiveDraws++
			continue
		}
		report.DecidedHands++
		if tally.won {
			wins++
			winningTaiSum += tally.winningTai
		}
		if tally.dealtIn {
			dealIns++
			paidSum += tally.taiPaid
		}
	}
	if firstErr != nil {
		return report, firstErr
	}
	if report.DecidedHands > 0 {
		report.FirstPlaceRate = float64(wins) / float64(report.DecidedHands)
		report.DealInRate = float64(dealIns) / float64(report.DecidedHands)
	}
	if wins > 0 {
		report.AverageWinningTai = float64(winningTaiSum) / float64(wins)
	}
	if dealIns > 0 {
		report.AverageTaiPaid = float64(paidSum) / float64(dealIns)
	}
	return report, nil
}

// playStrengthHand is PlayCalibrationHand's body, returning the full hand
// result rather than only who finished first. The existing HandOutcome
// keeps just the winning seats, which cannot answer "how much was the hand
// worth" or "who fed it" — both §2.5 metrics this report needs.
func playStrengthHand(seed uint64, seats map[rulesengine.Seat]Policy) (*rulesengine.HandResult, error) {
	engine, err := newCalibrationEngine(seed)
	if err != nil {
		return nil, err
	}
	if err := driveCalibrationHand(engine, seed, seats); err != nil {
		return nil, err
	}
	return engine.Result(), nil
}
