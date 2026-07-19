package bots

import (
	mathrand "math/rand"
	"sort"

	"github.com/gameswithout/mahjong/rulesengine"
)

// Style is a seeded per-seat flavor toward Speed, Value, or Caution (§11.4)
// so repeated same-difficulty bots are not identical.
type Style int

const (
	StyleNone Style = iota
	StyleSpeed
	StyleValue
	StyleCaution
)

// MaxStyleOffset is the §11.4 cap: a seat's style may influence at most 5%
// of its discard decisions.
const MaxStyleOffset = 0.05

// styleSeedSalt keeps the style tie-break RNG stream independent of the
// seed the wrapped policy itself consumes, so adding a style never changes
// the base policy's own decision for a given seed.
const styleSeedSalt = 0x5714_5e00_57e1_5eed

// NewStyledPolicy wraps base with a style bias of weight (clamped to
// [0, MaxStyleOffset]). It only ever acts on discard decisions where the
// base policy's own ranking already has a genuine tie: among those tied,
// equally-good candidates it nudges the pick toward style with probability
// weight, instead of the base policy's arbitrary/seeded tie-break. It never
// selects a discard the base policy's own ranking considers worse than its
// chosen tile, so the §11.4 divergence-from-reference bands measured
// elsewhere are unaffected. Claim and self-Kong decisions are left to base
// unchanged — §11.3's style row is about hand-building/value pursuit, which
// surfaces through discard choice.
func NewStyledPolicy(base Policy, style Style, weight float64) Policy {
	if weight < 0 {
		weight = 0
	}
	if weight > MaxStyleOffset {
		weight = MaxStyleOffset
	}
	if style == StyleNone || weight <= 0 {
		return base
	}
	return styledPolicy{base: base, style: style, weight: weight}
}

type styledPolicy struct {
	base   Policy
	style  Style
	weight float64
}

func (p styledPolicy) Difficulty() Difficulty { return p.base.Difficulty() }

func (p styledPolicy) DecideDiscard(obs Observation, seed uint64) Decision {
	decision := p.base.DecideDiscard(obs, seed)
	if decision.Action.Kind != ActionDiscard || decision.Action.TileID == "" {
		return decision
	}
	rng := mathrand.New(mathrand.NewSource(int64(seed ^ styleSeedSalt)))
	if rng.Float64() >= p.weight {
		return decision
	}
	tied := tiedDiscards(rankDiscards(obs.Hand, obs.Melds), decision.Action.TileID)
	if len(tied) < 2 {
		return decision
	}
	if chosen := styleChoice(p.style, obs, tied); chosen != "" {
		decision.Action.TileID = chosen
	}
	return decision
}

func (p styledPolicy) DecideClaim(obs Observation, options ClaimOptions, seed uint64) Decision {
	return p.base.DecideClaim(obs, options, seed)
}

func (p styledPolicy) DecideSelfKong(obs Observation, options []SelfKongOption, seed uint64) Decision {
	return p.base.DecideSelfKong(obs, options, seed)
}

// tiedDiscards returns every hand tile in the same (effective, connectivity)
// tier as tileID, or nil if tileID is not found or ties with nothing else.
func tiedDiscards(ranked []discardCandidate, tileID string) []rulesengine.Tile {
	target := -1
	for index, candidate := range ranked {
		if candidate.tile.ID == tileID {
			target = index
			break
		}
	}
	if target == -1 {
		return nil
	}
	anchor := ranked[target]
	tied := make([]rulesengine.Tile, 0, 2)
	for _, candidate := range ranked {
		if candidate.effective == anchor.effective && candidate.connectivity == anchor.connectivity {
			tied = append(tied, candidate.tile)
		}
	}
	return tied
}

// styleChoice picks among tied (already equally-ranked on the base policy's
// own efficiency/connectivity signal) according to style. Speed spends no
// extra deliberation on the tie and takes the lexicographically first
// candidate; Value keeps the most structurally promising remaining hand;
// Caution discards whichever tied tile is least dangerous to opponents.
func styleChoice(style Style, obs Observation, tied []rulesengine.Tile) string {
	switch style {
	case StyleValue:
		bestID, bestValue := "", -1.0
		for _, candidate := range tied {
			remaining := withoutTile(obs.Hand, candidate.ID)
			value := potentialValueProxy(remaining, obs.Melds)
			if bestID == "" || value > bestValue {
				bestID, bestValue = candidate.ID, value
			}
		}
		return bestID
	case StyleCaution:
		budget := unseenBudget(VisibleCounts(obs))
		bestID, bestRisk := "", -1.0
		for _, candidate := range tied {
			risk := discardRisk(candidate, obs, budget, nil)
			if bestID == "" || risk < bestRisk {
				bestID, bestRisk = candidate.ID, risk
			}
		}
		return bestID
	default: // StyleSpeed and any other value: no extra deliberation.
		sorted := append([]rulesengine.Tile(nil), tied...)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i].ID < sorted[j].ID })
		return sorted[0].ID
	}
}

// StyleOffsetSeed derives a deterministic style+weight for one seat from a
// hand seed, so a calibration run's "seeded style offset" (§11.4) is
// reproducible from (seed, seat) alone without any extra state.
func StyleOffsetSeed(seed uint64, seat rulesengine.Seat) (Style, float64) {
	rng := mathrand.New(mathrand.NewSource(int64(seed^styleSeedSalt) + int64(seatIndex(seat))))
	styles := []Style{StyleSpeed, StyleValue, StyleCaution}
	style := styles[rng.Intn(len(styles))]
	weight := rng.Float64() * MaxStyleOffset
	return style, weight
}

func seatIndex(seat rulesengine.Seat) int {
	for index, candidate := range seatOrder {
		if candidate == seat {
			return index
		}
	}
	return 0
}
