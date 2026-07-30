//go:build integration

package match

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/session"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/storage"
	"github.com/gameswithout/mahjong/rulesengine"
)

// Full Rotation end to end, against real storage.
//
// The rotation container is Postgres-only — the idempotent fold is a
// conditional UPDATE inside a transaction, which is the whole point of it — so
// these tests need a database rather than a fake.

func rotationRuntime(t *testing.T, players []string, now func() time.Time) (*Runtime, *storage.PostgreSQLStorage) {
	t.Helper()
	connectionString := os.Getenv("TEST_DATABASE_URL")
	if connectionString == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	store, err := storage.NewPostgreSQLStorage(connectionString)
	if err != nil {
		t.Fatalf("NewPostgreSQLStorage() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close(context.Background()) })

	runtime := NewRuntime(
		session.StaticResolver{Members: players, SessionMode: session.ModeFullRotation},
		store,
		store,
		now,
	)
	runtime.SetRotations(store)
	return runtime, store
}

// playRotation drives a rotation to completion the way four browser clients
// would: everyone polls, whoever owes a decision acts, and the clock advances
// far enough that turn deadlines and the inter-hand pause actually elapse.
//
// It returns the last view each player saw and how many distinct hands were
// played.
func playRotation(
	t *testing.T,
	runtime *Runtime,
	key storage.MatchKey,
	players []string,
	clock *time.Time,
	maxSteps int,
) (map[string]TableView, map[string]bool) {
	t.Helper()
	ctx := context.Background()
	handsSeen := map[string]bool{}
	views := make(map[string]TableView, len(players))

	for _, player := range players {
		view, err := runtime.Join(ctx, key, player)
		if err != nil {
			t.Fatalf("%s Join() error = %v", player, err)
		}
		views[player] = view
	}

	seq := 0
	for step := 0; step < maxSteps; step++ {
		for _, player := range players {
			view, err := runtime.View(ctx, key, player)
			if err != nil {
				t.Fatalf("step %d: %s View() error = %v", step, player, err)
			}
			views[player] = view
			handsSeen[view.HandRuntimeID] = true
		}

		any := views[players[0]]
		if any.Rotation == nil {
			t.Fatalf("step %d: view has no rotation state", step)
		}
		if any.Rotation.Complete {
			return views, handsSeen
		}

		seq++
		acted := actOnce(ctx, t, runtime, key, players, views, seq)
		advanceRotationClock(clock, acted, any.Phase)
	}
	return views, handsSeen
}

// advanceRotationClock moves the simulated clock the way a real table moves
// it: a couple of seconds per action, past the turn deadline when a seat has
// gone quiet, and past the inter-hand pause when a result is on screen.
//
// The pacing matters. §8.4 gives a match 60 minutes, so a harness that burns
// simulated time faster than players do ends every rotation on the time limit
// and never exercises the round running its course.
func advanceRotationClock(clock *time.Time, acted bool, phase rulesengine.TurnPhase) {
	switch {
	case phase == rulesengine.PhaseHandComplete, phase == rulesengine.PhaseExhaustiveDraw:
		*clock = clock.Add(InterHandPause + time.Second)
	case !acted:
		*clock = clock.Add(45 * time.Second)
	default:
		*clock = clock.Add(2 * time.Second)
	}
}

func TestRotation_PlaysEveryDealerAndEnds(t *testing.T) {
	// Several deals, because how a rotation ends depends on how long its hands
	// run. Both endings are legitimate — §8.4 expects some matches to reach the
	// 60-minute limit, which is why it makes their share a telemetry metric —
	// so every attempt must end cleanly, and across the set the round must be
	// seen running its full course at least once.
	players := []string{"rot-east", "rot-south", "rot-west", "rot-north"}
	sawFullRound := false

	for attempt := 0; attempt < 4; attempt++ {
		clock := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
		runtime, _ := rotationRuntime(t, players, func() time.Time { return clock })
		key := storage.MatchKey{
			Namespace: "gameswithout-mahjong",
			SessionID: "rotation-" + matchRandomSuffix(t),
			MatchID:   fmt.Sprintf("match-%d", attempt),
		}

		views, handsSeen := playRotation(t, runtime, key, players, &clock, 6000)
		final := views[players[0]].Rotation
		if final == nil || !final.Complete {
			t.Fatalf("attempt %d: rotation did not complete: %#v", attempt, final)
		}
		// The point of Full Rotation: more than one hand. A single-hand match
		// would satisfy neither ending.
		if len(handsSeen) < 2 {
			t.Fatalf("attempt %d: played %d distinct hands, want at least 2", attempt, len(handsSeen))
		}
		switch final.Reason {
		case rulesengine.RotationCompletedRound:
			sawFullRound = true
			// The round only ends when every table position has dealt, which
			// §5.11 continuations can postpone indefinitely.
			for _, standing := range final.Standings {
				if !standing.HasDealt {
					t.Fatalf(
						"attempt %d: %s never dealt but the round completed",
						attempt, standing.UserID,
					)
				}
			}
			if final.SeatsDealt != rulesengine.SeatCount {
				t.Fatalf("attempt %d: seats dealt = %d", attempt, final.SeatsDealt)
			}
		case rulesengine.RotationCompletedTimeLimit:
			// A match cut short is "structurally asymmetric" (§8.4) and may
			// legitimately leave a position that never dealt.
		default:
			t.Fatalf("attempt %d: completion reason = %q", attempt, final.Reason)
		}
		if len(final.Placements) != rulesengine.SeatCount {
			t.Fatalf("attempt %d: podium has %d entries", attempt, len(final.Placements))
		}
	}

	if !sawFullRound {
		t.Fatal("no attempt ever completed the round, so only the time-limit ending is reachable")
	}
}

func TestRotation_TablePointsAlwaysBalance(t *testing.T) {
	// §8.4 table points are a transfer between players: whatever one wins, the
	// others lose. A non-zero total would mean points were created or
	// destroyed, which no settlement rule allows.
	players := []string{"bal-east", "bal-south", "bal-west", "bal-north"}
	clock := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	runtime, _ := rotationRuntime(t, players, func() time.Time { return clock })
	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "rotation-" + matchRandomSuffix(t),
		MatchID:   "match-1",
	}

	views, _ := playRotation(t, runtime, key, players, &clock, 4000)
	final := views[players[0]].Rotation
	if final == nil {
		t.Fatal("no rotation state")
	}
	var total int64
	for _, standing := range final.Standings {
		total += standing.TablePoints
	}
	if total != 0 {
		t.Fatalf("table points total %d, want 0 — points were created or destroyed", total)
	}
}

func TestRotation_SeatsAreFixedAndWindsTurn(t *testing.T) {
	// A player keeps their chair for the whole rotation; what changes is the
	// wind they play, which turns with the dealership. Getting this backwards
	// would move players around the table mid-match.
	players := []string{"seat-east", "seat-south", "seat-west", "seat-north"}
	clock := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	runtime, _ := rotationRuntime(t, players, func() time.Time { return clock })
	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "rotation-" + matchRandomSuffix(t),
		MatchID:   "match-1",
	}
	ctx := context.Background()

	for _, player := range players {
		if _, err := runtime.Join(ctx, key, player); err != nil {
			t.Fatalf("%s Join() error = %v", player, err)
		}
	}
	positions := map[string]rulesengine.Seat{}
	windsByHand := map[int]map[string]rulesengine.Seat{}

	seq := 0
	for step := 0; step < 4000; step++ {
		views := make(map[string]TableView, len(players))
		for _, player := range players {
			view, err := runtime.View(ctx, key, player)
			if err != nil {
				t.Fatalf("step %d: %s View() error = %v", step, player, err)
			}
			views[player] = view
		}
		rotation := views[players[0]].Rotation
		if rotation == nil {
			t.Fatal("no rotation state")
		}
		hand := rotation.HandNumber
		if windsByHand[hand] == nil {
			windsByHand[hand] = map[string]rulesengine.Seat{}
		}
		for _, standing := range rotation.Standings {
			if known, seen := positions[standing.UserID]; seen && known != standing.Position {
				t.Fatalf(
					"%s moved from table position %s to %s during the rotation",
					standing.UserID, known, standing.Position,
				)
			}
			positions[standing.UserID] = standing.Position
			windsByHand[hand][standing.UserID] = standing.Wind
		}
		// The player whose wind is East must be the one dealing, in every hand.
		for _, standing := range rotation.Standings {
			if standing.Wind == rulesengine.East && standing.UserID != rotation.DealerUserID {
				t.Fatalf(
					"hand %d: %s plays East but %s is dealing",
					hand, standing.UserID, rotation.DealerUserID,
				)
			}
		}
		if rotation.Complete {
			break
		}
		seq++
		acted := actOnce(ctx, t, runtime, key, players, views, seq)
		advanceRotationClock(&clock, acted, views[players[0]].Phase)
	}

	if len(windsByHand) < 2 {
		t.Fatalf("only saw %d hands, cannot tell whether winds turned", len(windsByHand))
	}
	// At least one player must have played a different wind in a later hand,
	// or the dealership never actually moved.
	turned := false
	var reference map[string]rulesengine.Seat
	for hand := 1; hand <= len(windsByHand); hand++ {
		winds := windsByHand[hand]
		if len(winds) == 0 {
			continue
		}
		if reference == nil {
			reference = winds
			continue
		}
		for userID, wind := range winds {
			if reference[userID] != wind {
				turned = true
			}
		}
	}
	if !turned {
		t.Fatal("no player's wind ever changed, so the dealership never moved")
	}
}

func TestRotation_RepeatedPollsDoNotDoubleCount(t *testing.T) {
	// Every replica sees a completed hand; only one may fold it. If the fold
	// were not idempotent the standings would drift upward on every poll, and
	// nothing downstream would notice because settlement stays balanced.
	players := []string{"idem-east", "idem-south", "idem-west", "idem-north"}
	clock := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	now := func() time.Time { return clock }
	runtime, store := rotationRuntime(t, players, now)
	// A second runtime over the same storage stands in for another replica.
	second := NewRuntime(
		session.StaticResolver{Members: players, SessionMode: session.ModeFullRotation},
		store, store, now,
	)
	second.SetRotations(store)

	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "rotation-" + matchRandomSuffix(t),
		MatchID:   "match-1",
	}
	ctx := context.Background()
	for _, player := range players {
		if _, err := runtime.Join(ctx, key, player); err != nil {
			t.Fatalf("%s Join() error = %v", player, err)
		}
	}

	// Play exactly one hand to completion.
	seq := 0
	var completed TableView
	for step := 0; step < 2000; step++ {
		views := make(map[string]TableView, len(players))
		for _, player := range players {
			view, err := runtime.View(ctx, key, player)
			if err != nil {
				t.Fatalf("step %d: %s View() error = %v", step, player, err)
			}
			views[player] = view
		}
		if views[players[0]].Phase == rulesengine.PhaseHandComplete ||
			views[players[0]].Phase == rulesengine.PhaseExhaustiveDraw {
			completed = views[players[0]]
			break
		}
		seq++
		if !actOnce(ctx, t, runtime, key, players, views, seq) || step%7 == 6 {
			clock = clock.Add(45 * time.Second)
		} else {
			clock = clock.Add(2 * time.Second)
		}
	}
	if completed.Rotation == nil {
		t.Fatal("never reached a completed hand")
	}
	baseline := map[string]int64{}
	for _, standing := range completed.Rotation.Standings {
		baseline[standing.UserID] = standing.TablePoints
	}
	if completed.Rotation.HandsPlayed != 1 {
		t.Fatalf("hands played = %d after one hand", completed.Rotation.HandsPlayed)
	}

	// Poll the finished hand many times from both replicas, without letting
	// the inter-hand pause elapse.
	for round := 0; round < 12; round++ {
		for _, player := range players {
			for _, replica := range []*Runtime{runtime, second} {
				view, err := replica.View(ctx, key, player)
				if err != nil {
					t.Fatalf("repeat poll: %s View() error = %v", player, err)
				}
				if view.Rotation.HandsPlayed != 1 {
					t.Fatalf(
						"hands played = %d after repeat polls, want 1 — the fold ran twice",
						view.Rotation.HandsPlayed,
					)
				}
				for _, standing := range view.Rotation.Standings {
					if standing.TablePoints != baseline[standing.UserID] {
						t.Fatalf(
							"%s has %d table points on a repeat poll, want %d — the hand was counted twice",
							standing.UserID, standing.TablePoints, baseline[standing.UserID],
						)
					}
				}
			}
		}
	}
}

func TestRotation_QuickPlayIsUnaffected(t *testing.T) {
	// A Quick Play session must still be a single staked hand with no rotation
	// attached, whatever the rotation machinery does.
	players := []string{"qp-east", "qp-south", "qp-west", "qp-north"}
	clock := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	connectionString := os.Getenv("TEST_DATABASE_URL")
	if connectionString == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	store, err := storage.NewPostgreSQLStorage(connectionString)
	if err != nil {
		t.Fatalf("NewPostgreSQLStorage() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close(context.Background()) })

	runtime := NewRuntime(
		session.StaticResolver{Members: players},
		store, store,
		func() time.Time { return clock },
	)
	runtime.SetRotations(store)
	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "quickplay-" + matchRandomSuffix(t),
		MatchID:   "match-1",
	}
	ctx := context.Background()
	view, err := runtime.Join(ctx, key, players[0])
	if err != nil {
		t.Fatalf("Join() error = %v", err)
	}
	if view.Rotation != nil {
		t.Fatalf("Quick Play session produced a rotation: %#v", view.Rotation)
	}
	if view.HandRuntimeID != key.RuntimeID() {
		t.Fatalf(
			"Quick Play hand runtime ID = %q, want the match's own %q",
			view.HandRuntimeID, key.RuntimeID(),
		)
	}
}

func TestRotation_NextHandWaitsOutTheInterHandPause(t *testing.T) {
	players := []string{"pause-east", "pause-south", "pause-west", "pause-north"}
	clock := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	runtime, _ := rotationRuntime(t, players, func() time.Time { return clock })
	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "rotation-" + matchRandomSuffix(t),
		MatchID:   "match-1",
	}
	ctx := context.Background()
	for _, player := range players {
		if _, err := runtime.Join(ctx, key, player); err != nil {
			t.Fatalf("%s Join() error = %v", player, err)
		}
	}

	seq := 0
	var firstHandID string
	for step := 0; step < 2000; step++ {
		views := make(map[string]TableView, len(players))
		for _, player := range players {
			view, err := runtime.View(ctx, key, player)
			if err != nil {
				t.Fatalf("step %d: %s View() error = %v", step, player, err)
			}
			views[player] = view
		}
		current := views[players[0]]
		if current.Phase == rulesengine.PhaseHandComplete ||
			current.Phase == rulesengine.PhaseExhaustiveDraw {
			firstHandID = current.HandRuntimeID
			if current.Rotation.NextHandOpensAt == nil {
				t.Fatal("a finished hand mid-rotation must announce when the next one opens")
			}
			break
		}
		seq++
		if !actOnce(ctx, t, runtime, key, players, views, seq) || step%7 == 6 {
			clock = clock.Add(45 * time.Second)
		} else {
			clock = clock.Add(2 * time.Second)
		}
	}
	if firstHandID == "" {
		t.Fatal("never reached a completed hand")
	}

	// Just short of the pause, the result is still what everyone sees.
	clock = clock.Add(InterHandPause - time.Second)
	view, err := runtime.View(ctx, key, players[0])
	if err != nil {
		t.Fatalf("View() error = %v", err)
	}
	if view.HandRuntimeID != firstHandID {
		t.Fatal("the next hand opened before the result had been on screen for the full pause")
	}

	// Past it, the next hand is dealt.
	clock = clock.Add(2 * time.Second)
	view, err = runtime.View(ctx, key, players[0])
	if err != nil {
		t.Fatalf("View() error = %v", err)
	}
	if view.HandRuntimeID == firstHandID {
		t.Fatal("the next hand never opened after the pause elapsed")
	}
	if view.Rotation.HandNumber != 2 {
		t.Fatalf("second hand reported as hand %d", view.Rotation.HandNumber)
	}
}

func TestRotation_TimeLimitEndsTheMatchDistinctly(t *testing.T) {
	// §8.4's 60-minute stop is a different ending from the round running its
	// course, and its frequency is a required telemetry metric — so a match
	// cut short must say so rather than look like a normal finish.
	players := []string{"limit-east", "limit-south", "limit-west", "limit-north"}
	clock := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	runtime, _ := rotationRuntime(t, players, func() time.Time { return clock })
	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "rotation-" + matchRandomSuffix(t),
		MatchID:   "match-1",
	}
	ctx := context.Background()
	for _, player := range players {
		if _, err := runtime.Join(ctx, key, player); err != nil {
			t.Fatalf("%s Join() error = %v", player, err)
		}
	}

	// Play the first hand out, then jump past the limit before it is folded.
	seq := 0
	for step := 0; step < 2000; step++ {
		views := make(map[string]TableView, len(players))
		for _, player := range players {
			view, err := runtime.View(ctx, key, player)
			if err != nil {
				t.Fatalf("step %d: %s View() error = %v", step, player, err)
			}
			views[player] = view
		}
		current := views[players[0]]
		if current.Rotation.Complete {
			break
		}
		if current.Phase == rulesengine.PhaseHandComplete ||
			current.Phase == rulesengine.PhaseExhaustiveDraw {
			// The hand has been folded already by the poll above; the rotation
			// is not complete, so push the clock past the 60-minute limit and
			// let the next hand run into it.
			clock = clock.Add(rulesengine.MatchTimeLimit)
			continue
		}
		seq++
		if !actOnce(ctx, t, runtime, key, players, views, seq) || step%7 == 6 {
			clock = clock.Add(45 * time.Second)
		} else {
			clock = clock.Add(2 * time.Second)
		}
	}

	view, err := runtime.View(ctx, key, players[0])
	if err != nil {
		t.Fatalf("View() error = %v", err)
	}
	if !view.Rotation.Complete {
		t.Fatal("the match ran past the 60-minute limit without ending")
	}
	if view.Rotation.Reason != rulesengine.RotationCompletedTimeLimit {
		t.Fatalf(
			"completion reason = %q, want the time limit — a match cut short must be distinguishable",
			view.Rotation.Reason,
		)
	}
	if len(view.Rotation.Placements) != rulesengine.SeatCount {
		t.Fatalf("a completed match must still produce a full podium, got %d", len(view.Rotation.Placements))
	}
}

func TestRotation_FinalPlacementsRankEveryPlayer(t *testing.T) {
	players := []string{"place-east", "place-south", "place-west", "place-north"}
	clock := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	runtime, _ := rotationRuntime(t, players, func() time.Time { return clock })
	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "rotation-" + matchRandomSuffix(t),
		MatchID:   "match-1",
	}

	views, _ := playRotation(t, runtime, key, players, &clock, 4000)
	rotation := views[players[0]].Rotation
	if rotation == nil || !rotation.Complete {
		t.Fatal("rotation did not complete")
	}
	if len(rotation.Placements) != rulesengine.SeatCount {
		t.Fatalf("placements = %d, want %d", len(rotation.Placements), rulesengine.SeatCount)
	}
	seen := map[string]bool{}
	for index, placement := range rotation.Placements {
		if placement.Position != index+1 {
			t.Fatalf("placement %d has position %d", index, placement.Position)
		}
		if placement.UserID == "" {
			t.Fatalf("placement %d names no player", index)
		}
		if seen[placement.UserID] {
			t.Fatalf("%s placed twice", placement.UserID)
		}
		seen[placement.UserID] = true
		if index > 0 && rotation.Placements[index-1].TablePoints < placement.TablePoints {
			t.Fatal("placements are not ordered by table points")
		}
	}
	// Every player must appear, including anyone who finished on negative
	// points — §8.4 lets table points go below zero.
	for _, player := range players {
		if !seen[player] {
			t.Fatalf("%s is missing from the podium", player)
		}
	}
	fmt.Fprintf(os.Stderr, "rotation ended %q after %d hands\n", rotation.Reason, rotation.HandsPlayed)
}
