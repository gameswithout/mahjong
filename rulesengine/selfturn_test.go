package rulesengine

import (
	"errors"
	"testing"
	"time"
)

// dealWithFront builds a DealState whose wall front draws follow frontIDs
// exactly. All Flowers sit immediately after the requested front tiles, so
// back-of-wall replacement draws in short tests are never Flowers. Player
// hands start empty; tests assign them directly.
func dealWithFront(t *testing.T, frontIDs ...string) *DealState {
	t.Helper()
	catalog := Catalog()
	byID := map[string]Tile{}
	for _, item := range catalog {
		byID[item.ID] = item
	}
	used := map[string]bool{}
	tiles := make([]Tile, 0, len(catalog))
	for _, id := range frontIDs {
		item, ok := byID[id]
		if !ok || used[id] {
			t.Fatalf("front tile %q is unknown or duplicated", id)
		}
		used[id] = true
		tiles = append(tiles, item)
	}
	for _, item := range catalog {
		if item.IsFlower() && !used[item.ID] {
			used[item.ID] = true
			tiles = append(tiles, item)
		}
	}
	for _, item := range catalog {
		if !used[item.ID] {
			tiles = append(tiles, item)
		}
	}
	wall, err := NewWall(tiles, ReserveTileCount)
	if err != nil {
		t.Fatalf("NewWall() error = %v", err)
	}
	players := make([]PlayerState, len(seats))
	for index, seat := range seats {
		players[index] = PlayerState{Seat: seat, Hand: []Tile{}, Exposed: []Tile{}, Melds: []Meld{}}
	}
	return &DealState{
		Seed:        1,
		Dice:        [2]uint8{2, 3},
		CatalogHash: CatalogHash(),
		WallHash:    hashTiles(tiles),
		Players:     players,
		Wall:        wall,
	}
}

func fixedClockEngine(t *testing.T, state *DealState) *TurnEngine {
	t.Helper()
	clock := time.Date(2026, 7, 18, 4, 5, 6, 0, time.UTC)
	engine, err := NewTurnEngine(state, func() time.Time { return clock })
	if err != nil {
		t.Fatalf("NewTurnEngine() error = %v", err)
	}
	return engine
}

func concealedPongTiles(kind TileKind, rank uint8) []Tile {
	name := string(kind)
	return []Tile{
		tile(tileIDFor(name, rank, 1), kind, rank, 1),
		tile(tileIDFor(name, rank, 2), kind, rank, 2),
		tile(tileIDFor(name, rank, 3), kind, rank, 3),
	}
}

func tileIDFor(kind string, rank, copyNumber uint8) string {
	return kind + "-" + string(rune('0'+rank)) + "-" + string(rune('0'+copyNumber))
}

// junkHand17 is a 17-tile East hand with no winning structure.
func junkHand17() []Tile {
	return []Tile{
		tile("wind-east-1", Wind, 0, 1),
		tile("wind-south-1", Wind, 0, 1),
		tile("wind-west-1", Wind, 0, 1),
		tile("wind-north-1", Wind, 0, 1),
		tile("dragon-red-1", Dragon, 0, 1),
		tile("dragon-green-1", Dragon, 0, 1),
		tile("dragon-white-1", Dragon, 0, 1),
		tile("characters-9-4", Characters, 9, 4),
		tile("characters-7-1", Characters, 7, 1),
		tile("bamboo-9-4", Bamboo, 9, 4),
		tile("bamboo-7-4", Bamboo, 7, 4),
		tile("dots-9-1", Dots, 9, 1),
		tile("dots-7-4", Dots, 7, 4),
		tile("characters-4-4", Characters, 4, 4),
		tile("bamboo-4-4", Bamboo, 4, 4),
		tile("dots-4-4", Dots, 4, 4),
		tile("dots-1-4", Dots, 1, 4),
	}
}

func passAllClaims(t *testing.T, engine *TurnEngine, window *ClaimWindow) {
	t.Helper()
	for _, seat := range window.Eligible {
		if err := engine.SubmitClaim(ClaimResponse{Seat: seat, Type: ClaimPass, StateVersion: window.StateVersion}); err != nil {
			t.Fatalf("pass for %s error = %v", seat, err)
		}
	}
	if _, err := engine.ResolveClaims(window.StateVersion); err != nil {
		t.Fatalf("ResolveClaims() error = %v", err)
	}
}

func TestZimoOnFirstDrawScoresEarthlyAndConcealedZimo(t *testing.T) {
	state := dealWithFront(t, "dots-5-2")
	state.Players[0].Hand = junkHand17()
	state.Players[1].Hand = append(append(append(
		concealedPongTiles(Characters, 1),
		concealedPongTiles(Characters, 2)...),
		concealedPongTiles(Characters, 3)...),
		append(concealedPongTiles(Bamboo, 1),
			append(concealedPongTiles(Bamboo, 2), tile("dots-5-1", Dots, 5, 1))...)...)
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	window, err := engine.Discard(engine.Version, East, "dots-9-1")
	if err != nil {
		t.Fatalf("Discard() error = %v", err)
	}
	passAllClaims(t, engine, window)
	if engine.Phase != PhaseAwaitingDraw || engine.ActiveSeat != South {
		t.Fatalf("phase = %s, active = %s", engine.Phase, engine.ActiveSeat)
	}
	draw, err := engine.Draw(engine.Version)
	if err != nil {
		t.Fatalf("Draw() error = %v", err)
	}
	if draw.Tile.ID != "dots-5-2" {
		t.Fatalf("drawn tile = %s, want dots-5-2", draw.Tile.ID)
	}
	result, err := engine.DeclareZimo(engine.Version, South)
	if err != nil {
		t.Fatalf("DeclareZimo() error = %v", err)
	}
	if result.Kind != WinZimo || len(result.Winners) != 1 || engine.Phase != PhaseHandComplete {
		t.Fatalf("result = %#v, phase = %s", result, engine.Phase)
	}
	winner := result.Winners[0]
	if !winner.Context.EarthlyHand || !winner.Context.Zimo || !winner.Context.SingleWait {
		t.Fatalf("context = %#v", winner.Context)
	}
	wantTai := map[string]int{
		"Base Win":             1,
		"Earthly Hand":         16,
		"Concealed Zimo":       3,
		"Single Wait":          1,
		"Five Concealed Pongs": 8,
		"All Pongs":            4,
		"No Honors or Flowers": 2,
	}
	assertPatterns(t, winner.Score, wantTai, 35)
}

func TestConcealedKongDrawsReplacementAndKeepsTurn(t *testing.T) {
	state := dealWithFront(t)
	hand := junkHand17()[:13]
	hand = append(hand,
		tile("characters-5-1", Characters, 5, 1),
		tile("characters-5-2", Characters, 5, 2),
		tile("characters-5-3", Characters, 5, 3),
		tile("characters-5-4", Characters, 5, 4),
	)
	state.Players[0].Hand = hand
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	draw, err := engine.DeclareConcealedKong(engine.Version, East, []string{"characters-5-1"})
	if err != nil {
		t.Fatalf("DeclareConcealedKong() error = %v", err)
	}
	if !draw.Replacement || draw.Tile.ID == "" || draw.Tile.IsFlower() {
		t.Fatalf("replacement draw = %#v", draw)
	}
	player := state.Players[0]
	if len(player.Hand) != 14 || len(player.Melds) != 1 {
		t.Fatalf("hand = %d tiles, melds = %d", len(player.Hand), len(player.Melds))
	}
	meld := player.Melds[0]
	if meld.Type != MeldKong || !meld.Concealed || len(meld.Tiles) != 4 {
		t.Fatalf("meld = %#v", meld)
	}
	if engine.Phase != PhaseAwaitingDiscard || engine.ActiveSeat != East {
		t.Fatalf("phase = %s, active = %s", engine.Phase, engine.ActiveSeat)
	}
	if engine.lastDraw == nil || !engine.lastDraw.Replacement {
		t.Fatalf("lastDraw = %#v", engine.lastDraw)
	}
	if !engine.claimsOccurred {
		t.Fatal("concealed Kong did not clear Earthly eligibility")
	}
}

func addedKongFixture(t *testing.T) (*DealState, *TurnEngine) {
	t.Helper()
	state := dealWithFront(t)
	eastHand := junkHand17()[:13]
	eastHand = append(eastHand, tile("characters-7-4", Characters, 7, 4))
	state.Players[0].Hand = eastHand
	state.Players[0].Melds = []Meld{{
		Type: MeldPong,
		Tiles: []Tile{
			tile("characters-7-1", Characters, 7, 1),
			tile("characters-7-2", Characters, 7, 2),
			tile("characters-7-3", Characters, 7, 3),
		},
		Claimed: true,
	}}
	// West completes a Chow with the added characters-7 tile.
	state.Players[2].Hand = []Tile{
		tile("characters-5-1", Characters, 5, 1),
		tile("characters-6-1", Characters, 6, 1),
		tile("dots-5-1", Dots, 5, 1),
		tile("dots-5-2", Dots, 5, 2),
	}
	state.Players[2].Melds = []Meld{
		pongMeld(Bamboo, 1),
		pongMeld(Bamboo, 2),
		pongMeld(Bamboo, 3),
		pongMeld(Dots, 1),
	}
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	return state, engine
}

func TestAddedKongCanBeRobbed(t *testing.T) {
	state, engine := addedKongFixture(t)
	window, err := engine.DeclareAddedKong(engine.Version, East, "characters-7-4")
	if err != nil {
		t.Fatalf("DeclareAddedKong() error = %v", err)
	}
	if engine.Phase != PhaseRobWindow || len(window.Eligible) != 3 {
		t.Fatalf("phase = %s, window = %#v", engine.Phase, window)
	}
	if err := engine.SubmitRobResponse(RobResponse{Seat: West, Win: true, StateVersion: window.StateVersion}); err != nil {
		t.Fatalf("West rob error = %v", err)
	}
	for _, seat := range []Seat{South, North} {
		if err := engine.SubmitRobResponse(RobResponse{Seat: seat, StateVersion: window.StateVersion}); err != nil {
			t.Fatalf("%s pass error = %v", seat, err)
		}
	}
	result, err := engine.ResolveRob(window.StateVersion)
	if err != nil {
		t.Fatalf("ResolveRob() error = %v", err)
	}
	if result == nil || result.Kind != WinRob || result.Payer != East ||
		len(result.Winners) != 1 || result.Winners[0].Seat != West {
		t.Fatalf("result = %#v", result)
	}
	if !result.Winners[0].Context.RobbedAddedKong || !hasPattern(result.Winners[0].Score.Patterns, "Robbing an Added Kong") {
		t.Fatalf("winner = %#v", result.Winners[0])
	}
	east := state.Players[0]
	if len(east.Melds) != 1 || east.Melds[0].Type != MeldPong || len(east.Melds[0].Tiles) != 3 {
		t.Fatalf("declarer meld = %#v", east.Melds[0])
	}
	for _, item := range east.Hand {
		if item.ID == "characters-7-4" {
			t.Fatal("robbed tile is still in the declarer's hand")
		}
	}
	if engine.Phase != PhaseHandComplete {
		t.Fatalf("phase = %s", engine.Phase)
	}
}

func TestAddedKongCompletesWhenNobodyRobs(t *testing.T) {
	state, engine := addedKongFixture(t)
	window, err := engine.DeclareAddedKong(engine.Version, East, "characters-7-4")
	if err != nil {
		t.Fatalf("DeclareAddedKong() error = %v", err)
	}
	for _, seat := range window.Eligible {
		if err := engine.SubmitRobResponse(RobResponse{Seat: seat, StateVersion: window.StateVersion}); err != nil {
			t.Fatalf("%s pass error = %v", seat, err)
		}
	}
	result, err := engine.ResolveRob(window.StateVersion)
	if err != nil {
		t.Fatalf("ResolveRob() error = %v", err)
	}
	if result != nil {
		t.Fatalf("unexpected hand result = %#v", result)
	}
	east := state.Players[0]
	meld := east.Melds[0]
	if meld.Type != MeldKong || !meld.Added || len(meld.Tiles) != 4 {
		t.Fatalf("meld after Kong = %#v", meld)
	}
	// 14 - the added tile + replacement draw keeps the count at 14.
	if len(east.Hand) != 14 {
		t.Fatalf("declarer hand = %d tiles", len(east.Hand))
	}
	if engine.Phase != PhaseAwaitingDiscard || engine.ActiveSeat != East {
		t.Fatalf("phase = %s, active = %s", engine.Phase, engine.ActiveSeat)
	}
	if engine.lastDraw == nil || !engine.lastDraw.Replacement {
		t.Fatalf("lastDraw = %#v", engine.lastDraw)
	}
}

func TestHeavenlyOfferAcceptStacksConcealedAndStructure(t *testing.T) {
	state := dealWithFront(t)
	state.Players[0].Hand = append(append(append(
		concealedPongTiles(Characters, 1),
		concealedPongTiles(Characters, 2)...),
		concealedPongTiles(Characters, 3)...),
		append(concealedPongTiles(Bamboo, 1),
			append(concealedPongTiles(Bamboo, 2),
				tile("dots-5-1", Dots, 5, 1), tile("dots-5-2", Dots, 5, 2))...)...)
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	offer := engine.Offer()
	if engine.Phase != PhaseOfferPending || offer == nil || offer.Type != OfferHeavenly || offer.Seat != East {
		t.Fatalf("phase = %s, offer = %#v", engine.Phase, offer)
	}
	result, err := engine.RespondOffer(engine.Version, East, true)
	if err != nil {
		t.Fatalf("RespondOffer() error = %v", err)
	}
	if result.Kind != WinHeavenly || len(result.Winners) != 1 {
		t.Fatalf("result = %#v", result)
	}
	wantTai := map[string]int{
		"Base Win":             1,
		"Heavenly Hand":        24,
		"Concealed":            1,
		"Five Concealed Pongs": 8,
		"All Pongs":            4,
		"No Honors or Flowers": 2,
	}
	assertPatterns(t, result.Winners[0].Score, wantTai, 40)
	if hasPattern(result.Winners[0].Score.Patterns, "Zimo") || hasPattern(result.Winners[0].Score.Patterns, "Concealed Zimo") {
		t.Fatalf("Heavenly must not stack with Zimo: %#v", result.Winners[0].Score.Patterns)
	}
}

func TestHeavenlyOfferDeclineLapsesPermanently(t *testing.T) {
	state := dealWithFront(t)
	state.Players[0].Hand = append(append(append(
		concealedPongTiles(Characters, 1),
		concealedPongTiles(Characters, 2)...),
		concealedPongTiles(Characters, 3)...),
		append(concealedPongTiles(Bamboo, 1),
			append(concealedPongTiles(Bamboo, 2),
				tile("dots-5-1", Dots, 5, 1), tile("dots-5-2", Dots, 5, 2))...)...)
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	result, err := engine.RespondOffer(engine.Version, East, false)
	if err != nil {
		t.Fatalf("RespondOffer() error = %v", err)
	}
	if result != nil || engine.Phase != PhaseAwaitingDiscard || !engine.heavenlyLapsed {
		t.Fatalf("result = %#v, phase = %s, lapsed = %t", result, engine.Phase, engine.heavenlyLapsed)
	}
	if engine.IsWinLocked(East) {
		t.Fatal("declining Heavenly must not create a §5.8 lock")
	}
}

func TestEightFlowersOfferDuringInitialReplacement(t *testing.T) {
	state := dealWithFront(t)
	hand := make([]Tile, 0, 17)
	for _, name := range []string{"spring", "summer", "autumn", "winter", "plum", "orchid", "chrysanthemum", "bamboo"} {
		hand = append(hand, tile("flower-"+name, Flower, 0, 1))
	}
	hand = append(hand, junkHand17()[:9]...)
	state.Players[0].Hand = hand
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	offer := engine.Offer()
	if engine.Phase != PhaseOfferPending || offer == nil || offer.Type != OfferEightFlowers || offer.Seat != East || offer.ResumeIndex != 1 {
		t.Fatalf("phase = %s, offer = %#v", engine.Phase, offer)
	}
	result, err := engine.RespondOffer(engine.Version, East, true)
	if err != nil {
		t.Fatalf("RespondOffer() error = %v", err)
	}
	if result.Kind != WinEightFlowers || result.Winners[0].Score.RawTai != 15 {
		t.Fatalf("result = %#v", result)
	}
}

func TestEightFlowersDeclineResumesReplacementAndReoffers(t *testing.T) {
	state := dealWithFront(t, "dots-2-1", "dots-2-2", "dots-2-3", "dots-2-4")
	hand := make([]Tile, 0, 17)
	for _, name := range []string{"spring", "summer", "autumn", "winter", "plum", "orchid", "chrysanthemum", "bamboo"} {
		hand = append(hand, tile("flower-"+name, Flower, 0, 1))
	}
	hand = append(hand, junkHand17()[:9]...)
	state.Players[0].Hand = hand
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	result, err := engine.RespondOffer(engine.Version, East, false)
	if err != nil {
		t.Fatalf("RespondOffer() error = %v", err)
	}
	if result != nil || engine.Phase != PhaseAwaitingDiscard {
		t.Fatalf("result = %#v, phase = %s", result, engine.Phase)
	}
	// The offer reappears on East's next turn: discard, everyone passes the
	// claim and the rotation returns to East, whose draw re-raises the offer.
	window, err := engine.Discard(engine.Version, East, "wind-east-1")
	if err != nil {
		t.Fatalf("Discard() error = %v", err)
	}
	passAllClaims(t, engine, window)
	for _, seat := range []Seat{South, West, North} {
		if _, err := engine.Draw(engine.Version); err != nil {
			t.Fatalf("draw for %s error = %v", seat, err)
		}
		drawn := ""
		for _, item := range state.Players[seatIndex(seat)].Hand {
			drawn = item.ID
			break
		}
		window, err := engine.Discard(engine.Version, seat, drawn)
		if err != nil {
			t.Fatalf("discard for %s error = %v", seat, err)
		}
		passAllClaims(t, engine, window)
	}
	if engine.ActiveSeat != East || engine.Phase != PhaseAwaitingDraw {
		t.Fatalf("phase = %s, active = %s", engine.Phase, engine.ActiveSeat)
	}
	if _, err := engine.Draw(engine.Version); err != nil {
		t.Fatalf("East redraw error = %v", err)
	}
	offer := engine.Offer()
	if engine.Phase != PhaseOfferPending || offer == nil || offer.Type != OfferEightFlowers || offer.ResumeIndex != -1 {
		t.Fatalf("re-offer = %#v, phase = %s", offer, engine.Phase)
	}
}

func TestLastTileZimoFlagFromFrontDraw(t *testing.T) {
	state := dealWithFront(t, "dots-5-2")
	state.Players[0].Hand = junkHand17()
	state.Players[1].Hand = append(append(append(
		concealedPongTiles(Characters, 1),
		concealedPongTiles(Characters, 2)...),
		concealedPongTiles(Characters, 3)...),
		append(concealedPongTiles(Bamboo, 1),
			append(concealedPongTiles(Bamboo, 2), tile("dots-5-1", Dots, 5, 1))...)...)
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	window, err := engine.Discard(engine.Version, East, "dots-9-1")
	if err != nil {
		t.Fatalf("Discard() error = %v", err)
	}
	passAllClaims(t, engine, window)
	// Drain the wall so the next front draw is the final drawable tile.
	for state.Wall.DrawableRemaining() > 1 {
		if _, err := state.Wall.DrawFront(); err != nil {
			t.Fatalf("drain error = %v", err)
		}
	}
	// The remaining front tile is no longer dots-5-2 after draining, so
	// rebuild the expectation from the engine's own draw.
	draw, err := engine.Draw(engine.Version)
	if err != nil {
		t.Fatalf("Draw() error = %v", err)
	}
	if engine.lastDraw == nil || !engine.lastDraw.LastTile {
		t.Fatalf("lastDraw = %#v after draw %#v", engine.lastDraw, draw)
	}
}

func TestFullyExposedSuppressesSingleWait(t *testing.T) {
	player := PlayerState{
		Seat: West,
		Hand: []Tile{tile("dots-5-1", Dots, 5, 1)},
		Melds: []Meld{
			pongMeld(Bamboo, 1),
			pongMeld(Bamboo, 2),
			pongMeld(Bamboo, 3),
			pongMeld(Dots, 1),
			pongMeld(Characters, 1),
		},
	}
	result, err := ScoreWinningDiscard(player, tile("dots-5-2", Dots, 5, 2), ScoreContext{Seat: West, SingleWait: true})
	if err != nil {
		t.Fatalf("ScoreWinningDiscard() error = %v", err)
	}
	if !result.Winning || !hasPattern(result.Patterns, "Fully Exposed") {
		t.Fatalf("result = %#v", result)
	}
	if hasPattern(result.Patterns, "Single Wait") {
		t.Fatalf("Fully Exposed must suppress Single Wait: %#v", result.Patterns)
	}
}

func TestSelfTurnSnapshotRoundTripPreservesHash(t *testing.T) {
	_, engine := addedKongFixture(t)
	if _, err := engine.DeclareAddedKong(engine.Version, East, "characters-7-4"); err != nil {
		t.Fatalf("DeclareAddedKong() error = %v", err)
	}
	if err := engine.SubmitRobResponse(RobResponse{Seat: South, StateVersion: engine.rob.StateVersion}); err != nil {
		t.Fatalf("SubmitRobResponse() error = %v", err)
	}
	encoded, err := snapshotBytes(engine)
	if err != nil {
		t.Fatalf("snapshotBytes() error = %v", err)
	}
	restored, err := engineFromSnapshot(encoded, engine.now)
	if err != nil {
		t.Fatalf("engineFromSnapshot() error = %v", err)
	}
	originalHash, err := stateHash(engine)
	if err != nil {
		t.Fatalf("stateHash() error = %v", err)
	}
	restoredHash, err := stateHash(restored)
	if err != nil {
		t.Fatalf("restored stateHash() error = %v", err)
	}
	if originalHash != restoredHash {
		t.Fatal("snapshot round trip changed the state hash")
	}
	if restored.rob == nil || len(restored.rob.Responses) != 1 || restored.lastDraw != nil {
		t.Fatalf("restored rob = %#v", restored.rob)
	}
}

func TestZimoRejectsWithoutOwnDraw(t *testing.T) {
	state := dealWithFront(t)
	state.Players[0].Hand = junkHand17()
	engine := fixedClockEngine(t, state)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	if _, err := engine.DeclareZimo(engine.Version, East); !errors.Is(err, ErrTurnState) {
		t.Fatalf("DeclareZimo() error = %v, want ErrTurnState", err)
	}
}

func assertPatterns(t *testing.T, result ScoreResult, want map[string]int, wantTotal int) {
	t.Helper()
	got := map[string]int{}
	for _, pattern := range result.Patterns {
		got[pattern.Name] += pattern.Tai
	}
	for name, tai := range want {
		if got[name] != tai {
			t.Fatalf("pattern %q = %d Tai, want %d (all: %#v)", name, got[name], tai, result.Patterns)
		}
	}
	if result.RawTai != wantTotal {
		t.Fatalf("raw Tai = %d, want %d (patterns: %#v)", result.RawTai, wantTotal, result.Patterns)
	}
}

func seatIndex(seat Seat) int {
	for index, item := range seats {
		if item == seat {
			return index
		}
	}
	return -1
}
