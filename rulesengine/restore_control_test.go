package rulesengine

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

// takeOverNorthViaClaimTimeouts drives North's three consecutive-timeout
// strikes through real MatchActor commands: East, then South, then West
// each discard in turn (nobody claims), and North never responds. Rotation
// order E-S-W-N means North is never the discarder in this sequence and is
// eligible on all three windows, so exhausting its patience lands takeover
// right as it becomes North's own turn — mirrors bots/takeover_test.go's
// helper of the same shape, at the MatchActor/command level instead of a
// raw *TurnEngine.
func takeOverNorthViaClaimTimeouts(t *testing.T, actor *MatchActor, clock *time.Time) {
	t.Helper()
	ctx := context.Background()
	discarders := []struct {
		seat  Seat
		tile  string
		other Seat
	}{
		{East, "characters-1-1", South},
		{South, "characters-1-2", West},
		{West, "characters-1-3", East},
	}
	requestID := 0
	nextID := func(prefix string) string { requestID++; return prefix + "-" + itoaRestoreTest(requestID) }
	for _, step := range discarders {
		view, err := actor.View(step.seat)
		if err != nil {
			t.Fatalf("View(%s) error = %v", step.seat, err)
		}
		tileID := step.tile
		if view.Phase == PhaseAwaitingDraw {
			drawResult, err := actor.Apply(ctx, MatchCommand{RequestID: nextID("draw"), Type: CommandDraw, ExpectedVersion: view.StateVersion})
			if err != nil {
				t.Fatalf("Draw(%s) error = %v", step.seat, err)
			}
			tileID = drawResult.Draw.Tile.ID
			view, err = actor.View(step.seat)
			if err != nil {
				t.Fatalf("View(%s) after draw error = %v", step.seat, err)
			}
		}
		result, err := actor.Apply(ctx, MatchCommand{RequestID: nextID("discard"), Type: CommandDiscard, ExpectedVersion: view.StateVersion, Seat: step.seat, TileID: tileID})
		if err != nil {
			t.Fatalf("Discard(%s) error = %v", step.seat, err)
		}
		if _, err := actor.Apply(ctx, MatchCommand{RequestID: nextID("pass"), Type: CommandSubmitClaim, Claim: &ClaimResponse{Seat: step.other, Type: ClaimPass, StateVersion: result.Snapshot.Claim.StateVersion, ActionID: result.Snapshot.Claim.ActionID}}); err != nil {
			t.Fatalf("pass for %s error = %v", step.other, err)
		}
		*clock = result.Snapshot.Claim.Deadline.Add(time.Second)
		if _, err := actor.Apply(ctx, MatchCommand{RequestID: nextID("resolve"), Type: CommandResolveClaims, ExpectedVersion: result.Snapshot.Claim.StateVersion}); err != nil {
			t.Fatalf("resolve claims error = %v", err)
		}
	}
}

func itoaRestoreTest(n int) string {
	digits := [4]byte{}
	position := len(digits)
	for n > 0 {
		position--
		digits[position] = byte('0' + n%10)
		n /= 10
	}
	if position == len(digits) {
		return "0"
	}
	return string(digits[position:])
}

func TestCommandRestoreControlClearsTakeoverAndReplays(t *testing.T) {
	store := NewMemoryEventStore()
	clock := time.Date(2026, 7, 19, 9, 0, 0, 0, time.UTC)
	ctx := context.Background()
	actor, err := NewMatchActor(ctx, "match-restore", newInitialTurn(t, turnFixture(t)), store, func() time.Time { return clock })
	if err != nil {
		t.Fatalf("NewMatchActor() error = %v", err)
	}
	if _, err := actor.Apply(ctx, MatchCommand{RequestID: "setup", Type: CommandBeginInitialReplacement}); err != nil {
		t.Fatalf("setup error = %v", err)
	}

	takeOverNorthViaClaimTimeouts(t, actor, &clock)

	if !actor.engine.IsTakenOver(North) {
		t.Fatal("expected North to be taken over after three consecutive claim timeouts")
	}

	if _, err := actor.Apply(ctx, MatchCommand{RequestID: "restore", Type: CommandRestoreControl, Seat: North}); err != nil {
		t.Fatalf("CommandRestoreControl error = %v", err)
	}
	if actor.engine.IsTakenOver(North) {
		t.Fatal("CommandRestoreControl should clear takeover")
	}
	live, err := actor.View(North)
	if err != nil {
		t.Fatalf("View(North) after restore error = %v", err)
	}

	restored, err := RestoreMatchActor(ctx, "match-restore", store, func() time.Time { return clock.Add(time.Hour) })
	if err != nil {
		t.Fatalf("RestoreMatchActor() error = %v", err)
	}
	replayedView, err := restored.View(North)
	if err != nil {
		t.Fatalf("replayed View(North) error = %v", err)
	}
	liveJSON, _ := json.Marshal(live)
	replayedJSON, _ := json.Marshal(replayedView)
	if string(liveJSON) != string(replayedJSON) {
		t.Fatalf("replayed view differs from live\nlive     %s\nreplayed %s", liveJSON, replayedJSON)
	}
}
