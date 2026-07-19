package bots

import (
	"reflect"
	"testing"

	"github.com/gameswithout/mahjong/rulesengine"
)

// fixedDiscardPolicy is a minimal Policy whose DecideDiscard always returns
// a fixed tile, so styledPolicy's own tie-detection/tie-break logic can be
// tested in isolation from any real difficulty's ranking behavior.
type fixedDiscardPolicy struct {
	tileID string
}

func (fixedDiscardPolicy) Difficulty() Difficulty { return Medium }

func (p fixedDiscardPolicy) DecideDiscard(obs Observation, seed uint64) Decision {
	return newDecision(Medium, seed, obs, Action{Kind: ActionDiscard, TileID: p.tileID}, 0)
}

func (fixedDiscardPolicy) DecideClaim(obs Observation, options ClaimOptions, seed uint64) Decision {
	return newDecision(Medium, seed, obs, Action{Kind: ActionPass}, 0)
}

func (fixedDiscardPolicy) DecideSelfKong(obs Observation, options []SelfKongOption, seed uint64) Decision {
	return newDecision(Medium, seed, obs, Action{}, 0)
}

func TestNewStyledPolicyReturnsBaseWhenStyleOrWeightIsZero(t *testing.T) {
	base := NewMediumPolicy()
	if got := NewStyledPolicy(base, StyleNone, MaxStyleOffset); got != base {
		t.Fatal("StyleNone must return base unchanged")
	}
	if got := NewStyledPolicy(base, StyleSpeed, 0); got != base {
		t.Fatal("zero weight must return base unchanged")
	}
}

// tiedHandObservation is three mutually isolated tiles (no shared type, no
// numbered adjacency), so every legal discard ties at rankDiscards' top
// (and only) tier — the scenario styledPolicy is allowed to act on.
func tiedHandObservation() Observation {
	return Observation{
		Seat: rulesengine.South,
		Hand: []rulesengine.Tile{
			tile("characters-1-1", rulesengine.Characters, 1, 1),
			tile("characters-4-1", rulesengine.Characters, 4, 1),
			tile("bamboo-9-2", rulesengine.Bamboo, 9, 2),
		},
		DrawableRemaining: 40,
	}
}

func TestStyledPolicyNeverPicksOutsideTheTie(t *testing.T) {
	obs := tiedHandObservation()
	base := fixedDiscardPolicy{tileID: "characters-1-1"}
	tiedIDs := map[string]bool{"characters-1-1": true, "characters-4-1": true, "bamboo-9-2": true}
	for _, style := range []Style{StyleSpeed, StyleValue, StyleCaution} {
		policy := NewStyledPolicy(base, style, MaxStyleOffset)
		for seed := uint64(0); seed < 200; seed++ {
			decision := policy.DecideDiscard(obs, seed)
			if !tiedIDs[decision.Action.TileID] {
				t.Fatalf("style %d seed %d: chose %q, want one of the tied candidates", style, seed, decision.Action.TileID)
			}
		}
	}
}

func TestStyledPolicyDiscardIsDeterministic(t *testing.T) {
	obs := tiedHandObservation()
	base := fixedDiscardPolicy{tileID: "characters-1-1"}
	for _, style := range []Style{StyleSpeed, StyleValue, StyleCaution} {
		policy := NewStyledPolicy(base, style, MaxStyleOffset)
		first := policy.DecideDiscard(obs, 7)
		second := policy.DecideDiscard(obs, 7)
		if first.Action.TileID != second.Action.TileID {
			t.Fatalf("style %d: same seed produced different tiles: %q vs %q", style, first.Action.TileID, second.Action.TileID)
		}
	}
}

func TestStyledPolicySpeedTakesLexicographicallyFirstTiedTile(t *testing.T) {
	obs := tiedHandObservation()
	base := fixedDiscardPolicy{tileID: "characters-4-1"}
	policy := NewStyledPolicy(base, StyleSpeed, MaxStyleOffset)
	// The style-hit RNG is seeded independently of the decision seed via
	// styleSeedSalt; scan seeds until one actually exercises the style path
	// (weight is a probability, not a guarantee for any single seed).
	found := false
	for seed := uint64(0); seed < 500; seed++ {
		decision := policy.DecideDiscard(obs, seed)
		if decision.Action.TileID != base.tileID {
			found = true
			if decision.Action.TileID != "bamboo-9-2" {
				t.Fatalf("seed %d: Speed style chose %q, want the lexicographically first tied tile bamboo-9-2", seed, decision.Action.TileID)
			}
		}
	}
	if !found {
		t.Fatal("no seed in range exercised the style path; MaxStyleOffset or styleSeedSalt may be broken")
	}
}

func TestStyledPolicyLeavesUntiedDiscardUnchanged(t *testing.T) {
	obs := Observation{
		Seat: rulesengine.South,
		Hand: []rulesengine.Tile{
			tile("characters-1-1", rulesengine.Characters, 1, 1),
			tile("characters-2-1", rulesengine.Characters, 2, 1),
		},
		DrawableRemaining: 40,
	}
	// characters-1-1 and characters-2-1 are adjacent (gap 1), so
	// connectivityScore differs for each as the discard candidate — no tie.
	base := fixedDiscardPolicy{tileID: "characters-1-1"}
	policy := NewStyledPolicy(base, StyleValue, MaxStyleOffset)
	for seed := uint64(0); seed < 200; seed++ {
		decision := policy.DecideDiscard(obs, seed)
		if decision.Action.TileID != base.tileID {
			t.Fatalf("seed %d: styled policy changed an untied discard from %q to %q", seed, base.tileID, decision.Action.TileID)
		}
	}
}

func TestStyledPolicyDelegatesClaimAndSelfKong(t *testing.T) {
	obs := tiedHandObservation()
	base := NewMediumPolicy()
	policy := NewStyledPolicy(base, StyleCaution, MaxStyleOffset)
	claimOptions := ClaimOptions{Discard: tile("characters-1-2", rulesengine.Characters, 1, 2)}
	if got, want := policy.DecideClaim(obs, claimOptions, 5).Action, base.DecideClaim(obs, claimOptions, 5).Action; !reflect.DeepEqual(got, want) {
		t.Fatalf("DecideClaim: styled = %#v, want base = %#v", got, want)
	}
	kongOptions := []SelfKongOption{{Added: true, TileID: "characters-1-1"}}
	if got, want := policy.DecideSelfKong(obs, kongOptions, 5).Action, base.DecideSelfKong(obs, kongOptions, 5).Action; !reflect.DeepEqual(got, want) {
		t.Fatalf("DecideSelfKong: styled = %#v, want base = %#v", got, want)
	}
}

func TestStyleOffsetSeedStaysWithinBounds(t *testing.T) {
	for seed := uint64(0); seed < 500; seed++ {
		for _, seat := range seatOrder {
			style, weight := StyleOffsetSeed(seed, seat)
			if style != StyleSpeed && style != StyleValue && style != StyleCaution {
				t.Fatalf("seed %d seat %s: style = %v, want a real style", seed, seat, style)
			}
			if weight < 0 || weight > MaxStyleOffset {
				t.Fatalf("seed %d seat %s: weight = %v, want within [0, %v]", seed, seat, weight, MaxStyleOffset)
			}
		}
	}
}

func TestStyleOffsetSeedIsDeterministic(t *testing.T) {
	for seed := uint64(0); seed < 20; seed++ {
		for _, seat := range seatOrder {
			style1, weight1 := StyleOffsetSeed(seed, seat)
			style2, weight2 := StyleOffsetSeed(seed, seat)
			if style1 != style2 || weight1 != weight2 {
				t.Fatalf("seed %d seat %s: not deterministic: (%v,%v) vs (%v,%v)", seed, seat, style1, weight1, style2, weight2)
			}
		}
	}
}
