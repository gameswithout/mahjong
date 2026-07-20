package rulesengine

import (
	"context"
	"testing"
	"time"
)

func TestMarkBotSeatMakesSeatTakenOverAndBot(t *testing.T) {
	engine := newInitialTurn(t, turnFixture(t))

	if engine.IsBotSeat(North) || engine.IsTakenOver(North) {
		t.Fatal("North should not be bot-controlled before MarkBotSeat")
	}

	engine.MarkBotSeat(North)

	if !engine.IsBotSeat(North) {
		t.Fatal("IsBotSeat(North) = false after MarkBotSeat")
	}
	if !engine.IsTakenOver(North) {
		t.Fatal("IsTakenOver(North) = false after MarkBotSeat; bots.DecideTakeoverCommand and driveLocked both gate on IsTakenOver")
	}
	if engine.IsBotSeat(South) || engine.IsTakenOver(South) {
		t.Fatal("South should be unaffected by marking North a bot seat")
	}
}

func TestRestoreControlDoesNotClearPermanentBotSeat(t *testing.T) {
	engine := newInitialTurn(t, turnFixture(t))
	engine.MarkBotSeat(North)

	engine.RestoreControl(North)

	if !engine.IsBotSeat(North) {
		t.Fatal("RestoreControl must not clear a permanent AI Practice bot seat")
	}
	if !engine.IsTakenOver(North) {
		t.Fatal("IsTakenOver(North) should stay true: North is still a permanent bot seat")
	}
}

func TestBotSeatSurvivesEventSourcedRestore(t *testing.T) {
	store := NewMemoryEventStore()
	clock := time.Date(2026, 7, 19, 9, 0, 0, 0, time.UTC)
	ctx := context.Background()

	engine := newInitialTurn(t, turnFixture(t))
	engine.MarkBotSeat(South)
	engine.MarkBotSeat(West)
	engine.MarkBotSeat(North)

	actor, err := NewMatchActor(ctx, "match-bot-seats", engine, store, func() time.Time { return clock })
	if err != nil {
		t.Fatalf("NewMatchActor() error = %v", err)
	}
	if _, err := actor.Apply(ctx, MatchCommand{RequestID: "setup", Type: CommandBeginInitialReplacement}); err != nil {
		t.Fatalf("setup error = %v", err)
	}

	for _, seat := range []Seat{South, West, North} {
		if !actor.engine.IsBotSeat(seat) {
			t.Fatalf("IsBotSeat(%s) = false on the live actor", seat)
		}
	}
	if actor.engine.IsBotSeat(East) {
		t.Fatal("East must not have been marked a bot seat")
	}

	restored, err := RestoreMatchActor(ctx, "match-bot-seats", store, func() time.Time { return clock.Add(time.Hour) })
	if err != nil {
		t.Fatalf("RestoreMatchActor() error = %v", err)
	}
	for _, seat := range []Seat{South, West, North} {
		if !restored.engine.IsBotSeat(seat) {
			t.Fatalf("IsBotSeat(%s) = false after event-sourced restore", seat)
		}
	}
	if restored.engine.IsBotSeat(East) {
		t.Fatal("East must not be a bot seat after restore")
	}
}

func TestProjectSeatMarksIsBotDistinctFromTakenOver(t *testing.T) {
	engine := newInitialTurn(t, turnFixture(t))
	engine.MarkBotSeat(North)
	if err := engine.BeginInitialReplacement(); err != nil {
		t.Fatalf("BeginInitialReplacement() error = %v", err)
	}

	view, err := engine.ProjectSeat("match-project-seat", East)
	if err != nil {
		t.Fatalf("ProjectSeat(East) error = %v", err)
	}

	for _, player := range view.Players {
		switch player.Seat {
		case North:
			if !player.IsBot {
				t.Fatal("North PlayerView.IsBot = false, want true")
			}
			if !player.TakenOver {
				t.Fatal("North PlayerView.TakenOver = false, want true (bot-controlled)")
			}
		default:
			if player.IsBot {
				t.Fatalf("%s PlayerView.IsBot = true, want false", player.Seat)
			}
		}
	}
}
