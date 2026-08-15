package match

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/gameswithout/mahjong/bots"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/session"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/storage"
	"github.com/gameswithout/mahjong/rulesengine"
)

// Tile efficiency is the one statistic that cannot be read off a finished
// hand, so it is counted as the hand is played. These cover the counting
// itself: that a real discard is scored against the position it was made
// in, that the tally reaches the projection, and that seats are kept apart.

func TestTileEfficiency_CountsThePlayersOwnDiscards(t *testing.T) {
	clock := time.Date(2026, 8, 15, 9, 0, 0, 0, time.UTC)
	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "session-efficiency",
		MatchID:   "match-efficiency",
	}
	runtime := NewRuntime(
		session.StaticResolver{Members: []string{
			"human", "bot:efficiency:1", "bot:efficiency:2", "bot:efficiency:3",
		}},
		&fakeMatchRepository{},
		rulesengine.NewMemoryEventStore(),
		func() time.Time { return clock },
	)
	ctx := context.Background()

	view, err := runtime.Join(ctx, key, "human")
	if err != nil {
		t.Fatalf("Join() error = %v", err)
	}
	if made, _ := view.DiscardEfficiency(); made != 0 {
		t.Fatalf("a freshly joined hand already counted %d discards", made)
	}

	// Play the player's own turns and independently score each discard, so
	// the assertion does not simply repeat the implementation's own answer
	// for whatever it happened to choose.
	expectedMade, expectedEfficient := 0, 0
	for turn := 0; turn < 3; turn++ {
		if view.Phase == rulesengine.PhaseHandComplete || view.Phase == rulesengine.PhaseExhaustiveDraw {
			break
		}
		if view.ActiveSeat != view.Seat {
			t.Fatalf("turn %d: expected the player to be active, got %s", turn, view.ActiveSeat)
		}
		if view.Phase == rulesengine.PhaseAwaitingDraw {
			if _, view, err = runtime.Apply(ctx, key, "human", rulesengine.MatchCommand{
				RequestID:       fmt.Sprintf("draw-%d", turn),
				Type:            rulesengine.CommandDraw,
				ExpectedVersion: view.StateVersion,
			}); err != nil {
				t.Fatalf("turn %d: Draw() error = %v", turn, err)
			}
		}
		if view.Phase != rulesengine.PhaseAwaitingDiscard {
			break
		}

		tile := view.OwnHand[0].ID
		efficient := bots.EfficientDiscards(view.OwnHand, view.OwnMelds)
		expectedMade++
		if efficient[tile] {
			expectedEfficient++
		}

		if _, view, err = runtime.Apply(ctx, key, "human", rulesengine.MatchCommand{
			RequestID:       fmt.Sprintf("discard-%d", turn),
			Type:            rulesengine.CommandDiscard,
			ExpectedVersion: view.StateVersion,
			TileID:          tile,
		}); err != nil {
			t.Fatalf("turn %d: Discard() error = %v", turn, err)
		}

		made, scored := view.DiscardEfficiency()
		if made != expectedMade {
			t.Fatalf("turn %d: counted %d discards, want %d", turn, made, expectedMade)
		}
		if scored != expectedEfficient {
			t.Fatalf("turn %d: scored %d efficient, want %d", turn, scored, expectedEfficient)
		}
	}

	if expectedMade == 0 {
		t.Fatal("the fixture never reached a discard, so nothing was measured")
	}
	made, scored := view.DiscardEfficiency()
	if scored > made {
		t.Fatalf("efficient (%d) exceeded made (%d), which no rate can survive", scored, made)
	}
}

// Bot seats are driven internally and must not land in the player's tally,
// or a Practice table would report the bots' efficiency as the player's.
func TestTileEfficiency_IgnoresBotSeats(t *testing.T) {
	clock := time.Date(2026, 8, 15, 9, 0, 0, 0, time.UTC)
	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "session-efficiency-bots",
		MatchID:   "match-efficiency-bots",
	}
	runtime := NewRuntime(
		session.StaticResolver{Members: []string{
			"human", "bot:efficiency:1", "bot:efficiency:2", "bot:efficiency:3",
		}},
		&fakeMatchRepository{},
		rulesengine.NewMemoryEventStore(),
		func() time.Time { return clock },
	)
	ctx := context.Background()

	view, err := runtime.Join(ctx, key, "human")
	if err != nil {
		t.Fatalf("Join() error = %v", err)
	}
	// The bots take their turns through the drive loop during Join and the
	// player's own commands. None of that may be counted.
	if made, _ := view.DiscardEfficiency(); made != 0 {
		t.Fatalf("bot turns contributed %d discards to the player's tally", made)
	}

	if view.Phase == rulesengine.PhaseAwaitingDiscard && view.ActiveSeat == view.Seat {
		if _, view, err = runtime.Apply(ctx, key, "human", rulesengine.MatchCommand{
			RequestID:       "discard-1",
			Type:            rulesengine.CommandDiscard,
			ExpectedVersion: view.StateVersion,
			TileID:          view.OwnHand[0].ID,
		}); err != nil {
			t.Fatalf("Discard() error = %v", err)
		}
		// Exactly one discard: the player's. The three bots discarding in
		// response must not appear.
		if made, _ := view.DiscardEfficiency(); made != 1 {
			t.Fatalf("after one player discard the tally reads %d", made)
		}
	}
}
