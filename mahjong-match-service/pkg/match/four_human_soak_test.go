package match

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/session"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/storage"
	"github.com/gameswithout/mahjong/rulesengine"
)

// TestFourHumanSoak_ViewNeverFailsMidHand reproduces the 2026-07-25 live
// four-human stall: every client polls GetMatchState, one poll returns a
// 4xx, and because that maps to a non-retryable client code the whole table
// unmounts with no recovery path.
//
// The loop mirrors what four browser clients actually do — each seat polls
// View on every tick, and whichever seat is on turn acts — while the clock
// advances in coarse steps so turn and claim deadlines genuinely expire, as
// they do whenever a real player stops to think.
//
// Any View error at all is a failure: a read of match state must not be able
// to fail because of the state the match happens to be in.
func TestFourHumanSoak_ViewNeverFailsMidHand(t *testing.T) {
	players := []string{"east-human", "south-human", "west-human", "north-human"}

	// Several seeds, because the failing path depends on the deal: the wall
	// order decides which seats reach a claim window, a Kong, or a §5.9
	// offer, and only some of those combinations reach the wedge.
	for attempt := 0; attempt < 8; attempt++ {
		attempt := attempt
		t.Run(fmt.Sprintf("attempt-%02d", attempt), func(t *testing.T) {
			clock := time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)
			now := func() time.Time { return clock }
			key := storage.MatchKey{
				Namespace: "gameswithout-mahjong",
				SessionID: fmt.Sprintf("session-soak-%d", attempt),
				MatchID:   fmt.Sprintf("match-soak-%d", attempt),
			}
			runtime := NewRuntime(
				session.StaticResolver{Members: players},
				&fakeMatchRepository{},
				rulesengine.NewMemoryEventStore(),
				now,
			)
			ctx := context.Background()

			for _, player := range players {
				if _, err := runtime.Join(ctx, key, player); err != nil {
					t.Fatalf("%s Join() error = %v", player, err)
				}
			}

			seq := 0
			for step := 0; step < 250; step++ {
				// Every client polls every tick, exactly as the browser
				// clients do. All four must always succeed.
				views := make(map[string]rulesengine.SeatView, len(players))
				for _, player := range players {
					view, err := runtime.View(ctx, key, player)
					if err != nil {
						t.Fatalf(
							"step %d: %s View() error = %v\n"+
								"this is the live four-human stall: a mid-hand read failed, "+
								"which the client maps to a non-retryable error and unmounts on",
							step, player, err,
						)
					}
					views[player] = view
				}

				done := false
				for _, view := range views {
					if view.Phase == rulesengine.PhaseHandComplete ||
						view.Phase == rulesengine.PhaseExhaustiveDraw {
						done = true
					}
				}
				if done {
					break
				}

				seq++
				acted := actOnce(ctx, t, runtime, key, players, views, seq)

				// Advance past the turn deadline every few steps so the
				// §5.10 expiry paths are exercised the way a thinking (or
				// disconnected) player exercises them live.
				if !acted || step%7 == 6 {
					clock = clock.Add(45 * time.Second)
				} else {
					clock = clock.Add(2 * time.Second)
				}
			}
		})
	}
}

// actOnce submits at most one command on behalf of whichever seat currently
// owes the table a decision, preferring an outstanding claim response. It
// returns whether it managed to act.
func actOnce(
	ctx context.Context,
	t *testing.T,
	runtime *Runtime,
	key storage.MatchKey,
	players []string,
	views map[string]rulesengine.SeatView,
	seq int,
) bool {
	t.Helper()

	// A claim window blocks everyone until the eligible seats answer.
	// Take every claim that is on offer rather than always passing —
	// claiming is what pushes the match through Pong/Chow/Kong and the
	// server-driven resolution path, which passing never reaches.
	for _, player := range players {
		view := views[player]
		if view.Phase != rulesengine.PhaseClaimWindow || view.Claim == nil {
			continue
		}
		if view.Claim.OwnResponse != nil || !seatIn(view.Claim.Eligible, view.Seat) {
			continue
		}
		response := &rulesengine.ClaimResponse{
			ActionID: view.Claim.ActionID,
			Type:     rulesengine.ClaimPass,
		}
		options := view.Claim.Options
		switch {
		case options.CanWin:
			response.Type = rulesengine.ClaimWin
		case options.CanKong:
			response.Type = rulesengine.ClaimKong
		case options.CanPong:
			response.Type = rulesengine.ClaimPong
		case len(options.ChowSets) > 0:
			response.Type = rulesengine.ClaimChow
			response.TileIDs = options.ChowSets[0][:]
		}
		_, _, err := runtime.Apply(ctx, key, player, rulesengine.MatchCommand{
			RequestID:       fmt.Sprintf("claim-%s-%d", view.Seat, seq),
			Type:            rulesengine.CommandSubmitClaim,
			ExpectedVersion: view.StateVersion,
			Claim:           response,
		})
		// A late response against an already-expired window is a legal
		// race, not a defect: the window resolves on expiry alone.
		if err != nil {
			return false
		}
		return true
	}

	for _, player := range players {
		view := views[player]
		if view.Seat != view.ActiveSeat {
			continue
		}
		switch view.Phase {
		case rulesengine.PhaseAwaitingDraw:
			_, _, err := runtime.Apply(ctx, key, player, rulesengine.MatchCommand{
				RequestID:       fmt.Sprintf("draw-%s-%d", view.Seat, seq),
				Type:            rulesengine.CommandDraw,
				ExpectedVersion: view.StateVersion,
			})
			return err == nil
		case rulesengine.PhaseAwaitingDiscard:
			// Self-turn wins and Gang are part of what a real client can
			// send during its own discard window, so exercise them here.
			if options := view.SelfTurnOptions; options != nil {
				switch {
				case options.CanWin:
					_, _, err := runtime.Apply(ctx, key, player, rulesengine.MatchCommand{
						RequestID:       fmt.Sprintf("zimo-%s-%d", view.Seat, seq),
						Type:            rulesengine.CommandDeclareZimo,
						ExpectedVersion: view.StateVersion,
					})
					return err == nil
				case len(options.ConcealedKongs) > 0:
					_, _, err := runtime.Apply(ctx, key, player, rulesengine.MatchCommand{
						RequestID:       fmt.Sprintf("ankong-%s-%d", view.Seat, seq),
						Type:            rulesengine.CommandDeclareConcealedKong,
						ExpectedVersion: view.StateVersion,
						TileIDs:         options.ConcealedKongs[0],
					})
					return err == nil
				case len(options.AddedKongTileIDs) > 0:
					_, _, err := runtime.Apply(ctx, key, player, rulesengine.MatchCommand{
						RequestID:       fmt.Sprintf("addkong-%s-%d", view.Seat, seq),
						Type:            rulesengine.CommandDeclareAddedKong,
						ExpectedVersion: view.StateVersion,
						TileID:          options.AddedKongTileIDs[0],
					})
					return err == nil
				}
			}
			if len(view.OwnHand) == 0 {
				return false
			}
			_, _, err := runtime.Apply(ctx, key, player, rulesengine.MatchCommand{
				RequestID:       fmt.Sprintf("discard-%s-%d", view.Seat, seq),
				Type:            rulesengine.CommandDiscard,
				ExpectedVersion: view.StateVersion,
				TileID:          view.OwnHand[len(view.OwnHand)-1].ID,
			})
			return err == nil
		}
	}
	return false
}
