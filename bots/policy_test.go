package bots

import (
	"reflect"
	"testing"

	"github.com/gameswithout/mahjong/rulesengine"
)

func sampleObservation() Observation {
	return Observation{
		Seat:           rulesengine.South,
		Dealer:         rulesengine.East,
		PrevailingWind: rulesengine.East,
		Continuation:   1,
		Hand: []rulesengine.Tile{
			tile("characters-1-1", rulesengine.Characters, 1, 1),
			tile("characters-4-1", rulesengine.Characters, 4, 1),
			tile("bamboo-9-2", rulesengine.Bamboo, 9, 2),
		},
		DrawableRemaining: 40,
	}
}

func TestPolicyDiscardIsDeterministic(t *testing.T) {
	obs := sampleObservation()
	for _, policy := range []Policy{NewEasyPolicy(), NewMediumPolicy()} {
		first := policy.DecideDiscard(obs, 42)
		second := policy.DecideDiscard(obs, 42)
		if !reflect.DeepEqual(first.Action, second.Action) {
			t.Fatalf("%s: same seed produced different actions: %#v vs %#v", policy.Difficulty(), first.Action, second.Action)
		}
		if first.RulesVersion != RulesVersion || first.AIVersion != AIVersion || first.Difficulty != policy.Difficulty() {
			t.Fatalf("%s: decision metadata = %#v", policy.Difficulty(), first)
		}
	}
}

// TestClaimAndSelfKongDecisionsReplayFromSeed covers the other two decision
// surfaces for §11.4's "decisions replay from seed": the same observation
// and seed must reproduce the same claim response and the same self-Kong
// choice, not just the same discard.
func TestClaimAndSelfKongDecisionsReplayFromSeed(t *testing.T) {
	obs := sampleObservation()
	claimOptions := ClaimOptions{
		Discard:  tile("dots-5-1", rulesengine.Dots, 5, 1),
		CanPong:  true,
		ChowSets: [][2]string{{"characters-1-1", "characters-4-1"}},
	}
	kongOptions := []SelfKongOption{
		{TileIDs: []string{"bamboo-1-1", "bamboo-1-2", "bamboo-1-3", "bamboo-1-4"}},
		{Added: true, TileID: "bamboo-9-2"},
	}
	for _, policy := range []Policy{NewEasyPolicy(), NewMediumPolicy()} {
		for seed := uint64(1); seed <= 5; seed++ {
			firstClaim := policy.DecideClaim(obs, claimOptions, seed)
			secondClaim := policy.DecideClaim(obs, claimOptions, seed)
			if !reflect.DeepEqual(firstClaim.Action, secondClaim.Action) {
				t.Fatalf("%s seed %d: claim decision not reproducible: %#v vs %#v", policy.Difficulty(), seed, firstClaim.Action, secondClaim.Action)
			}
			firstKong := policy.DecideSelfKong(obs, kongOptions, seed)
			secondKong := policy.DecideSelfKong(obs, kongOptions, seed)
			if !reflect.DeepEqual(firstKong.Action, secondKong.Action) {
				t.Fatalf("%s seed %d: self-Kong decision not reproducible: %#v vs %#v", policy.Difficulty(), seed, firstKong.Action, secondKong.Action)
			}
		}
	}
}

func TestPolicyAlwaysDeclaresLegalWin(t *testing.T) {
	obs := sampleObservation()
	options := ClaimOptions{CanWin: true, CanPong: true, CanKong: true}
	for _, policy := range []Policy{NewEasyPolicy(), NewMediumPolicy()} {
		decision := policy.DecideClaim(obs, options, 7)
		if decision.Action.Kind != ActionDeclareWin {
			t.Fatalf("%s: action = %#v, want ActionDeclareWin even with Pong/Kong also available", policy.Difficulty(), decision.Action)
		}
	}
}

func TestEasyClaimsMostImmediateProgress(t *testing.T) {
	obs := sampleObservation()
	easy := NewEasyPolicy()
	kongThenPong := ClaimOptions{CanPong: true, CanKong: true, ChowSets: [][2]string{{"a", "b"}}}
	if decision := easy.DecideClaim(obs, kongThenPong, 1); decision.Action.Kind != ActionKong {
		t.Fatalf("Easy with Kong+Pong+Chow available chose %s, want Kong", decision.Action.Kind)
	}
	pongOnly := ClaimOptions{CanPong: true}
	if decision := easy.DecideClaim(obs, pongOnly, 1); decision.Action.Kind != ActionPong {
		t.Fatalf("Easy with Pong available chose %s, want Pong", decision.Action.Kind)
	}
	chowOnly := ClaimOptions{ChowSets: [][2]string{{"characters-1-1", "characters-4-1"}}}
	if decision := easy.DecideClaim(obs, chowOnly, 1); decision.Action.Kind != ActionChow {
		t.Fatalf("Easy with only a Chow available chose %s, want Chow", decision.Action.Kind)
	}
	if decision := easy.DecideClaim(obs, ClaimOptions{}, 1); decision.Action.Kind != ActionPass {
		t.Fatalf("Easy with nothing legal chose %s, want Pass", decision.Action.Kind)
	}
}

func TestEasyDeclaresEverySelfKongOption(t *testing.T) {
	obs := sampleObservation()
	// Bamboo-1 x4 is this hand's only pair-worthy group — exactly the case
	// Medium is expected to refuse (see TestMediumAvoidsKongOnItsOnlyPair)
	// — but Easy declares Kongs without weighing wait damage (§11.3).
	options := []SelfKongOption{{TileIDs: []string{"bamboo-1-1", "bamboo-1-2", "bamboo-1-3", "bamboo-1-4"}}}
	decision := NewEasyPolicy().DecideSelfKong(obs, options, 1)
	if decision.Action.Kind != ActionConcealedKong {
		t.Fatalf("Easy self-Kong action = %s, want ActionConcealedKong", decision.Action.Kind)
	}
}

func TestMediumAvoidsKongOnItsOnlyPair(t *testing.T) {
	obs := sampleObservation()
	obs.Hand = append(obs.Hand,
		tile("bamboo-1-1", rulesengine.Bamboo, 1, 1),
		tile("bamboo-1-2", rulesengine.Bamboo, 1, 2),
		tile("bamboo-1-3", rulesengine.Bamboo, 1, 3),
		tile("bamboo-1-4", rulesengine.Bamboo, 1, 4),
	)
	options := []SelfKongOption{{TileIDs: []string{"bamboo-1-1", "bamboo-1-2", "bamboo-1-3", "bamboo-1-4"}}}
	decision := NewMediumPolicy().DecideSelfKong(obs, options, 1)
	if decision.Action.Kind != ActionPass {
		t.Fatalf("Medium action = %#v, want Pass when the Kong consumes the hand's only pair", decision.Action)
	}
}

func TestMediumDeclaresSelfKongThatPreservesAnotherPair(t *testing.T) {
	obs := sampleObservation()
	obs.Hand = append(obs.Hand,
		tile("bamboo-1-1", rulesengine.Bamboo, 1, 1),
		tile("bamboo-1-2", rulesengine.Bamboo, 1, 2),
		tile("bamboo-1-3", rulesengine.Bamboo, 1, 3),
		tile("bamboo-1-4", rulesengine.Bamboo, 1, 4),
		tile("dots-9-1", rulesengine.Dots, 9, 1),
		tile("dots-9-2", rulesengine.Dots, 9, 2),
	)
	options := []SelfKongOption{{TileIDs: []string{"bamboo-1-1", "bamboo-1-2", "bamboo-1-3", "bamboo-1-4"}}}
	decision := NewMediumPolicy().DecideSelfKong(obs, options, 1)
	if decision.Action.Kind != ActionConcealedKong {
		t.Fatalf("Medium action = %#v, want ActionConcealedKong when another pair (dots-9) survives", decision.Action)
	}
}

func TestMediumAlwaysDeclaresAddedKong(t *testing.T) {
	obs := sampleObservation()
	// Added-Kong material is a self-drawn 4th copy of an already-exposed
	// Pong; its other three copies are never part of the concealed hand, so
	// it can never be "the hand's only pair" and Medium always takes it.
	options := []SelfKongOption{{Added: true, TileID: "bamboo-9-2"}}
	decision := NewMediumPolicy().DecideSelfKong(obs, options, 1)
	if decision.Action.Kind != ActionAddedKong {
		t.Fatalf("Medium added-Kong action = %#v, want ActionAddedKong", decision.Action)
	}
}

func TestReactionDelayWithinDifficultyBounds(t *testing.T) {
	bounds := map[Difficulty][2]int64{
		Easy:   {800, 1800},
		Medium: {900, 2000},
	}
	for difficulty, bound := range bounds {
		min, max := reactionRange(difficulty)
		for seed := uint64(0); seed < 500; seed++ {
			delay := reactionDelay(seed, min, max)
			if delay.Milliseconds() < bound[0] || delay.Milliseconds() > bound[1] {
				t.Fatalf("%s seed %d: reaction delay = %s, want within [%dms,%dms]", difficulty, seed, delay, bound[0], bound[1])
			}
		}
	}
}

// TestDiscardDivergenceSpotCheck is a lightweight, informational sanity
// check that Easy diverges from the one-ply efficiency reference more often
// than Medium does, using dealt hands across many seeds. It is not the
// §11.4 calibration suite (10,000 same-seed seat-rotated sims against fixed
// percentage bands) — that is E3.F4's job — but it should already show the
// right qualitative ordering and land in a plausible range.
func TestDiscardDivergenceSpotCheck(t *testing.T) {
	easy, medium := NewEasyPolicy(), NewMediumPolicy()
	var easyOutside, mediumOutside, total int
	for dealSeed := uint64(1); dealSeed <= 60; dealSeed++ {
		state, err := rulesengine.Deal(dealSeed, [2]uint8{uint8(1 + dealSeed%6), uint8(1 + (dealSeed*7)%6)})
		if err != nil {
			continue
		}
		for _, player := range state.Players {
			hand := player.Hand
			if len(hand) < 2 {
				continue
			}
			top := topDiscardSet(hand, nil)
			if len(top) == 0 || len(top) == len(legalDiscards(hand)) {
				// No meaningful reference distinction to diverge from.
				continue
			}
			obs := Observation{Seat: player.Seat, Hand: hand, DrawableRemaining: 60}
			for trial := uint64(0); trial < 5; trial++ {
				seed := dealSeed*1000 + trial
				total++
				if action := easy.DecideDiscard(obs, seed).Action; !top[action.TileID] {
					easyOutside++
				}
				if action := medium.DecideDiscard(obs, seed).Action; !top[action.TileID] {
					mediumOutside++
				}
			}
		}
	}
	if total < 50 {
		t.Fatalf("spot check only observed %d decisions, need a larger sample to mean anything", total)
	}
	easyRate := float64(easyOutside) / float64(total)
	mediumRate := float64(mediumOutside) / float64(total)
	t.Logf("spot check (n=%d): Easy diverges %.1f%%, Medium diverges %.1f%%", total, easyRate*100, mediumRate*100)
	if mediumRate > easyRate {
		t.Fatalf("Medium diverged from the reference more than Easy did (%.1f%% vs %.1f%%)", mediumRate*100, easyRate*100)
	}
	if easyRate == 0 {
		t.Fatal("Easy never diverged from the reference across the sample; expected meaningful random variation")
	}
}

func TestDecideOfferAlwaysAccepts(t *testing.T) {
	obs := sampleObservation()
	for _, difficulty := range []Difficulty{Easy, Medium} {
		decision := DecideOffer(difficulty, obs, 9)
		if decision.Action.Kind != ActionAcceptOffer {
			t.Fatalf("%s: DecideOffer action = %s, want ActionAcceptOffer", difficulty, decision.Action.Kind)
		}
	}
}
