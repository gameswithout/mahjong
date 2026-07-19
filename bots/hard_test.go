package bots

import (
	"testing"

	"github.com/gameswithout/mahjong/rulesengine"
)

func TestHardAlwaysDeclaresLegalWin(t *testing.T) {
	obs := sampleObservation()
	options := ClaimOptions{CanWin: true, CanPong: true, CanKong: true}
	decision := NewHardPolicy().DecideClaim(obs, options, 7)
	if decision.Action.Kind != ActionDeclareWin {
		t.Fatalf("action = %#v, want ActionDeclareWin", decision.Action)
	}
}

func TestHardDiscardIsDeterministic(t *testing.T) {
	obs := sampleObservation()
	hard := NewHardPolicy()
	first := hard.DecideDiscard(obs, 99)
	second := hard.DecideDiscard(obs, 99)
	if first.Action.TileID != second.Action.TileID {
		t.Fatalf("same seed produced different discards: %s vs %s", first.Action.TileID, second.Action.TileID)
	}
}

// TestHardPrefersProvablySafeDiscardWhenHandIsOtherwiseIndifferent builds a
// hand where two candidate discards are equally useless to Hard's own hand
// (isolated singles, no speed/value difference either way), but one is
// provably safe against a fully-melded (tanki-waiting) opponent and the
// other is not. Hard must not pick the unsafe one purely by tile-ID
// tie-break, proving the risk term actually influences the outcome.
func TestHardPrefersProvablySafeDiscardWhenHandIsOtherwiseIndifferent(t *testing.T) {
	// Hand: three concealed melds worth of tiles + two isolated singles
	// (bamboo-2 and dots-2), neither connected to anything else, so
	// discarding either leaves identical speed/value.
	hand := []rulesengine.Tile{
		tile("characters-1-1", rulesengine.Characters, 1, 1),
		tile("characters-2-1", rulesengine.Characters, 2, 1),
		tile("characters-3-1", rulesengine.Characters, 3, 1),
		tile("characters-4-1", rulesengine.Characters, 4, 1),
		tile("characters-5-1", rulesengine.Characters, 5, 1),
		tile("characters-6-1", rulesengine.Characters, 6, 1),
		tile("characters-7-1", rulesengine.Characters, 7, 1),
		tile("characters-8-1", rulesengine.Characters, 8, 1),
		tile("characters-9-1", rulesengine.Characters, 9, 1),
		tile("dots-9-1", rulesengine.Dots, 9, 1),
		tile("dots-9-2", rulesengine.Dots, 9, 2),
		tile("bamboo-2-1", rulesengine.Bamboo, 2, 1),
		tile("dots-2-1", rulesengine.Dots, 2, 1),
	}
	obs := Observation{
		Seat:              rulesengine.South,
		Dealer:            rulesengine.East,
		PrevailingWind:    rulesengine.East,
		Hand:              hand,
		DrawableRemaining: 60,
		Opponents: []OpponentView{
			{Seat: rulesengine.East, Melds: melds(5)}, // fully melded, tanki wait
		},
	}
	// Make bamboo-2 provably UNSAFE (unseen copies exist) and dots-2
	// provably SAFE (fully exhausted elsewhere) against the East opponent,
	// by controlling what's additionally visible via discards.
	obs.Discards = []rulesengine.Discard{
		{Seat: rulesengine.West, Tile: tile("dots-2-2", rulesengine.Dots, 2, 2)},
		{Seat: rulesengine.West, Tile: tile("dots-2-3", rulesengine.Dots, 2, 3)},
		{Seat: rulesengine.West, Tile: tile("dots-2-4", rulesengine.Dots, 2, 4)},
	}
	// Sanity: confirm the safety setup actually produces the intended
	// asymmetry before trusting the policy-level assertion.
	budget := unseenBudget(VisibleCounts(obs))
	bambooSafe, _ := isProvablySafeAgainst(tile("bamboo-2-1", rulesengine.Bamboo, 2, 1), obs.Opponents[0], budget)
	dotsSafe, _ := isProvablySafeAgainst(tile("dots-2-1", rulesengine.Dots, 2, 1), obs.Opponents[0], budget)
	if bambooSafe || !dotsSafe {
		t.Fatalf("setup error: bamboo-2 safe=%v (want false), dots-2 safe=%v (want true)", bambooSafe, dotsSafe)
	}

	decision := NewHardPolicy().DecideDiscard(obs, 1)
	if decision.Action.TileID != "dots-2-1" {
		t.Fatalf("Hard discarded %s, want the provably safe dots-2-1 over the unsafe bamboo-2-1", decision.Action.TileID)
	}
}

func TestHardFoldPrioritizesSafetyOverSpeed(t *testing.T) {
	// A hand where continuing (discarding the isolated honor tile) would
	// normally be the speed-best move, but folding conditions are met
	// (late wall + a visibly threatening opponent) and a safe alternative
	// exists — Hard should take the safe tile even though it's worse for
	// its own hand.
	hand := []rulesengine.Tile{
		tile("characters-1-1", rulesengine.Characters, 1, 1),
		tile("characters-2-1", rulesengine.Characters, 2, 1),
		tile("characters-3-1", rulesengine.Characters, 3, 1),
		tile("characters-4-1", rulesengine.Characters, 4, 1),
		tile("characters-5-1", rulesengine.Characters, 5, 1),
		tile("characters-6-1", rulesengine.Characters, 6, 1),
		tile("characters-7-1", rulesengine.Characters, 7, 1),
		tile("characters-8-1", rulesengine.Characters, 8, 1),
		tile("characters-9-1", rulesengine.Characters, 9, 1),
		tile("dots-9-1", rulesengine.Dots, 9, 1),
		tile("dots-9-2", rulesengine.Dots, 9, 2),
		tile("wind-north-1", rulesengine.Wind, 0, 1), // isolated, "best" discard for pure speed
		tile("dots-2-1", rulesengine.Dots, 2, 1),     // safe discard, worse for speed
	}
	obs := Observation{
		Seat:              rulesengine.South,
		Dealer:            rulesengine.East,
		PrevailingWind:    rulesengine.East,
		Hand:              hand,
		DrawableRemaining: 10, // fewer than the 24-tile fold threshold
		Opponents: []OpponentView{
			// Fully melded: only a pair is needed, so a Chow placement is
			// structurally impossible (requiredMelds=0) and dots-2's safety
			// below depends only on its own type being exhausted, not on
			// also blocking every possible Chow partner.
			{Seat: rulesengine.East, Melds: melds(5)},
		},
		Discards: []rulesengine.Discard{
			// wind-north is deliberately left with unseen copies (unsafe);
			// dots-2 is fully exhausted elsewhere (safe).
			{Seat: rulesengine.West, Tile: tile("dots-2-2", rulesengine.Dots, 2, 2)},
			{Seat: rulesengine.West, Tile: tile("dots-2-3", rulesengine.Dots, 2, 3)},
			{Seat: rulesengine.West, Tile: tile("dots-2-4", rulesengine.Dots, 2, 4)},
		},
	}
	if !shouldConsiderFolding(obs) {
		t.Fatal("setup error: fold conditions should be met")
	}
	budget := unseenBudget(VisibleCounts(obs))
	windSafe, _ := isProvablySafeAgainst(tile("wind-north-1", rulesengine.Wind, 0, 1), obs.Opponents[0], budget)
	dotsSafe, _ := isProvablySafeAgainst(tile("dots-2-1", rulesengine.Dots, 2, 1), obs.Opponents[0], budget)
	if windSafe || !dotsSafe {
		t.Fatalf("setup error: wind-north safe=%v (want false), dots-2 safe=%v (want true)", windSafe, dotsSafe)
	}

	decision := NewHardPolicy().DecideDiscard(obs, 1)
	if decision.Action.TileID != "dots-2-1" {
		t.Fatalf("Hard discarded %s while folding, want the provably safe dots-2-1 over the unsafe wind-north-1", decision.Action.TileID)
	}
}

func TestHardAvoidsSelfKongOnItsOnlyPair(t *testing.T) {
	obs := sampleObservation()
	obs.Hand = append(obs.Hand,
		tile("bamboo-1-1", rulesengine.Bamboo, 1, 1),
		tile("bamboo-1-2", rulesengine.Bamboo, 1, 2),
		tile("bamboo-1-3", rulesengine.Bamboo, 1, 3),
		tile("bamboo-1-4", rulesengine.Bamboo, 1, 4),
	)
	options := []SelfKongOption{{TileIDs: []string{"bamboo-1-1", "bamboo-1-2", "bamboo-1-3", "bamboo-1-4"}}}
	decision := NewHardPolicy().DecideSelfKong(obs, options, 1)
	if decision.Action.Kind != ActionPass {
		t.Fatalf("action = %#v, want Pass when the Kong consumes the hand's only pair", decision.Action)
	}
}

func TestHardTakesProvablySafeAddedKong(t *testing.T) {
	obs := sampleObservation()
	obs.Opponents = []OpponentView{{Seat: rulesengine.North, Melds: melds(2)}}
	// bamboo-9 has zero unseen copies anywhere, so adding it as a Kong is
	// provably safe against the only opponent regardless of their shape.
	obs.Hand = append(obs.Hand, tile("bamboo-9-2", rulesengine.Bamboo, 9, 2))
	obs.Discards = []rulesengine.Discard{
		{Seat: rulesengine.West, Tile: tile("bamboo-9-3", rulesengine.Bamboo, 9, 3)},
		{Seat: rulesengine.West, Tile: tile("bamboo-9-4", rulesengine.Bamboo, 9, 4)},
	}
	options := []SelfKongOption{{Added: true, TileID: "bamboo-9-2"}}
	decision := NewHardPolicy().DecideSelfKong(obs, options, 1)
	if decision.Action.Kind != ActionAddedKong {
		t.Fatalf("action = %#v, want ActionAddedKong for a provably safe added Kong", decision.Action)
	}
}

func TestHardReactionDelayWithinBounds(t *testing.T) {
	min, max := reactionRange(Hard)
	for seed := uint64(0); seed < 300; seed++ {
		delay := reactionDelay(seed, min, max)
		if delay.Milliseconds() < 1000 || delay.Milliseconds() > 2300 {
			t.Fatalf("seed %d: reaction delay = %s, want within [1000ms,2300ms]", seed, delay)
		}
	}
}

// TestHardDiscardDivergenceSpotCheck is a lightweight, informational sanity
// check that Hard mostly agrees with the one-ply efficiency reference when
// there is no opponent/risk information to reasonably disagree over (§11.4:
// Hard should diverge no more than 5% of the time). It is not the full
// 10,000-sim calibration suite — that is E3.F4's job — but it should
// already land comfortably within the target band.
func TestHardDiscardDivergenceSpotCheck(t *testing.T) {
	hard := NewHardPolicy()
	var outside, total int
	for dealSeed := uint64(1); dealSeed <= 80; dealSeed++ {
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
				continue
			}
			obs := Observation{Seat: player.Seat, Hand: hand, DrawableRemaining: 60}
			for trial := uint64(0); trial < 5; trial++ {
				seed := dealSeed*1000 + trial
				total++
				if action := hard.DecideDiscard(obs, seed).Action; !top[action.TileID] {
					outside++
				}
			}
		}
	}
	if total < 50 {
		t.Fatalf("spot check only observed %d decisions, need a larger sample to mean anything", total)
	}
	rate := float64(outside) / float64(total)
	t.Logf("Hard spot check (n=%d, no opponents supplied): diverges %.2f%%", total, rate*100)
	if rate > 0.05 {
		t.Fatalf("Hard diverged from the reference %.2f%% of the time, want <=5%%", rate*100)
	}
}
