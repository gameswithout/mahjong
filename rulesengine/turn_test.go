package rulesengine

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestTurnEngineInitialDiscardAndAdvanceAfterPrivatePasses(t *testing.T) {
	state := turnFixture(t)
	clock := time.Date(2026, 7, 18, 1, 2, 3, 0, time.UTC)
	engine, err := NewTurnEngine(state, func() time.Time { return clock }, nil)
	if err != nil {
		t.Fatalf("NewTurnEngine() error = %v", err)
	}
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	if engine.Phase != PhaseAwaitingDiscard || engine.Version != 2 {
		t.Fatalf("after setup = phase %s version %d", engine.Phase, engine.Version)
	}
	if _, err := engine.Discard(1, East, "characters-1-1"); !errors.Is(err, ErrStaleAction) {
		t.Fatalf("stale Discard() error = %v", err)
	}

	window, err := engine.Discard(engine.Version, East, "characters-1-1")
	if err != nil {
		t.Fatalf("Discard() error = %v", err)
	}
	for _, seat := range []Seat{South, West, North} {
		if err := engine.SubmitClaim(ClaimResponse{
			Seat:             seat,
			Type:             ClaimPass,
			StateVersion:     window.StateVersion,
			ResponseRevision: 0,
		}); err != nil {
			t.Fatalf("SubmitClaim(%s) error = %v", seat, err)
		}
	}
	resolution, err := engine.ResolveClaims(window.StateVersion)
	if err != nil {
		t.Fatalf("ResolveClaims() error = %v", err)
	}
	if resolution.Type != "" || resolution.NextSeat != South || engine.ActiveSeat != South || engine.Phase != PhaseAwaitingDraw {
		t.Fatalf("resolution = %#v, engine = %#v", resolution, engine.Snapshot())
	}
	if engine.Version != window.StateVersion+1 {
		t.Fatalf("version = %d, want %d", engine.Version, window.StateVersion+1)
	}
}

func TestTurnEngineDrawRunsChainedFlowerReplacement(t *testing.T) {
	state := turnFixture(t)
	state.Wall.tiles[state.Wall.front] = tile("flower-spring", Flower, 0, 0)
	state.Wall.tiles[len(state.Wall.tiles)-1] = tile("dots-9-4", Dots, 9, 4)
	engine := newTurnForClaims(t, state, nil)
	engine.Phase = PhaseAwaitingDraw
	drawableBefore := state.Wall.DrawableRemaining()
	result, err := engine.Draw(engine.Version)
	if err != nil {
		t.Fatalf("Draw() error = %v", err)
	}
	if !result.Replacement || result.Tile.IsFlower() || engine.Phase != PhaseAwaitingDiscard {
		t.Fatalf("replacement result = %#v, phase = %s", result, engine.Phase)
	}
	// The front draw and its back replacement each consume one drawable tile.
	if len(state.Players[0].Exposed) != 1 || state.Wall.DrawableRemaining() != drawableBefore-2 {
		t.Fatalf("East exposed/drawable = %d/%d", len(state.Players[0].Exposed), state.Wall.DrawableRemaining())
	}
}

func TestTurnEngineClaimPriorityChoosesPongBeforeChow(t *testing.T) {
	state := turnFixture(t)
	state.Players[0].Hand = []Tile{tile("characters-2-1", Characters, 2, 1)}
	state.Players[1].Hand = []Tile{
		tile("characters-1-1", Characters, 1, 1),
		tile("characters-3-1", Characters, 3, 1),
	}
	state.Players[2].Hand = []Tile{
		tile("characters-2-2", Characters, 2, 2),
		tile("characters-2-3", Characters, 2, 3),
	}
	engine := newTurnForClaims(t, state, nil)
	window := discardForClaims(t, engine, "characters-2-1")

	if err := engine.SubmitClaim(ClaimResponse{
		Seat: South, Type: ClaimChow, TileIDs: []string{"characters-1-1", "characters-3-1"}, StateVersion: window.StateVersion,
	}); err != nil {
		t.Fatalf("South Chow error = %v", err)
	}
	if err := engine.SubmitClaim(ClaimResponse{
		Seat: West, Type: ClaimPong, TileIDs: []string{"characters-2-2", "characters-2-3"}, StateVersion: window.StateVersion,
	}); err != nil {
		t.Fatalf("West Pong error = %v", err)
	}
	if err := engine.SubmitClaim(ClaimResponse{Seat: North, Type: ClaimPass, StateVersion: window.StateVersion}); err != nil {
		t.Fatalf("North Pass error = %v", err)
	}

	resolution, err := engine.ResolveClaims(window.StateVersion)
	if err != nil {
		t.Fatalf("ResolveClaims() error = %v", err)
	}
	if resolution.Type != ClaimPong || resolution.Claimant != West || engine.ActiveSeat != West || engine.Phase != PhaseAwaitingDiscard {
		t.Fatalf("resolution = %#v, engine = %#v", resolution, engine.Snapshot())
	}
	if len(state.Players[2].Hand) != 0 || len(state.Players[2].Exposed) != 3 {
		t.Fatalf("West hand/exposed = %d/%d", len(state.Players[2].Hand), len(state.Players[2].Exposed))
	}
}

func TestTurnEngineChowClaimAppliesExposedMeld(t *testing.T) {
	state := turnFixture(t)
	state.Players[0].Hand = []Tile{tile("characters-2-1", Characters, 2, 1)}
	state.Players[1].Hand = []Tile{
		tile("characters-1-1", Characters, 1, 1),
		tile("characters-3-1", Characters, 3, 1),
	}
	engine := newTurnForClaims(t, state, nil)
	window := discardForClaims(t, engine, "characters-2-1")
	if err := engine.SubmitClaim(ClaimResponse{
		Seat:         South,
		Type:         ClaimChow,
		TileIDs:      []string{"characters-1-1", "characters-3-1"},
		StateVersion: window.StateVersion,
	}); err != nil {
		t.Fatalf("South Chow error = %v", err)
	}
	for _, seat := range []Seat{West, North} {
		if err := engine.SubmitClaim(ClaimResponse{
			Seat: seat, Type: ClaimPass, StateVersion: window.StateVersion,
		}); err != nil {
			t.Fatalf("%s Pass error = %v", seat, err)
		}
	}

	resolution, err := engine.ResolveClaims(window.StateVersion)
	if err != nil {
		t.Fatalf("ResolveClaims() error = %v", err)
	}
	south := state.Players[1]
	if resolution.Type != ClaimChow || resolution.Claimant != South ||
		engine.ActiveSeat != South || engine.Phase != PhaseAwaitingDiscard {
		t.Fatalf("resolution = %#v, engine = %#v", resolution, engine.Snapshot())
	}
	if len(south.Hand) != 0 || len(south.Exposed) != 3 || len(south.Melds) != 1 ||
		south.Melds[0].Type != MeldChow || !south.Melds[0].Claimed {
		t.Fatalf("South after Chow = %#v", south)
	}
}

func TestTurnEngineWinClaimsAndDeliberatePassLock(t *testing.T) {
	state := turnFixture(t)
	// West gets a real completable hand: four claimed Pongs plus
	// characters-1 wait, so the win path can be scored after resolution.
	state.Players[2].Hand = []Tile{
		tile("characters-1-3", Characters, 1, 3),
		tile("characters-1-4", Characters, 1, 4),
		tile("dots-5-1", Dots, 5, 1),
		tile("dots-5-2", Dots, 5, 2),
	}
	state.Players[2].Melds = []Meld{
		pongMeld(Bamboo, 1),
		pongMeld(Bamboo, 2),
		pongMeld(Bamboo, 3),
		pongMeld(Dots, 1),
	}
	validator := func(_ *DealState, seat Seat, _ Tile) bool {
		return seat == South || seat == West
	}
	engine := newTurnForClaims(t, state, validator)
	window := discardForClaims(t, engine, "characters-1-1")
	if err := engine.SubmitClaim(ClaimResponse{Seat: South, Type: ClaimPass, Deliberate: true, StateVersion: window.StateVersion}); err != nil {
		t.Fatalf("deliberate Pass error = %v", err)
	}
	if !engine.IsWinLocked(South) {
		t.Fatal("deliberate Win pass did not create a lock")
	}
	if err := engine.SubmitClaim(ClaimResponse{Seat: West, Type: ClaimWin, StateVersion: window.StateVersion}); err != nil {
		t.Fatalf("West Win error = %v", err)
	}
	if err := engine.SubmitClaim(ClaimResponse{Seat: North, Type: ClaimPass, StateVersion: window.StateVersion}); err != nil {
		t.Fatalf("North Pass error = %v", err)
	}
	resolution, err := engine.ResolveClaims(window.StateVersion)
	if err != nil {
		t.Fatalf("ResolveClaims() error = %v", err)
	}
	if resolution.Type != ClaimWin || len(resolution.Winners) != 1 || resolution.Winners[0] != West || engine.Phase != PhaseHandComplete {
		t.Fatalf("resolution = %#v, phase = %s", resolution, engine.Phase)
	}
	result := engine.Result()
	if result == nil || result.Kind != WinDiscard || result.Payer != East ||
		len(result.Winners) != 1 || result.Winners[0].Seat != West || !result.Winners[0].Score.Winning {
		t.Fatalf("hand result = %#v", result)
	}
}

func pongMeld(kind TileKind, rank uint8) Meld {
	name := string(kind)
	tiles := []Tile{
		tile(fmt.Sprintf("%s-%d-1", name, rank), kind, rank, 1),
		tile(fmt.Sprintf("%s-%d-2", name, rank), kind, rank, 2),
		tile(fmt.Sprintf("%s-%d-3", name, rank), kind, rank, 3),
	}
	return Meld{Type: MeldPong, Tiles: tiles, Claimed: true}
}

func TestTurnEngineRejectsDuplicateAndLateClaimResponses(t *testing.T) {
	state := turnFixture(t)
	clock := time.Date(2026, 7, 18, 1, 2, 3, 0, time.UTC)
	engine := newTurnForClaimsWithClock(t, state, nil, &clock)
	window := discardForClaims(t, engine, "characters-1-1")
	if err := engine.SubmitClaim(ClaimResponse{ActionID: "stale-action", Seat: South, Type: ClaimPass, StateVersion: window.StateVersion}); !errors.Is(err, ErrStaleAction) {
		t.Fatalf("stale action ID error = %v", err)
	}
	response := ClaimResponse{Seat: South, Type: ClaimPass, StateVersion: window.StateVersion}
	if err := engine.SubmitClaim(response); err != nil {
		t.Fatalf("first response error = %v", err)
	}
	if err := engine.SubmitClaim(response); !errors.Is(err, ErrActionDuplicate) {
		t.Fatalf("duplicate response error = %v", err)
	}
	clock = clock.Add(11 * time.Second)
	if err := engine.SubmitClaim(ClaimResponse{Seat: West, Type: ClaimPass, StateVersion: window.StateVersion}); !errors.Is(err, ErrClaimDeadline) {
		t.Fatalf("late response error = %v", err)
	}
	if _, err := engine.ResolveClaims(window.StateVersion); err != nil {
		t.Fatalf("late ResolveClaims() error = %v", err)
	}
	if engine.ActiveSeat != South || engine.Phase != PhaseAwaitingDraw {
		t.Fatalf("late resolution engine = %#v", engine.Snapshot())
	}
}

func TestTurnEngineKongReplacementEndsAtReserveBoundary(t *testing.T) {
	state := turnFixture(t)
	state.Players[0].Hand = []Tile{tile("characters-2-1", Characters, 2, 1)}
	state.Players[2].Hand = []Tile{
		tile("characters-2-2", Characters, 2, 2),
		tile("characters-2-3", Characters, 2, 3),
		tile("characters-2-4", Characters, 2, 4),
	}
	for state.Wall.DrawableRemaining() > 0 {
		if _, err := state.Wall.DrawFront(); err != nil {
			t.Fatalf("draining wall error = %v", err)
		}
	}
	engine := newTurnForClaims(t, state, nil)
	engine.Phase = PhaseAwaitingDiscard
	window, err := engine.Discard(engine.Version, East, "characters-2-1")
	if err != nil {
		t.Fatalf("boundary Discard() error = %v", err)
	}
	if err := engine.SubmitClaim(ClaimResponse{
		Seat: West, Type: ClaimKong, TileIDs: []string{"characters-2-2", "characters-2-3", "characters-2-4"}, StateVersion: window.StateVersion,
	}); err != nil {
		t.Fatalf("West Kong error = %v", err)
	}
	for _, seat := range []Seat{South, North} {
		if err := engine.SubmitClaim(ClaimResponse{Seat: seat, Type: ClaimPass, StateVersion: window.StateVersion}); err != nil {
			t.Fatalf("%s Pass error = %v", seat, err)
		}
	}
	if _, err := engine.ResolveClaims(window.StateVersion); !errors.Is(err, ErrHandComplete) {
		t.Fatalf("Kong at boundary error = %v", err)
	}
	if engine.Phase != PhaseExhaustiveDraw {
		t.Fatalf("phase = %s, want exhaustive draw", engine.Phase)
	}
}

func TestTurnEngineHashesDeterministically(t *testing.T) {
	left := newTurnForClaims(t, turnFixture(t), nil)
	right := newTurnForClaims(t, turnFixture(t), nil)
	leftHash, err := left.Hash()
	if err != nil {
		t.Fatalf("left Hash() error = %v", err)
	}
	rightHash, err := right.Hash()
	if err != nil {
		t.Fatalf("right Hash() error = %v", err)
	}
	if leftHash != rightHash {
		t.Fatalf("identical setup hashes differ: %s vs %s", leftHash, rightHash)
	}
}

func turnFixture(t *testing.T) *DealState {
	t.Helper()
	state, err := Deal(314159, [2]uint8{2, 3})
	if err != nil {
		t.Fatalf("Deal() error = %v", err)
	}
	state.Players[0].Hand = []Tile{
		tile("characters-1-1", Characters, 1, 1),
		tile("characters-4-1", Characters, 4, 1),
	}
	state.Players[1].Hand = []Tile{
		tile("characters-1-2", Characters, 1, 2),
		tile("characters-3-1", Characters, 3, 1),
	}
	state.Players[2].Hand = []Tile{
		tile("characters-1-3", Characters, 1, 3),
		tile("characters-1-4", Characters, 1, 4),
	}
	state.Players[3].Hand = []Tile{tile("dots-9-1", Dots, 9, 1)}
	for index := range state.Players {
		state.Players[index].Exposed = nil
	}
	return state
}

func newTurnForClaims(t *testing.T, state *DealState, validator WinValidator) *TurnEngine {
	t.Helper()
	clock := time.Date(2026, 7, 18, 1, 2, 3, 0, time.UTC)
	return newTurnForClaimsWithClock(t, state, validator, &clock)
}

func newTurnForClaimsWithClock(t *testing.T, state *DealState, validator WinValidator, clock *time.Time) *TurnEngine {
	t.Helper()
	engine, err := NewTurnEngine(state, func() time.Time { return *clock }, validator)
	if err != nil {
		t.Fatalf("NewTurnEngine() error = %v", err)
	}
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	return engine
}

func discardForClaims(t *testing.T, engine *TurnEngine, tileID string) *ClaimWindow {
	t.Helper()
	window, err := engine.Discard(engine.Version, East, tileID)
	if err != nil {
		t.Fatalf("Discard() error = %v", err)
	}
	return window
}

func tile(id string, kind TileKind, rank, copyNumber uint8) Tile {
	return Tile{ID: id, Kind: kind, Rank: rank, Copy: copyNumber}
}
