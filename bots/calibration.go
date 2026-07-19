package bots

import (
	"errors"
	"fmt"
	"runtime"
	"sync"
	"time"

	"github.com/gameswithout/mahjong/rulesengine"
)

// PlayCalibrationHand plays exactly one seeded hand to completion, each
// seat driven by its assigned Policy, and reports the settled outcome.
//
// "Finished first" (§11.4) is measured here as who won that single hand
// (Zimo/discard/rob/Heavenly/Eight-Flowers), not multi-hand table points:
// E3.F4 depends only on E3.F2-F3, not the still-unbuilt multi-hand rotation
// orchestration (E2.F6/E2.F7), so a full session isn't available to
// calibrate against. Win-based placement also sidesteps a structural
// confound a Jade-settlement-based measure would carry: rulesengine.Deal
// always seats East as dealer for a freshly dealt hand with no session
// context, so a settlement-based rate would bake in East's Dealer Tai
// bonus (§5.12) as a seat-position edge unrelated to policy strength. Who
// wins is unaffected by how much Jade that win is worth, so this is
// unbiased with respect to physical seat position — the pooled/rotated
// rate RunCalibration reports does not depend on which physical seat holds
// a given hand's "special" policy.
//
// Dealer is always East and continuation 0, matching that same no-session
// convention.
func PlayCalibrationHand(seed uint64, seats map[rulesengine.Seat]Policy) (HandOutcome, error) {
	if len(seats) != len(seatOrder) {
		return HandOutcome{}, fmt.Errorf("bots: calibration requires exactly %d seated policies, got %d", len(seatOrder), len(seats))
	}
	for _, seat := range seatOrder {
		if seats[seat] == nil {
			return HandOutcome{}, fmt.Errorf("bots: calibration seat %s has no policy", seat)
		}
	}
	rng := newSeedSequence(seed)
	dice := [2]uint8{
		uint8(1 + rng.forStep(0)%6),
		uint8(1 + rng.forStep(1)%6),
	}
	deal, err := rulesengine.Deal(seed, dice)
	if err != nil {
		return HandOutcome{}, err
	}
	clockValue := time.Date(2026, 7, 19, 6, 0, 0, 0, time.UTC)
	engine, err := rulesengine.NewTurnEngine(deal, func() time.Time { return clockValue })
	if err != nil {
		return HandOutcome{}, err
	}
	if err := engine.BeginInitialReplacement(); err != nil && !errors.Is(err, rulesengine.ErrHandComplete) {
		return HandOutcome{}, fmt.Errorf("begin initial replacement: %w", err)
	}

	const dealer, prevailingWind, continuation = rulesengine.East, rulesengine.East, 0
	step := uint64(1)
	nextSeed := func() uint64 {
		step++
		return rng.forStep(step)
	}

	const stepBudget = 1500
	for iteration := 0; iteration < stepBudget; iteration++ {
		switch engine.Phase {
		case rulesengine.PhaseHandComplete, rulesengine.PhaseExhaustiveDraw:
			return outcomeFromResult(seed, engine.Result()), nil

		case rulesengine.PhaseOfferPending:
			// Eight Flowers and Heavenly are both wins; §11.3 always
			// declares a legal Win regardless of difficulty.
			offer := engine.Offer()
			if _, err := engine.RespondOffer(engine.Version, offer.Seat, true); err != nil && !errors.Is(err, rulesengine.ErrHandComplete) {
				return HandOutcome{}, fmt.Errorf("respond offer: %w", err)
			}

		case rulesengine.PhaseAwaitingDraw:
			if _, err := engine.Draw(engine.Version); err != nil && !errors.Is(err, rulesengine.ErrHandComplete) {
				return HandOutcome{}, fmt.Errorf("draw: %w", err)
			}

		case rulesengine.PhaseAwaitingDiscard:
			seat := engine.ActiveSeat
			command, err := decideTurnCommand(engine, seats[seat], seat, dealer, prevailingWind, continuation, nextSeed())
			if err != nil {
				return HandOutcome{}, fmt.Errorf("decide turn for %s: %w", seat, err)
			}
			if err := applyPolicyCommand(engine, command); err != nil && !errors.Is(err, rulesengine.ErrHandComplete) {
				return HandOutcome{}, fmt.Errorf("apply turn for %s: %w", seat, err)
			}

		case rulesengine.PhaseClaimWindow:
			window := engine.Claim
			for _, seat := range window.Eligible {
				if _, responded := window.Responses[seat]; responded {
					continue
				}
				command, err := decideClaimCommand(engine, seats[seat], seat, dealer, prevailingWind, continuation, nextSeed(), window)
				if err != nil {
					return HandOutcome{}, fmt.Errorf("decide claim for %s: %w", seat, err)
				}
				if err := applyPolicyCommand(engine, command); err != nil {
					return HandOutcome{}, fmt.Errorf("apply claim for %s: %w", seat, err)
				}
				window = engine.Claim
			}
			if _, err := engine.ResolveClaims(window.StateVersion); err != nil && !errors.Is(err, rulesengine.ErrHandComplete) {
				return HandOutcome{}, fmt.Errorf("resolve claims: %w", err)
			}

		case rulesengine.PhaseRobWindow:
			window := engine.Rob()
			for _, seat := range window.Eligible {
				if _, responded := window.Responses[seat]; responded {
					continue
				}
				// §11.3: always declare a legal Win, at every difficulty.
				win := !engine.IsWinLocked(seat) && rulesengine.DefaultWinValidator(engine.Deal, seat, window.Tile)
				response := rulesengine.RobResponse{Seat: seat, StateVersion: window.StateVersion, Win: win}
				if err := engine.SubmitRobResponse(response); err != nil {
					return HandOutcome{}, fmt.Errorf("submit rob for %s: %w", seat, err)
				}
				window = engine.Rob()
			}
			if _, err := engine.ResolveRob(window.StateVersion); err != nil && !errors.Is(err, rulesengine.ErrHandComplete) {
				return HandOutcome{}, fmt.Errorf("resolve rob: %w", err)
			}

		default:
			return HandOutcome{}, fmt.Errorf("bots: unexpected phase %s during calibration", engine.Phase)
		}
	}
	return HandOutcome{}, fmt.Errorf("%w (seed %d, phase %s)", ErrCalibrationStepBudget, seed, engine.Phase)
}

// ErrCalibrationStepBudget is returned when a calibration hand does not
// reach a terminal phase within the step budget — almost certainly a bug in
// a policy or in this harness, not a legitimately long hand.
var ErrCalibrationStepBudget = errors.New("bots: calibration hand did not terminate within the step budget")

// HandOutcome is the settled result of one calibrated single hand.
type HandOutcome struct {
	Seed    uint64
	Kind    rulesengine.WinKind
	Winners []rulesengine.Seat // empty for an exhaustive draw
}

func outcomeFromResult(seed uint64, result *rulesengine.HandResult) HandOutcome {
	if result == nil || result.Kind == rulesengine.KindExhaustiveDraw || len(result.Winners) == 0 {
		return HandOutcome{Seed: seed, Kind: rulesengine.KindExhaustiveDraw}
	}
	bestTai := result.Winners[0].Score.RawTai
	for _, winner := range result.Winners[1:] {
		if winner.Score.RawTai > bestTai {
			bestTai = winner.Score.RawTai
		}
	}
	winners := make([]rulesengine.Seat, 0, len(result.Winners))
	for _, winner := range result.Winners {
		if winner.Score.RawTai == bestTai {
			winners = append(winners, winner.Seat)
		}
	}
	return HandOutcome{Seed: seed, Kind: result.Kind, Winners: winners}
}

// PairingSpec describes one §11.4 placement-band pairing. Special is the
// difficulty the band is measured against; Others is every other seat's
// difficulty. Special is empty for the Medium mirror match, where every
// seat runs the same difficulty and each seat's own rate is reported
// individually instead of one pooled "special" rate.
type PairingSpec struct {
	Name    string
	Special Difficulty
	Others  Difficulty
}

var (
	PairingEasyVsMedium = PairingSpec{Name: "easy_vs_3_medium", Special: Easy, Others: Medium}
	PairingMediumMirror = PairingSpec{Name: "medium_mirror", Others: Medium}
	PairingHardVsMedium = PairingSpec{Name: "hard_vs_3_medium", Special: Hard, Others: Medium}
)

func newDifficultyPolicy(difficulty Difficulty) Policy {
	switch difficulty {
	case Easy:
		return NewEasyPolicy()
	case Hard:
		return NewHardPolicy()
	default:
		return NewMediumPolicy()
	}
}

// CalibrationReport is the §11.4 "calibration report... per AI version"
// artifact for one pairing's run.
type CalibrationReport struct {
	RulesVersion    string
	AIVersion       string
	Pairing         string
	Hands           int
	ExhaustiveDraws int
	BaseSeed        uint64
	// SeatRates is every physical seat's own first-place rate, always
	// populated (hands where that seat's assigned difficulty won, divided
	// by Hands).
	SeatRates map[rulesengine.Seat]float64
	// SpecialRate is Special's pooled first-place rate across all 4 seat
	// rotations — the figure §11.4's Easy/Hard-vs-Medium bands check. Zero
	// for the mirror pairing (Special == ""), where SeatRates carries the
	// per-seat bands instead.
	SpecialRate float64
}

// RunCalibration runs hands seat-rotated single-hand simulations for
// pairing (§11.4: "10,000 same-seed seat-rotated simulations") and reports
// each seat/difficulty's aggregate first-place rate. For a non-mirror
// pairing, Special rotates through East, South, West, and North in a fixed
// cycle across the run — hands/4 sims per physical seat — so no seat's
// structural position biases the pooled rate; SeatRates then reflects each
// physical seat's win rate regardless of which difficulty it held on a
// given hand, and SpecialRate is the metric §11.4's band actually checks.
// For the mirror pairing (Special == ""), every seat's difficulty is fixed
// for the whole run, so SeatRates directly carries each seat's own band and
// SpecialRate is left zero. Each seat also receives an independent seeded
// style offset (§11.4) derived from (seed, seat) via StyleOffsetSeed, so
// repeated same-difficulty bots across the run are not identical.
//
// Hands are fully independent (each gets its own fresh engine), so this
// runs them concurrently across GOMAXPROCS workers — a serial 10,000-hand
// run with Hard in the mix would otherwise take on the order of hours.
func RunCalibration(pairing PairingSpec, hands int, baseSeed uint64) (CalibrationReport, error) {
	if hands <= 0 {
		return CalibrationReport{}, fmt.Errorf("bots: calibration hands must be positive, got %d", hands)
	}
	report := CalibrationReport{
		RulesVersion: RulesVersion,
		AIVersion:    AIVersion,
		Pairing:      pairing.Name,
		Hands:        hands,
		BaseSeed:     baseSeed,
		SeatRates:    map[rulesengine.Seat]float64{},
	}

	type handResult struct {
		index       int
		outcome     HandOutcome
		specialSeat rulesengine.Seat
		err         error
	}

	playHand := func(index int) handResult {
		seed := baseSeed + uint64(index)
		specialSeat := rulesengine.Seat("")
		if pairing.Special != "" {
			specialSeat = seatOrder[index%len(seatOrder)]
		}
		seats := make(map[rulesengine.Seat]Policy, len(seatOrder))
		for _, seat := range seatOrder {
			difficulty := pairing.Others
			if seat == specialSeat {
				difficulty = pairing.Special
			}
			style, weight := StyleOffsetSeed(seed, seat)
			seats[seat] = NewStyledPolicy(newDifficultyPolicy(difficulty), style, weight)
		}
		outcome, err := PlayCalibrationHand(seed, seats)
		return handResult{index: index, outcome: outcome, specialSeat: specialSeat, err: err}
	}

	workers := runtime.GOMAXPROCS(0)
	if workers > hands {
		workers = hands
	}
	if workers < 1 {
		workers = 1
	}
	jobs := make(chan int)
	results := make(chan handResult, hands)
	var workerGroup sync.WaitGroup
	for w := 0; w < workers; w++ {
		workerGroup.Add(1)
		go func() {
			defer workerGroup.Done()
			for index := range jobs {
				results <- playHand(index)
			}
		}()
	}
	go func() {
		for i := 0; i < hands; i++ {
			jobs <- i
		}
		close(jobs)
	}()
	go func() {
		workerGroup.Wait()
		close(results)
	}()

	seatWins := map[rulesengine.Seat]float64{}
	specialWins := 0.0
	var firstErr error
	for result := range results {
		if result.err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("hand %d (seed %d): %w", result.index, baseSeed+uint64(result.index), result.err)
			}
			continue
		}
		if len(result.outcome.Winners) == 0 {
			report.ExhaustiveDraws++
			continue
		}
		// A tied top score (rare — e.g. multiple rob winners) splits first
		// place across the tied seats instead of crediting all of them, so
		// the credit awarded by one hand never exceeds 1.0 in total.
		share := 1.0 / float64(len(result.outcome.Winners))
		for _, seat := range result.outcome.Winners {
			seatWins[seat] += share
			if seat == result.specialSeat {
				specialWins += share
			}
		}
	}
	if firstErr != nil {
		return report, firstErr
	}

	for _, seat := range seatOrder {
		report.SeatRates[seat] = seatWins[seat] / float64(hands)
	}
	if pairing.Special != "" {
		report.SpecialRate = specialWins / float64(hands)
	}
	return report, nil
}
