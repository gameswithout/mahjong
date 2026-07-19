package bots

import (
	"testing"
	"time"

	"github.com/gameswithout/mahjong/rulesengine"
)

// mutableClockEngine returns an engine driven by a clock the test can
// advance, plus a pointer to that clock — needed to genuinely exercise
// deadline timeouts, which rulesengine.TurnEngine reads from its own
// injected clock rather than an externally-passed instant.
func mutableClockEngine(t *testing.T) (*rulesengine.TurnEngine, *time.Time) {
	t.Helper()
	state := dealFixture(t)
	state.Players[0].Hand = []rulesengine.Tile{ // East
		tile("characters-1-1", rulesengine.Characters, 1, 1),
		tile("characters-4-1", rulesengine.Characters, 4, 1),
	}
	state.Players[1].Hand = []rulesengine.Tile{ // South
		tile("characters-1-2", rulesengine.Characters, 1, 2),
		tile("characters-3-1", rulesengine.Characters, 3, 1),
	}
	state.Players[2].Hand = []rulesengine.Tile{ // West
		tile("characters-1-3", rulesengine.Characters, 1, 3),
		tile("characters-1-4", rulesengine.Characters, 1, 4),
	}
	state.Players[3].Hand = []rulesengine.Tile{tile("dots-9-1", rulesengine.Dots, 9, 1)} // North
	clock := time.Date(2026, 7, 19, 8, 0, 0, 0, time.UTC)
	engine, err := rulesengine.NewTurnEngine(state, func() time.Time { return clock })
	if err != nil {
		t.Fatalf("NewTurnEngine() error = %v", err)
	}
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}
	return engine, &clock
}

func TestDriveTakeoverSeatReturnsErrorWhenNotTakenOver(t *testing.T) {
	engine, _ := mutableClockEngine(t)
	_, err := DriveTakeoverSeat(engine, rulesengine.East, rulesengine.East, rulesengine.East, 0, 1)
	if err != ErrSeatNotTakenOver {
		t.Fatalf("error = %v, want ErrSeatNotTakenOver", err)
	}
}

// takeOverNorthViaClaimTimeouts drives North's three consecutive-timeout
// strikes the realistic way: East, then South, then West each discard in
// turn (nobody claims), and North never responds to any of the three
// resulting claim windows. Rotation order is E-S-W-N, so North is never
// the discarder in this sequence and is eligible on all three windows —
// exhausting its "patience" lands takeover right as it becomes North's own
// turn (PhaseAwaitingDraw), which the two tests below build on.
func takeOverNorthViaClaimTimeouts(t *testing.T, engine *rulesengine.TurnEngine, clock *time.Time) {
	t.Helper()
	discarders := []struct {
		seat  rulesengine.Seat
		tile  string
		other rulesengine.Seat // the one non-North, non-discarder seat that explicitly passes
	}{
		{rulesengine.East, "characters-1-1", rulesengine.South},
		{rulesengine.South, "characters-1-2", rulesengine.West},
		{rulesengine.West, "characters-1-3", rulesengine.East},
	}
	for _, step := range discarders {
		if engine.ActiveSeat != step.seat {
			t.Fatalf("expected %s active, got %s", step.seat, engine.ActiveSeat)
		}
		discardTile := step.tile
		if engine.Phase == rulesengine.PhaseAwaitingDraw {
			drawResult, err := engine.Draw(engine.Version)
			if err != nil {
				t.Fatalf("Draw(%s) error = %v", step.seat, err)
			}
			discardTile = drawResult.Tile.ID
		}
		if engine.Phase != rulesengine.PhaseAwaitingDiscard {
			t.Fatalf("expected %s awaiting discard, got phase=%s active=%s", step.seat, engine.Phase, engine.ActiveSeat)
		}
		window, err := engine.Discard(engine.Version, step.seat, discardTile)
		if err != nil {
			t.Fatalf("Discard(%s) error = %v", step.seat, err)
		}
		if err := engine.SubmitClaim(rulesengine.ClaimResponse{Seat: step.other, Type: rulesengine.ClaimPass, StateVersion: window.StateVersion}); err != nil {
			t.Fatalf("pass for %s error = %v", step.other, err)
		}
		// North deliberately never responds -> one timeout strike.
		*clock = window.Deadline.Add(time.Second)
		if _, err := engine.ResolveClaims(window.StateVersion); err != nil {
			t.Fatalf("ResolveClaims() error = %v", err)
		}
	}
	if !engine.IsTakenOver(rulesengine.North) {
		t.Fatal("North should be taken over after three consecutive claim timeouts")
	}
	if engine.ActiveSeat != rulesengine.North || engine.Phase != rulesengine.PhaseAwaitingDraw {
		t.Fatalf("phase = %s, active = %s, want North awaiting its own draw", engine.Phase, engine.ActiveSeat)
	}
}

func TestDriveTakeoverSeatAutoDrawsThenDiscards(t *testing.T) {
	engine, clock := mutableClockEngine(t)
	takeOverNorthViaClaimTimeouts(t, engine, clock)

	acted, err := DriveTakeoverSeat(engine, rulesengine.North, rulesengine.East, rulesengine.East, 0, 7)
	if err != nil || !acted {
		t.Fatalf("draw step: acted=%v err=%v", acted, err)
	}
	if engine.Phase != rulesengine.PhaseAwaitingDiscard {
		t.Fatalf("phase after auto-draw = %s, want PhaseAwaitingDiscard", engine.Phase)
	}

	acted, err = DriveTakeoverSeat(engine, rulesengine.North, rulesengine.East, rulesengine.East, 0, 7)
	if err != nil || !acted {
		t.Fatalf("discard step: acted=%v err=%v", acted, err)
	}
	if engine.Phase != rulesengine.PhaseClaimWindow || engine.LastDiscard == nil || engine.LastDiscard.Seat != rulesengine.North {
		t.Fatalf("phase = %s, lastDiscard = %#v, want North's claim window", engine.Phase, engine.LastDiscard)
	}
	// Takeover must persist across bot-driven actions: only the human
	// actually reconnecting (engine.RestoreControl, called by the runtime)
	// clears it, never a regular command the bot orchestrator submits on
	// the seat's behalf.
	if !engine.IsTakenOver(rulesengine.North) {
		t.Fatal("a bot-driven discard must not clear takeover; only RestoreControl does")
	}
	engine.RestoreControl(rulesengine.North)
	if engine.IsTakenOver(rulesengine.North) {
		t.Fatal("RestoreControl should clear takeover")
	}
}

func TestDriveTakeoverSeatRespondsToClaimWindow(t *testing.T) {
	engine, clock := mutableClockEngine(t)
	takeOverNorthViaClaimTimeouts(t, engine, clock)

	// North (still taken over) draws and discards via the bot, then East
	// passes and South passes so control returns to East, whose next
	// discard gives North a fresh, live claim window to respond to via the
	// orchestrator instead of timing out again.
	if _, err := DriveTakeoverSeat(engine, rulesengine.North, rulesengine.East, rulesengine.East, 0, 7); err != nil {
		t.Fatalf("North draw step error = %v", err)
	}
	if _, err := DriveTakeoverSeat(engine, rulesengine.North, rulesengine.East, rulesengine.East, 0, 7); err != nil {
		t.Fatalf("North discard step error = %v", err)
	}
	window := engine.Claim
	if window == nil {
		t.Fatal("expected a claim window after North's discard")
	}
	for _, seat := range window.Eligible {
		if err := engine.SubmitClaim(rulesengine.ClaimResponse{Seat: seat, Type: rulesengine.ClaimPass, StateVersion: window.StateVersion}); err != nil {
			t.Fatalf("pass for %s error = %v", seat, err)
		}
	}
	if _, err := engine.ResolveClaims(window.StateVersion); err != nil {
		t.Fatalf("ResolveClaims() error = %v", err)
	}
	if engine.ActiveSeat != rulesengine.East || engine.Phase != rulesengine.PhaseAwaitingDraw {
		t.Fatalf("phase = %s, active = %s, want East awaiting draw", engine.Phase, engine.ActiveSeat)
	}
	drawResult, err := engine.Draw(engine.Version)
	if err != nil {
		t.Fatalf("Draw() error = %v", err)
	}
	claimWindow, err := engine.Discard(engine.Version, rulesengine.East, drawResult.Tile.ID)
	if err != nil {
		t.Fatalf("Discard() error = %v", err)
	}
	if !seatEligibleFor(claimWindow.Eligible, rulesengine.North) {
		t.Fatal("North should be eligible to claim East's discard")
	}

	acted, err := DriveTakeoverSeat(engine, rulesengine.North, rulesengine.East, rulesengine.East, 0, 3)
	if err != nil {
		t.Fatalf("DriveTakeoverSeat() error = %v", err)
	}
	if !acted {
		t.Fatal("expected North's claim response to be driven")
	}
	if _, responded := engine.Claim.Responses[rulesengine.North]; !responded {
		t.Fatal("North's claim response was not recorded")
	}
}

func TestDriveTakeoverSeatDeterministic(t *testing.T) {
	engineA, clockA := mutableClockEngine(t)
	engineB, clockB := mutableClockEngine(t)
	takeOverNorthViaClaimTimeouts(t, engineA, clockA)
	takeOverNorthViaClaimTimeouts(t, engineB, clockB)

	if _, err := DriveTakeoverSeat(engineA, rulesengine.North, rulesengine.East, rulesengine.East, 0, 99); err != nil {
		t.Fatalf("engineA draw step error = %v", err)
	}
	if _, err := DriveTakeoverSeat(engineB, rulesengine.North, rulesengine.East, rulesengine.East, 0, 99); err != nil {
		t.Fatalf("engineB draw step error = %v", err)
	}
	decisionA, err := DriveTakeoverSeat(engineA, rulesengine.North, rulesengine.East, rulesengine.East, 0, 99)
	if err != nil {
		t.Fatalf("engineA discard step error = %v", err)
	}
	decisionB, err := DriveTakeoverSeat(engineB, rulesengine.North, rulesengine.East, rulesengine.East, 0, 99)
	if err != nil {
		t.Fatalf("engineB discard step error = %v", err)
	}
	if !decisionA || !decisionB {
		t.Fatal("expected both takeover discards to succeed")
	}
	if engineA.LastDiscard == nil || engineB.LastDiscard == nil || engineA.LastDiscard.Tile.ID != engineB.LastDiscard.Tile.ID {
		t.Fatalf("same seed produced different takeover discards: %#v vs %#v", engineA.LastDiscard, engineB.LastDiscard)
	}
}
