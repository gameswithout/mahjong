package bots

import (
	"fmt"

	"github.com/gameswithout/mahjong/rulesengine"
)

// Style fidelity is measured on choices, not on results
// (docs/bot-playing-style-personas.md §2.1 and §9.2): a bot is not a speed
// bot because it happened to win early, it is a speed bot when it
// repeatedly accepts calls and keeps the hand that finishes soonest. Short
// samples of played hands are dominated by deals and draws, so the primary
// evidence that a persona exists at all is how often it decides differently
// from the neutral reference on decisions where its style is even relevant.
//
// This is deliberately not the same thing as §9.3's strength gates, which
// need 10,000 played hands per persona and are a separate tuning pass.
// Nothing here says a persona is well balanced — only that it is real.

// PersonaFidelityReport is one persona's measured departure from the
// reference persona over a seeded sample of decisions.
type PersonaFidelityReport struct {
	RulesVersion   string
	AIVersion      string
	PersonaVersion string
	PersonaID      string
	ReferenceID    string
	Difficulty     Difficulty

	// DiscardSamples counts positions where more than one discard was
	// legal, i.e. where a style could express anything at all.
	DiscardSamples    int
	DiscardDivergence float64

	// Claim opportunities are counted per shape, because a random hand can
	// Chow far more often than it can Pong: pooling them would report the
	// shuffle's shape mix as if it were the persona's preference.
	// Acceptance is the share taken rather than passed — §2.5's call rate,
	// the most legible behavioral metric there is.
	PongOpportunities int
	PongsAccepted     int
	PongAcceptance    float64
	ChowOpportunities int
	ChowsAccepted     int
	ChowAcceptance    float64

	ClaimOpportunities int
	ClaimsAccepted     int
	ClaimAcceptance    float64
	ClaimDivergence    float64

	// StyleRelevantDivergence pools both surfaces — the §9.2 gate figure.
	StyleRelevantDivergence float64
}

// RunPersonaFidelity measures persona against the roster's reference
// persona over samples seeded positions, at a fixed difficulty so the
// comparison isolates style from execution quality.
//
// Both personas answer the identical position from the identical seed, so
// any difference is a difference of preference. Positions come from real
// shuffles rather than hand-built fixtures, so the sample is not biased
// toward shapes a particular persona happens to like.
func RunPersonaFidelity(persona Persona, difficulty Difficulty, samples int, baseSeed uint64) (PersonaFidelityReport, error) {
	if samples <= 0 {
		return PersonaFidelityReport{}, fmt.Errorf("bots: fidelity samples must be positive, got %d", samples)
	}
	roster, err := Personas()
	if err != nil {
		return PersonaFidelityReport{}, err
	}
	reference := roster.Default()

	base := newDifficultyPolicy(difficulty)
	subject := NewPersonaPolicy(base, persona)
	control := NewPersonaPolicy(base, reference)

	report := PersonaFidelityReport{
		RulesVersion:   RulesVersion,
		AIVersion:      AIVersion,
		PersonaVersion: PersonaVersion,
		PersonaID:      persona.ID,
		ReferenceID:    reference.ID,
		Difficulty:     difficulty,
	}
	discardDiffs, claimDiffs := 0, 0

	for index := 0; index < samples; index++ {
		seed := baseSeed + uint64(index)
		obs, err := fidelityObservation(seed)
		if err != nil {
			return PersonaFidelityReport{}, err
		}

		if len(legalDiscards(obs.Hand)) > 1 {
			report.DiscardSamples++
			if subject.DecideDiscard(obs, seed).Action.TileID != control.DecideDiscard(obs, seed).Action.TileID {
				discardDiffs++
			}
		}

		pongOptions, chowOptions, hasPong, hasChow := fidelityClaims(obs)
		if hasPong {
			report.PongOpportunities++
			chosen := subject.DecideClaim(obs, pongOptions, seed).Action.Kind
			if chosen != control.DecideClaim(obs, pongOptions, seed).Action.Kind {
				claimDiffs++
			}
			if chosen == ActionPong || chosen == ActionKong {
				report.PongsAccepted++
			}
		}
		if hasChow {
			report.ChowOpportunities++
			chosen := subject.DecideClaim(obs, chowOptions, seed).Action.Kind
			if chosen != control.DecideClaim(obs, chowOptions, seed).Action.Kind {
				claimDiffs++
			}
			if chosen == ActionChow {
				report.ChowsAccepted++
			}
		}
	}

	report.ClaimOpportunities = report.PongOpportunities + report.ChowOpportunities
	report.ClaimsAccepted = report.PongsAccepted + report.ChowsAccepted
	if report.DiscardSamples > 0 {
		report.DiscardDivergence = float64(discardDiffs) / float64(report.DiscardSamples)
	}
	if report.PongOpportunities > 0 {
		report.PongAcceptance = float64(report.PongsAccepted) / float64(report.PongOpportunities)
	}
	if report.ChowOpportunities > 0 {
		report.ChowAcceptance = float64(report.ChowsAccepted) / float64(report.ChowOpportunities)
	}
	if report.ClaimOpportunities > 0 {
		report.ClaimAcceptance = float64(report.ClaimsAccepted) / float64(report.ClaimOpportunities)
		report.ClaimDivergence = float64(claimDiffs) / float64(report.ClaimOpportunities)
	}
	if total := report.DiscardSamples + report.ClaimOpportunities; total > 0 {
		report.StyleRelevantDivergence = float64(discardDiffs+claimDiffs) / float64(total)
	}
	return report, nil
}

// fidelityObservation builds one mid-hand position from a real shuffle: a
// sixteen-tile concealed hand, an opponent showing enough melds to be worth
// fearing on some seeds, and a wall somewhere between opening and endgame.
// Every tile is drawn from the same shuffle, so no tile appears twice and
// the unseen-copy budget stays honest.
func fidelityObservation(seed uint64) (Observation, error) {
	shuffled, err := rulesengine.ShuffledCatalog(seed)
	if err != nil {
		return Observation{}, err
	}
	available := make([]rulesengine.Tile, 0, len(shuffled))
	for _, item := range shuffled {
		if !item.IsFlower() {
			available = append(available, item)
		}
	}
	hand := append([]rulesengine.Tile(nil), available[:16]...)
	remaining := available[16:]

	// Opponent threat varies with the seed so risk-averse personas have
	// something to react to on some positions and not others.
	melds := int(seed % 4)
	opponents := []OpponentView{
		{Seat: rulesengine.West, HandCount: 16 - 3*melds, Melds: pongsFrom(remaining, melds)},
		{Seat: rulesengine.North, HandCount: 16},
		{Seat: rulesengine.East, HandCount: 16},
	}
	return Observation{
		Seat:              rulesengine.South,
		Dealer:            rulesengine.East,
		PrevailingWind:    rulesengine.East,
		Hand:              hand,
		Opponents:         opponents,
		DrawableRemaining: 20 + int(seed%50),
	}, nil
}

// pongsFrom builds count exposed Pongs out of tiles nobody else is holding,
// scanning for three copies of a type among the leftovers.
func pongsFrom(pool []rulesengine.Tile, count int) []rulesengine.Meld {
	if count == 0 {
		return nil
	}
	byType := map[string][]rulesengine.Tile{}
	order := make([]string, 0, len(structuralTypes))
	for _, item := range pool {
		key := tileTypeKey(item)
		if len(byType[key]) == 0 {
			order = append(order, key)
		}
		byType[key] = append(byType[key], item)
	}
	melds := make([]rulesengine.Meld, 0, count)
	for _, key := range order {
		if len(melds) == count {
			break
		}
		if len(byType[key]) < 3 {
			continue
		}
		melds = append(melds, rulesengine.Meld{
			Type:    rulesengine.MeldPong,
			Tiles:   append([]rulesengine.Tile(nil), byType[key][:3]...),
			Claimed: true,
		})
	}
	return melds
}

// fidelityClaims finds one Pong-offering and one Chow-offering discard for
// this hand, so the claim sample is made of real opportunities rather than
// of positions where every persona is forced to Pass anyway.
//
// The two shapes are sampled separately on purpose. A random sixteen-tile
// hand can Chow far more often than it can Pong, so taking whichever
// opportunity a scan happens to reach first would measure the shuffle
// rather than the persona: a triplet specialist would look like it was
// taking Chows simply because Chows were nearly all it was ever offered.
func fidelityClaims(obs Observation) (pong, chow ClaimOptions, hasPong, hasChow bool) {
	held := map[string]int{}
	for _, item := range obs.Hand {
		held[tileTypeKey(item)]++
	}
	for _, item := range structuralTypes {
		if hasPong && hasChow {
			break
		}
		if held[item.key] >= 4 {
			continue // no fourth copy left to be discarded
		}
		discard := rulesengine.Tile{
			ID:   item.key + "-4",
			Kind: item.kind,
			Rank: item.rank,
			Copy: 4,
		}
		options := buildClaimOptions(obs.Hand, discard, false)
		switch {
		case !hasPong && (options.CanPong || options.CanKong):
			pong, hasPong = options, true
		case !hasChow && len(options.ChowSets) > 0 && !options.CanPong && !options.CanKong:
			chow, hasChow = options, true
		}
	}
	return pong, chow, hasPong, hasChow
}
