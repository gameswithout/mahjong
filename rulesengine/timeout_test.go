package rulesengine

import (
	"errors"
	"testing"
	"time"
)

func TestAutoDiscardExpiredTurnDiscardsMostRecentlyDrawnTile(t *testing.T) {
	state := turnFixture(t)
	state.Players[0].Hand = []Tile{
		tile("characters-1-1", Characters, 1, 1),
		tile("characters-4-1", Characters, 4, 1),
	}
	clock := time.Date(2026, 7, 19, 1, 0, 0, 0, time.UTC)
	engine, err := NewTurnEngine(state, func() time.Time { return clock })
	if err != nil {
		t.Fatalf("NewTurnEngine() error = %v", err)
	}
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	if engine.TurnDeadline == nil {
		t.Fatal("TurnDeadline was not set entering the discard window")
	}

	if _, err := engine.AutoDiscardExpiredTurn(clock); !errors.Is(err, ErrTurnNotExpired) {
		t.Fatalf("before the deadline: error = %v, want ErrTurnNotExpired", err)
	}

	// East's hand at BeginInitialReplacement time has no lastDraw (dealt,
	// not drawn), so this exercises the canonical-rightmost-tile fallback
	// implicitly; a dedicated lastDraw case follows below via Draw().
	past := engine.TurnDeadline.Add(time.Second)
	window, err := engine.AutoDiscardExpiredTurn(past)
	if err != nil {
		t.Fatalf("AutoDiscardExpiredTurn() error = %v", err)
	}
	if window == nil || engine.Phase != PhaseClaimWindow {
		t.Fatalf("window = %#v, phase = %s", window, engine.Phase)
	}
	if engine.AFKStrikes(East) != 1 {
		t.Fatalf("AFK strikes = %d, want 1", engine.AFKStrikes(East))
	}
}

func TestAutoDiscardExpiredTurnPrefersLastDrawnTileOverRightmost(t *testing.T) {
	state := turnFixture(t)
	clock := time.Date(2026, 7, 19, 1, 0, 0, 0, time.UTC)
	engine, err := NewTurnEngine(state, func() time.Time { return clock })
	if err != nil {
		t.Fatalf("NewTurnEngine() error = %v", err)
	}
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	// East discards for real so the turn passes to South via a normal
	// claim resolution, landing South in PhaseAwaitingDraw.
	window, err := engine.Discard(engine.Version, East, "characters-1-1")
	if err != nil {
		t.Fatalf("Discard() error = %v", err)
	}
	for _, seat := range window.Eligible {
		if err := engine.SubmitClaim(ClaimResponse{Seat: seat, Type: ClaimPass, StateVersion: window.StateVersion}); err != nil {
			t.Fatalf("pass for %s error = %v", seat, err)
		}
	}
	if _, err := engine.ResolveClaims(window.StateVersion); err != nil {
		t.Fatalf("ResolveClaims() error = %v", err)
	}
	if engine.ActiveSeat != South || engine.Phase != PhaseAwaitingDraw {
		t.Fatalf("phase = %s, active = %s", engine.Phase, engine.ActiveSeat)
	}
	// South draws for real (a "genuine" draw), then times out on the
	// ensuing discard decision — the canonical rule must pick the tile
	// South actually just drew, not merely the rightmost sorted tile.
	drawResult, err := engine.Draw(engine.Version)
	if err != nil {
		t.Fatalf("Draw() error = %v", err)
	}
	drawnID := drawResult.Tile.ID
	if engine.TurnDeadline == nil {
		t.Fatal("TurnDeadline missing after draw")
	}
	past := engine.TurnDeadline.Add(time.Second)
	claimWindow, err := engine.AutoDiscardExpiredTurn(past)
	if err != nil {
		t.Fatalf("AutoDiscardExpiredTurn() error = %v", err)
	}
	if claimWindow == nil || claimWindow.Discard.Tile.ID != drawnID {
		t.Fatalf("auto-discarded %#v, want the just-drawn tile %s", claimWindow, drawnID)
	}
}

func TestAutoDiscardExpiredTurnAutoDrawsWhenStillAwaitingDraw(t *testing.T) {
	state := turnFixture(t)
	clock := time.Date(2026, 7, 19, 1, 0, 0, 0, time.UTC)
	engine, err := NewTurnEngine(state, func() time.Time { return clock })
	if err != nil {
		t.Fatalf("NewTurnEngine() error = %v", err)
	}
	engine.ActiveSeat = East
	engine.beginDrawWindow()
	if engine.Phase != PhaseAwaitingDraw {
		t.Fatalf("phase = %s, want PhaseAwaitingDraw", engine.Phase)
	}
	past := engine.TurnDeadline.Add(time.Second)
	window, err := engine.AutoDiscardExpiredTurn(past)
	if err != nil {
		t.Fatalf("AutoDiscardExpiredTurn() error = %v", err)
	}
	if window == nil || engine.Phase != PhaseClaimWindow {
		t.Fatalf("window = %#v, phase = %s — expected the mandatory draw then an auto-discard", window, engine.Phase)
	}
}

func TestAutoDiscardExpiredTurnDeclinesOfferThenDiscards(t *testing.T) {
	state := turnFixture(t)
	// A concealed hand structurally complete right after replacement makes
	// East eligible for the Heavenly offer.
	state.Players[0].Hand = append(append(append(
		concealedPongTiles(Characters, 1),
		concealedPongTiles(Characters, 2)...),
		concealedPongTiles(Characters, 3)...),
		append(concealedPongTiles(Bamboo, 1),
			append(concealedPongTiles(Bamboo, 2),
				tile("dots-5-1", Dots, 5, 1), tile("dots-5-2", Dots, 5, 2))...)...)
	clock := time.Date(2026, 7, 19, 1, 0, 0, 0, time.UTC)
	engine, err := NewTurnEngine(state, func() time.Time { return clock })
	if err != nil {
		t.Fatalf("NewTurnEngine() error = %v", err)
	}
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	offer := engine.Offer()
	if engine.Phase != PhaseOfferPending || offer == nil {
		t.Fatalf("phase = %s, offer = %#v", engine.Phase, offer)
	}
	// The offer itself does not carry a deadline of its own in this
	// implementation; use the engine's turn-phase deadline machinery by
	// directly forcing an expired instant, matching how the runtime would
	// treat "no response within the shared decision budget."
	pastOfferDeadline := clock.Add(20 * time.Second)
	// AutoDiscardExpiredTurn requires TurnDeadline to be set even while
	// PhaseOfferPending; the last beginDiscardWindow/beginDrawWindow call
	// before the offer was raised already set one (East's dealt-hand entry
	// predates any draw window, so simulate that by setting it directly).
	deadline := clock.Add(-time.Second)
	engine.TurnDeadline = &deadline
	result, err := engine.AutoDiscardExpiredTurn(pastOfferDeadline)
	if err != nil {
		t.Fatalf("AutoDiscardExpiredTurn() error = %v", err)
	}
	if result == nil {
		t.Fatal("expected a claim window after the offer auto-declines and a discard follows")
	}
	if engine.heavenlyLapsed != true {
		t.Fatal("Heavenly offer should have lapsed (declined), never auto-accepted")
	}
	if engine.AFKStrikes(East) != 1 {
		t.Fatalf("AFK strikes = %d, want 1", engine.AFKStrikes(East))
	}
}

func TestGenuineDiscardResetsAFKStrikes(t *testing.T) {
	state := turnFixture(t)
	state.Players[0].Hand = []Tile{
		tile("characters-1-1", Characters, 1, 1),
		tile("characters-4-1", Characters, 4, 1),
	}
	clock := time.Date(2026, 7, 19, 1, 0, 0, 0, time.UTC)
	engine, err := NewTurnEngine(state, func() time.Time { return clock })
	if err != nil {
		t.Fatalf("NewTurnEngine() error = %v", err)
	}
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	// Two consecutive timeouts (draw-window skipped by using the fixture's
	// pre-set discard window), then a genuine discard resets the count.
	engine.recordTimeout(East)
	engine.recordTimeout(East)
	if engine.AFKStrikes(East) != 2 {
		t.Fatalf("AFK strikes = %d, want 2", engine.AFKStrikes(East))
	}
	if _, err := engine.Discard(engine.Version, East, "characters-1-1"); err != nil {
		t.Fatalf("Discard() error = %v", err)
	}
	if engine.AFKStrikes(East) != 0 {
		t.Fatalf("AFK strikes after a genuine discard = %d, want 0", engine.AFKStrikes(East))
	}
}

func TestThreeConsecutiveTimeoutsActivateTakeover(t *testing.T) {
	state := turnFixture(t)
	clock := time.Date(2026, 7, 19, 1, 0, 0, 0, time.UTC)
	engine, err := NewTurnEngine(state, func() time.Time { return clock })
	if err != nil {
		t.Fatalf("NewTurnEngine() error = %v", err)
	}
	if engine.IsTakenOver(East) {
		t.Fatal("should not start taken over")
	}
	engine.recordTimeout(East)
	if engine.IsTakenOver(East) {
		t.Fatal("one timeout must not activate takeover")
	}
	engine.recordTimeout(East)
	if engine.IsTakenOver(East) {
		t.Fatal("two timeouts must not activate takeover")
	}
	engine.recordTimeout(East)
	if !engine.IsTakenOver(East) {
		t.Fatal("three consecutive timeouts must activate takeover")
	}
	// A genuine action alone (e.g. a bot orchestrator acting on the seat's
	// behalf every turn while taken over) must NOT clear takeover — only
	// RestoreControl, called by the runtime once it detects the human has
	// actually reconnected, does that (§8.7).
	engine.recordGenuineAction(East)
	if !engine.IsTakenOver(East) {
		t.Fatal("recordGenuineAction alone must not clear takeover")
	}
	if engine.AFKStrikes(East) != 0 {
		t.Fatalf("AFK strikes after a genuine action = %d, want 0", engine.AFKStrikes(East))
	}
	engine.RestoreControl(East)
	if engine.IsTakenOver(East) {
		t.Fatal("RestoreControl must clear takeover")
	}
	if engine.AFKStrikes(East) != 0 {
		t.Fatalf("AFK strikes after RestoreControl = %d, want 0", engine.AFKStrikes(East))
	}
}

func TestClaimTimeoutTracksAFKOnlyForNonResponders(t *testing.T) {
	state := turnFixture(t)
	clock := time.Date(2026, 7, 19, 1, 2, 3, 0, time.UTC)
	engine := newTurnForClaimsWithClock(t, state, nil, &clock)
	window := discardForClaims(t, engine, "characters-1-1")
	// South responds genuinely; West and North do not.
	if err := engine.SubmitClaim(ClaimResponse{Seat: South, Type: ClaimPass, StateVersion: window.StateVersion}); err != nil {
		t.Fatalf("SubmitClaim() error = %v", err)
	}
	clock = window.Deadline.Add(time.Second)
	if _, err := engine.ResolveClaims(window.StateVersion); err != nil {
		t.Fatalf("ResolveClaims() error = %v", err)
	}
	if engine.AFKStrikes(South) != 0 {
		t.Fatalf("South (responded) AFK strikes = %d, want 0", engine.AFKStrikes(South))
	}
	if engine.AFKStrikes(West) != 1 || engine.AFKStrikes(North) != 1 {
		t.Fatalf("West/North (timed out) AFK strikes = %d/%d, want 1/1", engine.AFKStrikes(West), engine.AFKStrikes(North))
	}
}
