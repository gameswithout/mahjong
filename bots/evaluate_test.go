package bots

import (
	mathrand "math/rand"
	"testing"

	"github.com/gameswithout/mahjong/rulesengine"
)

// buildWinningHand assembles a legal 17-tile hand — five melds and a pair,
// drawn from the real catalog so no tile type is used more than four times.
// It returns the tiles unsorted, as a hand actually arrives.
func buildWinningHand(t *testing.T, rng *mathrand.Rand) []rulesengine.Tile {
	t.Helper()
	byType := map[string][]rulesengine.Tile{}
	var types []structuralType
	for _, item := range rulesengine.Catalog() {
		if item.IsFlower() {
			continue
		}
		key := tileTypeKey(item)
		if len(byType[key]) == 0 {
			types = append(types, structuralType{key: key, kind: item.Kind, rank: item.Rank})
		}
		byType[key] = append(byType[key], item)
	}

	take := func(key string, count int) []rulesengine.Tile {
		available := byType[key]
		if len(available) < count {
			return nil
		}
		byType[key] = available[count:]
		return available[:count]
	}

	hand := make([]rulesengine.Tile, 0, 17)
	for blocks := 0; blocks < 6; blocks++ {
		size := 3
		if blocks == 5 {
			size = 2 // the pair
		}
		for attempt := 0; ; attempt++ {
			if attempt > 500 {
				t.Fatalf("could not assemble block %d of a winning hand", blocks)
			}
			pick := types[rng.Intn(len(types))]
			index := structuralIndex[pick.key]
			// Try a run first for suited tiles, then fall back to a triplet.
			if size == 3 && rng.Intn(2) == 0 && chowNext1[index] >= 0 && chowNext2[index] >= 0 {
				first := take(pick.key, 1)
				second := take(structuralTypes[chowNext1[index]].key, 1)
				third := take(structuralTypes[chowNext2[index]].key, 1)
				if first != nil && second != nil && third != nil {
					hand = append(hand, first...)
					hand = append(hand, second...)
					hand = append(hand, third...)
					break
				}
				// Partial take: put back whatever succeeded.
				byType[pick.key] = append(first, byType[pick.key]...)
				byType[structuralTypes[chowNext1[index]].key] = append(second, byType[structuralTypes[chowNext1[index]].key]...)
				byType[structuralTypes[chowNext2[index]].key] = append(third, byType[structuralTypes[chowNext2[index]].key]...)
				continue
			}
			if taken := take(pick.key, size); taken != nil {
				hand = append(hand, taken...)
				break
			}
		}
	}
	rng.Shuffle(len(hand), func(i, j int) { hand[i], hand[j] = hand[j], hand[i] })
	return hand
}

// TestDeficiencyAgreesWithRulesEngine pins the new block arithmetic against
// the authoritative evaluator rather than against hand-written
// expectations: a complete hand must read -1, a hand one tile away must
// read 0, and a hand the rules engine finds no wait for must read above 0.
func TestDeficiencyAgreesWithRulesEngine(t *testing.T) {
	rng := mathrand.New(mathrand.NewSource(20260814))
	for round := 0; round < 300; round++ {
		complete := buildWinningHand(t, rng)
		if !rulesengine.CanWin(complete, nil) {
			t.Fatalf("round %d: fixture is not a winning hand", round)
		}
		if got := deficiency(complete, nil); got != -1 {
			t.Fatalf("round %d: deficiency(complete hand) = %d, want -1", round, got)
		}

		// Drop one tile: the rules engine must now report a wait, and the
		// deficiency must be exactly 0.
		drop := rng.Intn(len(complete))
		waiting := append(append([]rulesengine.Tile(nil), complete[:drop]...), complete[drop+1:]...)
		waits, err := rulesengine.WinningTiles(waiting, nil)
		if err != nil {
			t.Fatalf("round %d: WinningTiles() error = %v", round, err)
		}
		if len(waits) == 0 {
			t.Fatalf("round %d: rules engine found no wait for a hand one tile from complete", round)
		}
		if got := deficiency(waiting, nil); got != 0 {
			t.Fatalf("round %d: deficiency(tenpai hand) = %d, want 0", round, got)
		}
	}
}

// TestDeficiencyPositiveWhenNoWaitExists is the other direction: whenever
// the rules engine reports no winning tile for a legal 16-tile hand, the
// deficiency must be strictly positive, and whenever it reports one the
// deficiency must be 0. Hands come from real shuffles so the sample is not
// biased toward the shapes the fixture builder happens to produce.
func TestDeficiencyPositiveWhenNoWaitExists(t *testing.T) {
	for seed := uint64(1); seed <= 400; seed++ {
		hand := dealtHand(t, seed, 16)
		waits, err := rulesengine.WinningTiles(hand, nil)
		if err != nil {
			t.Fatalf("seed %d: WinningTiles() error = %v", seed, err)
		}
		got := deficiency(hand, nil)
		if len(waits) > 0 && got != 0 {
			t.Fatalf("seed %d: rules engine reports a wait but deficiency = %d, want 0", seed, got)
		}
		if len(waits) == 0 && got <= 0 {
			t.Fatalf("seed %d: rules engine reports no wait but deficiency = %d, want > 0", seed, got)
		}
	}
}

// dealtHand draws count non-Flower tiles off a real shuffled catalog.
func dealtHand(t *testing.T, seed uint64, count int) []rulesengine.Tile {
	t.Helper()
	shuffled, err := rulesengine.ShuffledCatalog(seed)
	if err != nil {
		t.Fatalf("ShuffledCatalog(%d) error = %v", seed, err)
	}
	hand := make([]rulesengine.Tile, 0, count)
	for _, item := range shuffled {
		if item.IsFlower() {
			continue
		}
		hand = append(hand, item)
		if len(hand) == count {
			break
		}
	}
	return hand
}

// TestDeficiencyCountsExposedMelds checks that claiming melds moves the
// hand closer by the same arithmetic — an exposed set is worth exactly as
// much as a concealed one to hand distance.
func TestDeficiencyCountsExposedMelds(t *testing.T) {
	concealed := []rulesengine.Tile{
		tile("bamboo-1-1", rulesengine.Bamboo, 1, 1),
		tile("bamboo-2-1", rulesengine.Bamboo, 2, 1),
		tile("bamboo-3-1", rulesengine.Bamboo, 3, 1),
		tile("dots-5-1", rulesengine.Dots, 5, 1),
		tile("dots-5-2", rulesengine.Dots, 5, 2),
	}
	melds := []rulesengine.Meld{
		pongMeld(rulesengine.Characters, 3, false),
		pongMeld(rulesengine.Characters, 5, false),
		pongMeld(rulesengine.Characters, 7, false),
		pongMeld(rulesengine.Characters, 9, false),
	}
	// Four exposed sets, one concealed run, one pair: five sets and a pair
	// means the hand is already legal.
	if got := deficiency(concealed, melds); got != -1 {
		t.Fatalf("deficiency with four exposed melds = %d, want -1", got)
	}
	// Take the pair away and the hand is one tile short.
	if got := deficiency(concealed[:4], melds); got != 0 {
		t.Fatalf("deficiency one tile from complete = %d, want 0", got)
	}
}

// TestLiveAcceptanceRespectsUnseenBudget is the §11.2 guarantee for the new
// signal: a tile type whose four copies are all already visible cannot be
// counted as a way for the hand to improve.
func TestLiveAcceptanceRespectsUnseenBudget(t *testing.T) {
	hand := []rulesengine.Tile{
		tile("bamboo-1-1", rulesengine.Bamboo, 1, 1),
		tile("bamboo-2-1", rulesengine.Bamboo, 2, 1),
		tile("dots-5-1", rulesengine.Dots, 5, 1),
		tile("dots-5-2", rulesengine.Dots, 5, 2),
	}
	full := map[string]int{}
	for _, item := range structuralTypes {
		full[item.key] = 4
	}
	if liveAcceptance(hand, nil, full) == 0 {
		t.Fatal("liveAcceptance with every tile unseen = 0, want > 0")
	}

	empty := map[string]int{}
	for _, item := range structuralTypes {
		empty[item.key] = 0
	}
	if got := liveAcceptance(hand, nil, empty); got != 0 {
		t.Fatalf("liveAcceptance with nothing unseen = %d, want 0", got)
	}
}

// TestLiveAcceptanceIsNonzeroFarFromTenpai is the §3.2 gap this evaluator
// exists to close: effectiveDrawCount reads 0 for every hand that is not
// already tenpai, so a Speed persona would have had no signal at all for
// most of a hand.
func TestLiveAcceptanceIsNonzeroFarFromTenpai(t *testing.T) {
	hand := dealtHand(t, 7, 16)
	budget := map[string]int{}
	for _, item := range structuralTypes {
		budget[item.key] = 4
	}
	if effectiveDrawCount(hand, nil) != 0 {
		t.Skip("fixture hand happens to be tenpai; the comparison needs a hand that is not")
	}
	if got := liveAcceptance(hand, nil, budget); got == 0 {
		t.Fatal("liveAcceptance on an opening hand = 0, want > 0")
	}
}

func TestPatternFitRecognizesFlushAndPongShapes(t *testing.T) {
	flush := []rulesengine.Tile{
		tile("bamboo-1-1", rulesengine.Bamboo, 1, 1),
		tile("bamboo-2-1", rulesengine.Bamboo, 2, 1),
		tile("bamboo-3-1", rulesengine.Bamboo, 3, 1),
		tile("bamboo-4-1", rulesengine.Bamboo, 4, 1),
	}
	if got := patternFit(flush, nil, patternFullFlush); got != 1 {
		t.Fatalf("patternFit(single-suit hand, full flush) = %v, want 1", got)
	}
	mixed := append(append([]rulesengine.Tile(nil), flush...), tile("dots-9-1", rulesengine.Dots, 9, 1))
	if got := patternFit(mixed, nil, patternFullFlush); got >= 1 {
		t.Fatalf("patternFit(mixed-suit hand, full flush) = %v, want < 1", got)
	}
	if got := patternFit(mixed, nil, patternHalfFlush); got >= 1 {
		t.Fatalf("patternFit(two numbered suits, half flush) = %v, want < 1", got)
	}

	pongs := []rulesengine.Tile{
		tile("dots-5-1", rulesengine.Dots, 5, 1),
		tile("dots-5-2", rulesengine.Dots, 5, 2),
		tile("dots-7-1", rulesengine.Dots, 7, 1),
		tile("dots-7-2", rulesengine.Dots, 7, 2),
	}
	if got := patternFit(pongs, nil, patternAllPongs); got != 1 {
		t.Fatalf("patternFit(all-paired hand, all pongs) = %v, want 1", got)
	}
	runs := []rulesengine.Tile{
		tile("dots-5-1", rulesengine.Dots, 5, 1),
		tile("dots-6-1", rulesengine.Dots, 6, 1),
		tile("dots-7-1", rulesengine.Dots, 7, 1),
	}
	if got := patternFit(runs, nil, patternAllPongs); got != 0 {
		t.Fatalf("patternFit(sequence hand, all pongs) = %v, want 0", got)
	}
}

// TestPatternFeasibleRetiresADepletedTarget is the §6.4 abandonment
// threshold: a suit nobody can draw any more of is not a plan.
func TestPatternFeasibleRetiresADepletedTarget(t *testing.T) {
	obs := Observation{
		Seat:              rulesengine.East,
		Dealer:            rulesengine.East,
		PrevailingWind:    rulesengine.East,
		Hand:              dealtHand(t, 11, 16),
		DrawableRemaining: 80,
	}
	live := map[string]int{}
	for _, item := range structuralTypes {
		live[item.key] = 4
	}
	depleted := map[string]int{}
	for _, item := range structuralTypes {
		depleted[item.key] = 0
	}

	suit, _ := dominantSuit(obs.Hand, obs.Melds)
	if suit == "" {
		t.Fatal("fixture hand has no numbered suit")
	}
	if !patternFeasible(obs, patternHalfFlush, live) {
		t.Fatal("patternFeasible(half flush) = false with a full wall and every tile unseen")
	}
	if patternFeasible(obs, patternHalfFlush, depleted) {
		t.Fatal("patternFeasible(half flush) = true with no unseen tiles left")
	}
}

// TestPatternFeasibleRetiresOnAShortWall covers the other abandonment
// trigger: enough tiles remain in principle, but not enough turns.
func TestPatternFeasibleRetiresOnAShortWall(t *testing.T) {
	budget := map[string]int{}
	for _, item := range structuralTypes {
		budget[item.key] = 4
	}
	obs := Observation{
		Seat:              rulesengine.East,
		Dealer:            rulesengine.East,
		PrevailingWind:    rulesengine.East,
		Hand:              dealtHand(t, 11, 16),
		DrawableRemaining: 4, // one personal draw left
	}
	if patternFeasible(obs, patternFullFlush, budget) {
		t.Fatal("patternFeasible(full flush) = true with a single personal draw remaining")
	}
}

func BenchmarkDeficiency(b *testing.B) {
	shuffled, err := rulesengine.ShuffledCatalog(42)
	if err != nil {
		b.Fatalf("ShuffledCatalog() error = %v", err)
	}
	hand := make([]rulesengine.Tile, 0, 16)
	for _, item := range shuffled {
		if item.IsFlower() {
			continue
		}
		hand = append(hand, item)
		if len(hand) == 16 {
			break
		}
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		deficiency(hand, nil)
	}
}

func BenchmarkLiveAcceptance(b *testing.B) {
	shuffled, err := rulesengine.ShuffledCatalog(42)
	if err != nil {
		b.Fatalf("ShuffledCatalog() error = %v", err)
	}
	hand := make([]rulesengine.Tile, 0, 16)
	for _, item := range shuffled {
		if item.IsFlower() {
			continue
		}
		hand = append(hand, item)
		if len(hand) == 16 {
			break
		}
	}
	budget := map[string]int{}
	for _, item := range structuralTypes {
		budget[item.key] = 4
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		liveAcceptance(hand, nil, budget)
	}
}

// TestEfficientDiscardsPrefersTheUselessTile is the property the tile
// efficiency statistic rests on: throwing away the tile that contributes
// nothing must score as efficient, and breaking a finished set must not.
func TestEfficientDiscardsPrefersTheUselessTile(t *testing.T) {
	hand := []rulesengine.Tile{
		// A completed run.
		tile("bamboo-2-1", rulesengine.Bamboo, 2, 1),
		tile("bamboo-3-1", rulesengine.Bamboo, 3, 1),
		tile("bamboo-4-1", rulesengine.Bamboo, 4, 1),
		// A pair.
		tile("dots-5-1", rulesengine.Dots, 5, 1),
		tile("dots-5-2", rulesengine.Dots, 5, 2),
		// An isolated honor with nothing near it.
		tile("wind-north-1", rulesengine.Wind, 0, 1),
	}
	best := EfficientDiscards(hand, nil)
	if !best["wind-north-1"] {
		t.Fatalf("the isolated honor was not considered an efficient discard: %v", best)
	}
	for _, held := range []string{"bamboo-3-1", "dots-5-1"} {
		if best[held] {
			t.Errorf("breaking a useful block (%s) scored as efficient: %v", held, best)
		}
	}
}

func TestEfficientDiscardsNeverNamesAnIllegalDiscard(t *testing.T) {
	hand := append(dealtHand(t, 5, 16), rulesengine.Tile{ID: "flower-plum", Kind: rulesengine.Flower})
	legal := map[string]bool{}
	for _, item := range legalDiscards(hand) {
		legal[item.ID] = true
	}
	best := EfficientDiscards(hand, nil)
	if len(best) == 0 {
		t.Fatal("no efficient discard was identified for a full hand")
	}
	for id := range best {
		if !legal[id] {
			t.Fatalf("named %q, which is not a legal discard", id)
		}
	}
}

// A hand already one tile away should keep it that way: every named discard
// must leave the hand still waiting, never break it open.
func TestEfficientDiscardsHoldsATenpaiHand(t *testing.T) {
	complete := buildWinningHand(t, mathrand.New(mathrand.NewSource(4)))
	// Drop one tile to reach tenpai, then add an unrelated floater the
	// reference should shed to get back there.
	waiting := append([]rulesengine.Tile(nil), complete[:len(complete)-1]...)
	floater := rulesengine.Tile{}
	for _, item := range rulesengine.Catalog() {
		if item.IsFlower() {
			continue
		}
		used := false
		for _, held := range waiting {
			if held.ID == item.ID || sameTileType(held, item) {
				used = true
				break
			}
		}
		if !used {
			floater = item
			break
		}
	}
	if floater.ID == "" {
		t.Skip("fixture hand left no unrelated tile to add")
	}
	hand := append(append([]rulesengine.Tile(nil), waiting...), floater)

	best := EfficientDiscards(hand, nil)
	if len(best) == 0 {
		t.Fatal("no efficient discard identified")
	}
	for id := range best {
		remaining := withoutTile(hand, id)
		if got := deficiency(remaining, nil); got != 0 {
			t.Fatalf("discarding %q left the hand at distance %d, not still waiting", id, got)
		}
	}
}

func BenchmarkEfficientDiscards(b *testing.B) {
	shuffled, err := rulesengine.ShuffledCatalog(42)
	if err != nil {
		b.Fatalf("ShuffledCatalog() error = %v", err)
	}
	hand := make([]rulesengine.Tile, 0, 17)
	for _, item := range shuffled {
		if item.IsFlower() {
			continue
		}
		hand = append(hand, item)
		if len(hand) == 17 {
			break
		}
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		EfficientDiscards(hand, nil)
	}
}
