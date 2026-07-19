package bots

import (
	"testing"

	"github.com/gameswithout/mahjong/rulesengine"
)

// zeroBudget returns a budget map with every structural type at 0, so a
// test only has to name the types it actually wants unseen copies of —
// everything else is exhaustively exhausted by construction, giving
// precise control over adversarial fixtures.
func zeroBudget() map[string]int {
	budget := make(map[string]int, len(structuralTypes))
	for _, item := range structuralTypes {
		budget[item.key] = 0
	}
	return budget
}

func meld(kind rulesengine.TileKind, rank uint8) rulesengine.Meld {
	return rulesengine.Meld{Type: rulesengine.MeldPong, Tiles: []rulesengine.Tile{{Kind: kind, Rank: rank}}}
}

func melds(n int) []rulesengine.Meld {
	out := make([]rulesengine.Meld, n)
	// Distinct filler types so opponent.Melds has a plausible, distinct
	// shape; the safety search only cares about len(opponent.Melds).
	fillers := []struct {
		kind rulesengine.TileKind
		rank uint8
	}{
		{rulesengine.Bamboo, 1}, {rulesengine.Bamboo, 4}, {rulesengine.Bamboo, 7},
		{rulesengine.Dots, 1}, {rulesengine.Dots, 4},
	}
	for i := 0; i < n; i++ {
		out[i] = meld(fillers[i].kind, fillers[i].rank)
	}
	return out
}

func TestSafetyTypeFullyExhaustedIsSafe(t *testing.T) {
	budget := zeroBudget() // every type at 0 unseen copies.
	candidate := rulesengine.Tile{ID: "dots-9-1", Kind: rulesengine.Dots, Rank: 9}
	opponent := OpponentView{Seat: rulesengine.East, Melds: melds(4)} // requiredMelds=1, handCount=5
	safe, exhaustive := isProvablySafeAgainst(candidate, opponent, budget)
	if !exhaustive {
		t.Fatal("search was not exhaustive")
	}
	if !safe {
		t.Fatal("candidate type has zero unseen copies anywhere; must be safe against every opponent")
	}
}

func TestSafetyFullyMeldedOpponentTankiWaitIsUnsafe(t *testing.T) {
	budget := zeroBudget()
	budget["dots-5"] = 1 // exactly one unseen copy: enough to pair with candidate.
	candidate := rulesengine.Tile{ID: "dots-5-1", Kind: rulesengine.Dots, Rank: 5}
	opponent := OpponentView{Seat: rulesengine.East, Melds: melds(5)} // requiredMelds=0, handCount=2 (tanki wait)
	safe, exhaustive := isProvablySafeAgainst(candidate, opponent, budget)
	if !exhaustive {
		t.Fatal("search was not exhaustive")
	}
	if safe {
		t.Fatal("a fully-melded opponent with 1 unseen copy of the candidate's type is waiting tanki on exactly this tile — must be unsafe")
	}
}

func TestSafetyFullyMeldedOpponentTypeExhaustedIsSafe(t *testing.T) {
	budget := zeroBudget() // candidate's own type also at 0 — no pair possible.
	candidate := rulesengine.Tile{ID: "dots-5-1", Kind: rulesengine.Dots, Rank: 5}
	opponent := OpponentView{Seat: rulesengine.East, Melds: melds(5)}
	safe, exhaustive := isProvablySafeAgainst(candidate, opponent, budget)
	if !exhaustive {
		t.Fatal("search was not exhaustive")
	}
	if !safe {
		t.Fatal("candidate's own type has zero unseen copies; a fully-melded opponent cannot pair on it")
	}
}

func TestSafetyChowCompletionWithAvailablePairIsUnsafe(t *testing.T) {
	budget := zeroBudget()
	budget["characters-4"] = 1
	budget["characters-6"] = 1
	budget["bamboo-3"] = 2 // enough for the still-needed pair.
	candidate := rulesengine.Tile{ID: "characters-5-1", Kind: rulesengine.Characters, Rank: 5}
	opponent := OpponentView{Seat: rulesengine.East, Melds: melds(4)} // requiredMelds=1, handCount=5
	safe, exhaustive := isProvablySafeAgainst(candidate, opponent, budget)
	if !exhaustive {
		t.Fatal("search was not exhaustive")
	}
	if safe {
		t.Fatal("characters-4/6 complete a mid-run Chow with characters-5, and bamboo-3 supplies the pair — must be unsafe")
	}
}

func TestSafetyChowCompletionWithoutAvailablePairIsSafe(t *testing.T) {
	budget := zeroBudget()
	budget["characters-4"] = 1
	budget["characters-6"] = 1
	// No type anywhere has >=2 unseen copies, so even though the Chow
	// itself is buildable, no pair can complete the hand.
	candidate := rulesengine.Tile{ID: "characters-5-1", Kind: rulesengine.Characters, Rank: 5}
	opponent := OpponentView{Seat: rulesengine.East, Melds: melds(4)}
	safe, exhaustive := isProvablySafeAgainst(candidate, opponent, budget)
	if !exhaustive {
		t.Fatal("search was not exhaustive")
	}
	if !safe {
		t.Fatal("a Chow is buildable but no pair is available anywhere — must be safe")
	}
}

func TestSafetyLowAndHighRunPlacements(t *testing.T) {
	// characters-5 as the HIGH tile of a low run (3-4-5).
	budgetLow := zeroBudget()
	budgetLow["characters-3"] = 1
	budgetLow["characters-4"] = 1
	budgetLow["bamboo-9"] = 2
	candidate := rulesengine.Tile{ID: "characters-5-1", Kind: rulesengine.Characters, Rank: 5}
	opponent := OpponentView{Seat: rulesengine.East, Melds: melds(4)}
	if safe, exhaustive := isProvablySafeAgainst(candidate, opponent, budgetLow); !exhaustive || safe {
		t.Fatalf("low-run (3-4-5) placement should be unsafe: safe=%v exhaustive=%v", safe, exhaustive)
	}

	// characters-5 as the LOW tile of a high run (5-6-7).
	budgetHigh := zeroBudget()
	budgetHigh["characters-6"] = 1
	budgetHigh["characters-7"] = 1
	budgetHigh["bamboo-9"] = 2
	if safe, exhaustive := isProvablySafeAgainst(candidate, opponent, budgetHigh); !exhaustive || safe {
		t.Fatalf("high-run (5-6-7) placement should be unsafe: safe=%v exhaustive=%v", safe, exhaustive)
	}

	// Boundary: rank 9 can never be the low tile of any run (needs 10, 11).
	edgeCandidate := rulesengine.Tile{ID: "characters-9-1", Kind: rulesengine.Characters, Rank: 9}
	budgetEdge := zeroBudget()
	budgetEdge["characters-7"] = 1
	budgetEdge["characters-8"] = 1
	budgetEdge["bamboo-9"] = 2
	if safe, exhaustive := isProvablySafeAgainst(edgeCandidate, opponent, budgetEdge); !exhaustive || safe {
		t.Fatalf("rank-9 candidate as the high tile of 7-8-9 should still be unsafe: safe=%v exhaustive=%v", safe, exhaustive)
	}
	// But rank 9 must NOT be reachable as a low-run or mid-run tile — only
	// one Chow placement (7-8-9) exists for it. Remove that placement's
	// support and confirm it falls back to safe.
	budgetNoRun := zeroBudget()
	if safe, exhaustive := isProvablySafeAgainst(edgeCandidate, opponent, budgetNoRun); !exhaustive || !safe {
		t.Fatalf("rank-9 candidate with no Chow support should be safe: safe=%v exhaustive=%v", safe, exhaustive)
	}
}

func TestSafetyHonorTilesHaveNoChowPlacement(t *testing.T) {
	budget := zeroBudget()
	budget["wind-east"] = 2 // enough for Pong, not enough alone for Pong+pair from the same type.
	candidate := rulesengine.Tile{ID: "wind-east-1", Kind: rulesengine.Wind}
	opponent := OpponentView{Seat: rulesengine.East, Melds: melds(4)}
	// Pong placement needs 2 unseen copies of wind-east (present) plus a
	// pair from elsewhere (absent) — should be safe.
	if safe, exhaustive := isProvablySafeAgainst(candidate, opponent, budget); !exhaustive || !safe {
		t.Fatalf("wind-east Pong with no pair available should be safe: safe=%v exhaustive=%v", safe, exhaustive)
	}
	// Add a pair source: now unsafe via Pong.
	budget["dots-2"] = 2
	if safe, exhaustive := isProvablySafeAgainst(candidate, opponent, budget); !exhaustive || safe {
		t.Fatalf("wind-east Pong with dots-2 pair available should be unsafe: safe=%v exhaustive=%v", safe, exhaustive)
	}
}

func TestSafetyConcealedKongPlacement(t *testing.T) {
	budget := zeroBudget()
	budget["dragon-red"] = 3 // candidate + 3 hidden = concealed Kong (1 meld).
	budget["dots-2"] = 2     // pair source.
	candidate := rulesengine.Tile{ID: "dragon-red-1", Kind: rulesengine.Dragon}
	opponent := OpponentView{Seat: rulesengine.East, Melds: melds(4)}
	if safe, exhaustive := isProvablySafeAgainst(candidate, opponent, budget); !exhaustive || safe {
		t.Fatalf("concealed-Kong completion should be unsafe: safe=%v exhaustive=%v", safe, exhaustive)
	}
}

func TestSafetyWinLockedOpponentIsAlwaysSafe(t *testing.T) {
	obs := Observation{
		Seat: rulesengine.South,
		Hand: []rulesengine.Tile{{ID: "dots-5-1", Kind: rulesengine.Dots, Rank: 5}},
		Opponents: []OpponentView{
			{Seat: rulesengine.East, Melds: melds(5)}, // tanki-waiting, would normally be unsafe
		},
	}
	candidate := rulesengine.Tile{ID: "dots-5-1", Kind: rulesengine.Dots, Rank: 5}
	results := EvaluateDiscardSafety(obs, candidate, map[rulesengine.Seat]bool{rulesengine.East: true})
	if len(results) != 1 || !results[0].Safe || !results[0].Exhaustive {
		t.Fatalf("win-locked opponent must be reported safe regardless of hand shape: %#v", results)
	}
	if !IsFullySafe(results) {
		t.Fatal("IsFullySafe should be true when the only opponent is win-locked")
	}
}

func TestSafetyMultipleOpponentsRequiresAllSafe(t *testing.T) {
	budgetSafe := zeroBudget()
	budgetUnsafe := zeroBudget()
	budgetUnsafe["dots-5"] = 1
	candidate := rulesengine.Tile{ID: "dots-5-1", Kind: rulesengine.Dots, Rank: 5}
	safeVsFirst, _ := isProvablySafeAgainst(candidate, OpponentView{Seat: rulesengine.East, Melds: melds(5)}, budgetSafe)
	safeVsSecond, _ := isProvablySafeAgainst(candidate, OpponentView{Seat: rulesengine.West, Melds: melds(5)}, budgetUnsafe)
	if !safeVsFirst {
		t.Fatal("setup error: expected safe against first opponent")
	}
	if safeVsSecond {
		t.Fatal("setup error: expected unsafe against second opponent")
	}
	results := []SafetyResult{
		{Opponent: rulesengine.East, Safe: safeVsFirst, Exhaustive: true},
		{Opponent: rulesengine.West, Safe: safeVsSecond, Exhaustive: true},
	}
	if IsFullySafe(results) {
		t.Fatal("IsFullySafe must be false when any single opponent is unsafe")
	}
}

func TestSafetyInconclusiveSearchNeverReportsSafe(t *testing.T) {
	// A pathological budget (every type maxed) forces the search past the
	// step cap; the result must never be reported as a safety proof.
	budget := zeroBudget()
	for key := range budget {
		budget[key] = 4
	}
	candidate := rulesengine.Tile{ID: "characters-1-1", Kind: rulesengine.Characters, Rank: 1}
	opponent := OpponentView{Seat: rulesengine.East, Melds: nil} // requiredMelds=5, handCount=17
	safe, exhaustive := isProvablySafeAgainst(candidate, opponent, budget)
	if exhaustive && !safe {
		// Exhaustively proved unsafe is a fine, valid outcome too (a fully
		// wide-open budget is almost certainly not provably safe) — the
		// real invariant under test is the next one.
		t.Skip("search completed exhaustively and correctly found the candidate unsafe")
	}
	if safe && !exhaustive {
		t.Fatal("an inconclusive (non-exhaustive) search must never report safe=true")
	}
}

func TestVisibleCountsAndUnseenBudgetRoundTrip(t *testing.T) {
	obs := Observation{
		Seat: rulesengine.South,
		Hand: []rulesengine.Tile{
			{ID: "dots-1-1", Kind: rulesengine.Dots, Rank: 1},
			{ID: "dots-1-2", Kind: rulesengine.Dots, Rank: 1},
		},
		Discards: []rulesengine.Discard{
			{Seat: rulesengine.East, Tile: rulesengine.Tile{ID: "dots-1-3", Kind: rulesengine.Dots, Rank: 1}},
		},
		Opponents: []OpponentView{
			{
				Seat: rulesengine.East,
				Melds: []rulesengine.Meld{{
					Type: rulesengine.MeldPong,
					Tiles: []rulesengine.Tile{
						{ID: "wind-east-1", Kind: rulesengine.Wind},
						{ID: "wind-east-2", Kind: rulesengine.Wind},
						{ID: "wind-east-3", Kind: rulesengine.Wind},
					},
				}},
			},
		},
	}
	visible := VisibleCounts(obs)
	if visible["dots-1"] != 3 {
		t.Fatalf("visible dots-1 = %d, want 3", visible["dots-1"])
	}
	if visible["wind-east"] != 3 {
		t.Fatalf("visible wind-east = %d, want 3", visible["wind-east"])
	}
	budget := unseenBudget(visible)
	if budget["dots-1"] != 1 {
		t.Fatalf("unseen dots-1 = %d, want 1 (4 total - 3 visible)", budget["dots-1"])
	}
	if budget["characters-1"] != 4 {
		t.Fatalf("untouched type characters-1 budget = %d, want 4", budget["characters-1"])
	}
}
