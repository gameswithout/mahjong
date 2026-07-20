package match

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/session"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/storage"
	"github.com/gameswithout/mahjong/rulesengine"
)

type fakeMatchRepository struct {
	mu     sync.Mutex
	record storage.MatchRecord
	calls  int
}

type failingResolver struct {
	err error
}

type rejectResolutionOnceStore struct {
	mu       sync.Mutex
	base     *rulesengine.MemoryEventStore
	rejected bool
}

func (s *rejectResolutionOnceStore) Append(ctx context.Context, event rulesengine.MatchEvent) error {
	s.mu.Lock()
	if event.Type == "command."+string(rulesengine.CommandResolveClaims) && !s.rejected {
		s.rejected = true
		s.mu.Unlock()
		return rulesengine.ErrEventSequence
	}
	s.mu.Unlock()
	return s.base.Append(ctx, event)
}

func (s *rejectResolutionOnceStore) Events(
	ctx context.Context,
	matchID string,
) ([]rulesengine.MatchEvent, error) {
	return s.base.Events(ctx, matchID)
}

func (r failingResolver) Roster(context.Context, string, string) ([]string, error) {
	return nil, r.err
}

func (f *fakeMatchRepository) EnsureMatch(
	_ context.Context,
	key storage.MatchKey,
	roster []string,
) (storage.MatchRecord, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if len(roster) != 4 {
		return storage.MatchRecord{}, false, storage.ErrInvalidRoster
	}
	if f.record.RuntimeID == "" {
		// Positional, not literal-string, assignment: every existing caller
		// passes roster == []string{"east", "south", "west", "north"}, so
		// this is behavior-preserving for them, while letting AI-Practice
		// tests supply their own (e.g. bot-ID-flavored) roster in the same
		// East/South/West/North order.
		seatOrder := []rulesengine.Seat{rulesengine.East, rulesengine.South, rulesengine.West, rulesengine.North}
		seats := make(map[string]rulesengine.Seat, 4)
		for index, userID := range roster {
			seats[userID] = seatOrder[index]
		}
		f.record = storage.MatchRecord{
			Key:       key,
			RuntimeID: key.RuntimeID(),
			Seats:     seats,
		}
		return f.record, true, nil
	}
	return f.record, false, nil
}

func (f *fakeMatchRepository) GetMatch(
	_ context.Context,
	_ storage.MatchKey,
) (storage.MatchRecord, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.record.RuntimeID == "" {
		return storage.MatchRecord{}, storage.ErrMatchNotFound
	}
	return f.record, nil
}

func TestRuntimeJoin_UsesFixedRosterAndRestoresSeat(t *testing.T) {
	clock := func() time.Time { return time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC) }
	key := storage.MatchKey{Namespace: "gameswithout-mahjong", SessionID: "session-1", MatchID: "match-1"}
	repository := &fakeMatchRepository{}
	eventStore := rulesengine.NewMemoryEventStore()
	resolver := session.StaticResolver{Members: []string{"east", "south", "west", "north"}}

	firstRuntime := NewRuntime(resolver, repository, eventStore, clock)
	first, err := firstRuntime.Join(context.Background(), key, "east")
	if err != nil {
		t.Fatalf("Join() error = %v", err)
	}
	if first.Seat != rulesengine.East {
		t.Fatalf("Join() seat = %q, want E", first.Seat)
	}

	restartedRuntime := NewRuntime(resolver, repository, eventStore, clock)
	restored, err := restartedRuntime.Join(context.Background(), key, "east")
	if err != nil {
		t.Fatalf("Join() after restart error = %v", err)
	}
	if restored.Seat != first.Seat {
		t.Fatalf("restored seat = %q, want %q", restored.Seat, first.Seat)
	}
	if !reflect.DeepEqual(restored, first) {
		t.Fatal("restored caller projection differs from committed projection")
	}
}

func TestRuntimeJoin_RejectsNonMemberBeforeCreatingMatch(t *testing.T) {
	repository := &fakeMatchRepository{}
	runtime := NewRuntime(
		session.StaticResolver{Members: []string{"east", "south", "west", "north"}},
		repository,
		rulesengine.NewMemoryEventStore(),
		time.Now,
	)
	_, err := runtime.Join(context.Background(), storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "session-1",
		MatchID:   "match-1",
	}, "fifth")
	if !errors.Is(err, ErrNotMember) {
		t.Fatalf("Join() error = %v, want ErrNotMember", err)
	}
	if repository.calls != 0 {
		t.Fatalf("EnsureMatch() calls = %d, want 0", repository.calls)
	}
}

func TestRuntimeJoin_UsesPersistedRosterWithoutRequeryingAGS(t *testing.T) {
	key := storage.MatchKey{Namespace: "gameswithout-mahjong", SessionID: "session-1", MatchID: "match-1"}
	repository := &fakeMatchRepository{record: storage.MatchRecord{
		Key:       key,
		RuntimeID: key.RuntimeID(),
		Seats: map[string]rulesengine.Seat{
			"east":  rulesengine.East,
			"south": rulesengine.South,
			"west":  rulesengine.West,
			"north": rulesengine.North,
		},
	}}
	runtime := NewRuntime(
		failingResolver{err: errors.New("AGS must not be called")},
		repository,
		rulesengine.NewMemoryEventStore(),
		time.Now,
	)
	view, err := runtime.Join(context.Background(), key, "east")
	if err != nil {
		t.Fatalf("Join() error = %v", err)
	}
	if view.Seat != rulesengine.East {
		t.Fatalf("Join() seat = %q, want E", view.Seat)
	}
}

func TestRuntimeViewAndApply_LazilyRestoreOnAnotherReplica(t *testing.T) {
	clock := func() time.Time { return time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC) }
	key := storage.MatchKey{Namespace: "gameswithout-mahjong", SessionID: "session-1", MatchID: "match-1"}
	repository := &fakeMatchRepository{}
	eventStore := rulesengine.NewMemoryEventStore()
	first := NewRuntime(
		session.StaticResolver{Members: []string{"east", "south", "west", "north"}},
		repository,
		eventStore,
		clock,
	)
	joined, err := first.Join(context.Background(), key, "east")
	if err != nil {
		t.Fatalf("first Join() error = %v", err)
	}

	second := NewRuntime(
		failingResolver{err: errors.New("AGS must not be called")},
		repository,
		eventStore,
		clock,
	)
	restored, err := second.View(context.Background(), key, "east")
	if err != nil {
		t.Fatalf("second View() without Join() error = %v", err)
	}
	if !reflect.DeepEqual(restored, joined) {
		t.Fatal("second replica projection differs from joined projection")
	}
	if restored.Phase != rulesengine.PhaseAwaitingDiscard || len(restored.OwnHand) == 0 {
		t.Fatalf("restored phase/hand = %q/%d", restored.Phase, len(restored.OwnHand))
	}
	result, _, err := second.Apply(context.Background(), key, "east", rulesengine.MatchCommand{
		RequestID:       "request-from-second-replica",
		Type:            rulesengine.CommandDiscard,
		ExpectedVersion: restored.StateVersion,
		TileID:          restored.OwnHand[0].ID,
	})
	if err != nil {
		t.Fatalf("second Apply() without Join() error = %v", err)
	}
	if result.Version <= restored.StateVersion {
		t.Fatalf("Apply() version = %d, want greater than %d", result.Version, restored.StateVersion)
	}
	refreshed, err := first.View(context.Background(), key, "east")
	if err != nil {
		t.Fatalf("first View() after second replica command error = %v", err)
	}
	if refreshed.StateVersion != result.Version {
		t.Fatalf("refreshed version = %d, want committed version %d", refreshed.StateVersion, result.Version)
	}
}

func TestRuntimeApply_DuplicateRequestReturnsCommittedResult(t *testing.T) {
	key := storage.MatchKey{Namespace: "gameswithout-mahjong", SessionID: "session-1", MatchID: "match-1"}
	repository := &fakeMatchRepository{}
	eventStore := rulesengine.NewMemoryEventStore()
	runtime := NewRuntime(
		session.StaticResolver{Members: []string{"east", "south", "west", "north"}},
		repository,
		eventStore,
		time.Now,
	)
	view, err := runtime.Join(context.Background(), key, "east")
	if err != nil {
		t.Fatalf("Join() error = %v", err)
	}
	if view.Phase != rulesengine.PhaseAwaitingDiscard || len(view.OwnHand) == 0 {
		t.Fatalf("initial view phase/hand = %q/%d", view.Phase, len(view.OwnHand))
	}
	command := rulesengine.MatchCommand{
		RequestID:       "request-1",
		Type:            rulesengine.CommandDiscard,
		ExpectedVersion: view.StateVersion,
		TileID:          view.OwnHand[0].ID,
	}
	first, _, err := runtime.Apply(context.Background(), key, "east", command)
	if err != nil {
		t.Fatalf("Apply() error = %v", err)
	}
	duplicate, _, err := runtime.Apply(context.Background(), key, "east", command)
	if err != nil {
		t.Fatalf("duplicate Apply() error = %v", err)
	}
	if first.Event.Sequence != duplicate.Event.Sequence || first.StateHash != duplicate.StateHash {
		t.Fatalf("duplicate result = sequence %d hash %q, want %d %q",
			duplicate.Event.Sequence, duplicate.StateHash, first.Event.Sequence, first.StateHash)
	}
	events, err := eventStore.Events(context.Background(), key.RuntimeID())
	if err != nil {
		t.Fatalf("Events() error = %v", err)
	}
	if got, want := len(events), 3; got != want {
		t.Fatalf("event count after duplicate = %d, want %d", got, want)
	}
}

func TestRuntimeViewAndApply_RejectMissingMatchAndNonMember(t *testing.T) {
	key := storage.MatchKey{Namespace: "gameswithout-mahjong", SessionID: "session-1", MatchID: "match-1"}
	repository := &fakeMatchRepository{}
	runtime := NewRuntime(
		session.StaticResolver{Members: []string{"east", "south", "west", "north"}},
		repository,
		rulesengine.NewMemoryEventStore(),
		time.Now,
	)
	if _, err := runtime.View(context.Background(), key, "east"); !errors.Is(err, ErrMatchNotLoaded) {
		t.Fatalf("View() missing match error = %v, want ErrMatchNotLoaded", err)
	}
	if _, _, err := runtime.Apply(context.Background(), key, "east", rulesengine.MatchCommand{
		RequestID: "request-1",
		Type:      rulesengine.CommandDraw,
	}); !errors.Is(err, ErrMatchNotLoaded) {
		t.Fatalf("Apply() missing match error = %v, want ErrMatchNotLoaded", err)
	}
	if _, err := runtime.Join(context.Background(), key, "east"); err != nil {
		t.Fatalf("Join() error = %v", err)
	}
	if _, err := runtime.View(context.Background(), key, "fifth"); !errors.Is(err, ErrNotMember) {
		t.Fatalf("View() non-member error = %v, want ErrNotMember", err)
	}
	if _, _, err := runtime.Apply(context.Background(), key, "east", rulesengine.MatchCommand{
		Type: rulesengine.CommandDiscard,
	}); !errors.Is(err, ErrActionNotAllowed) {
		t.Fatalf("Apply() empty request error = %v, want ErrActionNotAllowed", err)
	}
}

func TestRuntimeApply_RejectsStaleVersionWithoutAppending(t *testing.T) {
	key := storage.MatchKey{Namespace: "gameswithout-mahjong", SessionID: "session-1", MatchID: "match-1"}
	repository := &fakeMatchRepository{}
	eventStore := rulesengine.NewMemoryEventStore()
	runtime := NewRuntime(
		session.StaticResolver{Members: []string{"east", "south", "west", "north"}},
		repository,
		eventStore,
		time.Now,
	)
	view, err := runtime.Join(context.Background(), key, "east")
	if err != nil {
		t.Fatalf("Join() error = %v", err)
	}
	before, err := eventStore.Events(context.Background(), key.RuntimeID())
	if err != nil {
		t.Fatalf("Events() before error = %v", err)
	}
	_, _, err = runtime.Apply(context.Background(), key, "east", rulesengine.MatchCommand{
		RequestID:       "stale-request",
		Type:            rulesengine.CommandDiscard,
		ExpectedVersion: view.StateVersion - 1,
		TileID:          view.OwnHand[0].ID,
	})
	if !errors.Is(err, rulesengine.ErrStaleAction) {
		t.Fatalf("Apply() error = %v, want ErrStaleAction", err)
	}
	after, err := eventStore.Events(context.Background(), key.RuntimeID())
	if err != nil {
		t.Fatalf("Events() after error = %v", err)
	}
	if len(after) != len(before) {
		t.Fatalf("event count after stale command = %d, want %d", len(after), len(before))
	}
}

func TestRuntimeApply_FinalClaimDuplicateReturnsResolution(t *testing.T) {
	clock := func() time.Time { return time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC) }
	key := storage.MatchKey{Namespace: "gameswithout-mahjong", SessionID: "session-1", MatchID: "match-1"}
	repository := &fakeMatchRepository{}
	eventStore := &rejectResolutionOnceStore{base: rulesengine.NewMemoryEventStore()}
	runtime := NewRuntime(
		session.StaticResolver{Members: []string{"east", "south", "west", "north"}},
		repository,
		eventStore,
		clock,
	)
	eastView, err := runtime.Join(context.Background(), key, "east")
	if err != nil {
		t.Fatalf("Join() error = %v", err)
	}
	_, claimView, err := runtime.Apply(context.Background(), key, "east", rulesengine.MatchCommand{
		RequestID:       "discard",
		Type:            rulesengine.CommandDiscard,
		ExpectedVersion: eastView.StateVersion,
		TileID:          eastView.OwnHand[0].ID,
	})
	if err != nil {
		t.Fatalf("discard Apply() error = %v", err)
	}
	if claimView.Claim == nil {
		t.Fatal("discard did not open a claim window")
	}

	var finalCommand rulesengine.MatchCommand
	var finalResult rulesengine.CommandResult
	for _, userID := range []string{"south", "west", "north"} {
		view, viewErr := runtime.View(context.Background(), key, userID)
		if viewErr != nil {
			t.Fatalf("View(%q) error = %v", userID, viewErr)
		}
		command := rulesengine.MatchCommand{
			RequestID:       "pass-" + userID,
			Type:            rulesengine.CommandSubmitClaim,
			ExpectedVersion: view.StateVersion,
			Claim: &rulesengine.ClaimResponse{
				ActionID: view.Claim.ActionID,
				Type:     rulesengine.ClaimPass,
			},
		}
		result, next, applyErr := runtime.Apply(context.Background(), key, userID, command)
		if applyErr != nil {
			t.Fatalf("pass Apply(%q) error = %v", userID, applyErr)
		}
		if userID == "north" {
			finalCommand, finalResult = command, result
			if next.Phase != rulesengine.PhaseAwaitingDraw {
				t.Fatalf("resolved phase = %q, want awaiting_draw", next.Phase)
			}
		}
	}

	duplicate, duplicateView, err := runtime.Apply(context.Background(), key, "north", finalCommand)
	if err != nil {
		t.Fatalf("duplicate final claim Apply() error = %v", err)
	}
	if duplicate.Event.Sequence != finalResult.Event.Sequence ||
		duplicate.StateHash != finalResult.StateHash {
		t.Fatalf("duplicate resolution = sequence %d hash %q, want %d %q",
			duplicate.Event.Sequence, duplicate.StateHash,
			finalResult.Event.Sequence, finalResult.StateHash)
	}
	if duplicateView.Phase != rulesengine.PhaseAwaitingDraw {
		t.Fatalf("duplicate view phase = %q, want awaiting_draw", duplicateView.Phase)
	}
	if !eventStore.rejected {
		t.Fatal("test event store did not inject the claim-resolution sequence race")
	}
}

func TestAuthorizeCommand_RejectsMismatchedClaimAction(t *testing.T) {
	view := rulesengine.SeatView{
		StateVersion: 4,
		Phase:        rulesengine.PhaseClaimWindow,
		Claim: &rulesengine.SeatClaimView{
			ActionID:     "current-claim",
			StateVersion: 4,
			Eligible:     []rulesengine.Seat{rulesengine.South},
		},
	}
	command := rulesengine.MatchCommand{
		Type: rulesengine.CommandSubmitClaim,
		Claim: &rulesengine.ClaimResponse{
			ActionID: "stale-claim",
			Type:     rulesengine.ClaimPass,
		},
	}
	if err := authorizeCommand(view, rulesengine.South, &command); !errors.Is(err, ErrActionNotAllowed) {
		t.Fatalf("authorizeCommand() error = %v, want ErrActionNotAllowed", err)
	}
}

func TestRuntimeDriveLocked_AutoDiscardsExpiredTurn(t *testing.T) {
	clock := time.Date(2026, 7, 19, 8, 0, 0, 0, time.UTC)
	now := func() time.Time { return clock }
	key := storage.MatchKey{Namespace: "gameswithout-mahjong", SessionID: "session-1", MatchID: "match-1"}
	runtime := NewRuntime(
		session.StaticResolver{Members: []string{"east", "south", "west", "north"}},
		&fakeMatchRepository{},
		rulesengine.NewMemoryEventStore(),
		now,
	)
	ctx := context.Background()

	view, err := runtime.Join(ctx, key, "east")
	if err != nil {
		t.Fatalf("Join() error = %v", err)
	}
	if view.Phase != rulesengine.PhaseAwaitingDiscard {
		t.Fatalf("initial phase = %s, want PhaseAwaitingDiscard", view.Phase)
	}

	// Nobody ever submits East's discard. Advance the clock well past any
	// possible §5.10 turn deadline and let a plain View() — as if another
	// seat were just polling for state — drive the timeout.
	clock = clock.Add(20 * time.Second)
	advanced, err := runtime.View(ctx, key, "south")
	if err != nil {
		t.Fatalf("View() after deadline error = %v", err)
	}
	if advanced.Phase != rulesengine.PhaseClaimWindow {
		t.Fatalf("phase after expiry = %s, want PhaseClaimWindow", advanced.Phase)
	}
	if advanced.LastDiscard == nil || advanced.LastDiscard.Seat != rulesengine.East {
		t.Fatalf("last discard = %#v, want East's canonical auto-discard", advanced.LastDiscard)
	}
}

// TestRuntimeDriveLocked_PlaysTakenOverSeatAutomatically drives East, then
// South, then West through a real discard with every other non-North seat
// explicitly passing, leaving North as the only seat that never responds.
// Rotation order E-S-W-N means North is never the discarder in this
// sequence and eligible on all three claim windows, so three consecutive
// unanswered windows land North exactly as it becomes North's own turn —
// taken over, per §8.7/§11.1. From there nobody ever submits a command for
// North; only plain View() calls (as any other seat idly polling would
// make) should be enough to drive North's move.
func TestRuntimeDriveLocked_PlaysTakenOverSeatAutomatically(t *testing.T) {
	clock := time.Date(2026, 7, 19, 8, 0, 0, 0, time.UTC)
	now := func() time.Time { return clock }
	key := storage.MatchKey{Namespace: "gameswithout-mahjong", SessionID: "session-1", MatchID: "match-1"}
	runtime := NewRuntime(
		session.StaticResolver{Members: []string{"east", "south", "west", "north"}},
		&fakeMatchRepository{},
		rulesengine.NewMemoryEventStore(),
		now,
	)
	ctx := context.Background()

	view, err := runtime.Join(ctx, key, "east")
	if err != nil {
		t.Fatalf("east Join() error = %v", err)
	}
	for _, user := range []string{"south", "west", "north"} {
		if _, err := runtime.Join(ctx, key, user); err != nil {
			t.Fatalf("%s Join() error = %v", user, err)
		}
	}

	discarders := []struct {
		user   string
		seat   rulesengine.Seat
		others []string
	}{
		{"east", rulesengine.East, []string{"south", "west"}},
		{"south", rulesengine.South, []string{"east", "west"}},
		{"west", rulesengine.West, []string{"east", "south"}},
	}
	seq := 0
	for _, step := range discarders {
		seq++
		if view.ActiveSeat != step.seat {
			t.Fatalf("expected %s active, got %s", step.seat, view.ActiveSeat)
		}
		tileID := view.OwnHand[0].ID
		if view.Phase == rulesengine.PhaseAwaitingDraw {
			result, _, err := runtime.Apply(ctx, key, step.user, rulesengine.MatchCommand{
				RequestID:       fmt.Sprintf("draw-%d", seq),
				Type:            rulesengine.CommandDraw,
				ExpectedVersion: view.StateVersion,
			})
			if err != nil {
				t.Fatalf("Draw(%s) error = %v", step.user, err)
			}
			tileID = result.Draw.Tile.ID
			if view, err = runtime.View(ctx, key, step.user); err != nil {
				t.Fatalf("View(%s) after draw error = %v", step.user, err)
			}
		}
		if _, _, err := runtime.Apply(ctx, key, step.user, rulesengine.MatchCommand{
			RequestID:       fmt.Sprintf("discard-%d", seq),
			Type:            rulesengine.CommandDiscard,
			ExpectedVersion: view.StateVersion,
			TileID:          tileID,
		}); err != nil {
			t.Fatalf("Discard(%s) error = %v", step.user, err)
		}
		for _, other := range step.others {
			otherView, err := runtime.View(ctx, key, other)
			if err != nil {
				t.Fatalf("View(%s) error = %v", other, err)
			}
			if otherView.Claim == nil {
				t.Fatalf("expected a claim window for %s after %s's discard", other, step.user)
			}
			if _, _, err := runtime.Apply(ctx, key, other, rulesengine.MatchCommand{
				RequestID:       fmt.Sprintf("pass-%d-%s", seq, other),
				Type:            rulesengine.CommandSubmitClaim,
				ExpectedVersion: otherView.StateVersion,
				Claim: &rulesengine.ClaimResponse{
					ActionID: otherView.Claim.ActionID,
					Type:     rulesengine.ClaimPass,
				},
			}); err != nil {
				t.Fatalf("pass(%s) error = %v", other, err)
			}
		}
		// North deliberately never responds -> one AFK strike per round.
		clock = clock.Add(20 * time.Second)
		if view, err = runtime.View(ctx, key, "east"); err != nil {
			t.Fatalf("View() after claim deadline error = %v", err)
		}
	}

	// driveLocked loops until nothing is left to do, so the loop's own final
	// View() already carried North all the way through its takeover-driven
	// draw and discard: nobody ever submitted a single command for North,
	// yet its move is fully reflected here.
	if view.Phase != rulesengine.PhaseClaimWindow || view.LastDiscard == nil || view.LastDiscard.Seat != rulesengine.North {
		t.Fatalf("phase = %s, lastDiscard = %#v, want North's bot-driven discard", view.Phase, view.LastDiscard)
	}
}

// TestRuntimeDriveLocked_RestoresControlAtNextTurnAfterReconnect drives North
// into takeover exactly like TestRuntimeDriveLocked_PlaysTakenOverSeatAutomatically
// (its own bot-driven draw+discard included), then has "north" call View() —
// the §8.7 reconnect signal — while still taken over. Per §8.7 ("a returning
// player regains control at the next legal personal turn"), North should NOT
// be restored immediately mid-cascade; the takeover bot's already-in-flight
// discard stands. Instead, North's very next decision point — its claim
// eligibility on East's following real discard — must be left for a real
// command instead of being auto-driven, proving control was actually handed
// back rather than merely flagged.
func TestRuntimeDriveLocked_RestoresControlAtNextTurnAfterReconnect(t *testing.T) {
	clock := time.Date(2026, 7, 19, 8, 0, 0, 0, time.UTC)
	now := func() time.Time { return clock }
	key := storage.MatchKey{Namespace: "gameswithout-mahjong", SessionID: "session-1", MatchID: "match-1"}
	runtime := NewRuntime(
		session.StaticResolver{Members: []string{"east", "south", "west", "north"}},
		&fakeMatchRepository{},
		rulesengine.NewMemoryEventStore(),
		now,
	)
	ctx := context.Background()

	view, err := runtime.Join(ctx, key, "east")
	if err != nil {
		t.Fatalf("east Join() error = %v", err)
	}
	for _, user := range []string{"south", "west", "north"} {
		if _, err := runtime.Join(ctx, key, user); err != nil {
			t.Fatalf("%s Join() error = %v", user, err)
		}
	}

	discarders := []struct {
		user   string
		seat   rulesengine.Seat
		others []string
	}{
		{"east", rulesengine.East, []string{"south", "west"}},
		{"south", rulesengine.South, []string{"east", "west"}},
		{"west", rulesengine.West, []string{"east", "south"}},
	}
	seq := 0
	for _, step := range discarders {
		seq++
		if view.ActiveSeat != step.seat {
			t.Fatalf("expected %s active, got %s", step.seat, view.ActiveSeat)
		}
		tileID := view.OwnHand[0].ID
		if view.Phase == rulesengine.PhaseAwaitingDraw {
			result, _, err := runtime.Apply(ctx, key, step.user, rulesengine.MatchCommand{
				RequestID:       fmt.Sprintf("draw-%d", seq),
				Type:            rulesengine.CommandDraw,
				ExpectedVersion: view.StateVersion,
			})
			if err != nil {
				t.Fatalf("Draw(%s) error = %v", step.user, err)
			}
			tileID = result.Draw.Tile.ID
			if view, err = runtime.View(ctx, key, step.user); err != nil {
				t.Fatalf("View(%s) after draw error = %v", step.user, err)
			}
		}
		if _, _, err := runtime.Apply(ctx, key, step.user, rulesengine.MatchCommand{
			RequestID:       fmt.Sprintf("discard-%d", seq),
			Type:            rulesengine.CommandDiscard,
			ExpectedVersion: view.StateVersion,
			TileID:          tileID,
		}); err != nil {
			t.Fatalf("Discard(%s) error = %v", step.user, err)
		}
		for _, other := range step.others {
			otherView, err := runtime.View(ctx, key, other)
			if err != nil {
				t.Fatalf("View(%s) error = %v", other, err)
			}
			if otherView.Claim == nil {
				t.Fatalf("expected a claim window for %s after %s's discard", other, step.user)
			}
			if _, _, err := runtime.Apply(ctx, key, other, rulesengine.MatchCommand{
				RequestID:       fmt.Sprintf("pass-%d-%s", seq, other),
				Type:            rulesengine.CommandSubmitClaim,
				ExpectedVersion: otherView.StateVersion,
				Claim: &rulesengine.ClaimResponse{
					ActionID: otherView.Claim.ActionID,
					Type:     rulesengine.ClaimPass,
				},
			}); err != nil {
				t.Fatalf("pass(%s) error = %v", other, err)
			}
		}
		// North deliberately never responds -> one AFK strike per round.
		clock = clock.Add(20 * time.Second)
		if view, err = runtime.View(ctx, key, "east"); err != nil {
			t.Fatalf("View() after claim deadline error = %v", err)
		}
	}

	// North is now taken over and its bot-driven discard already happened
	// as part of the loop's own final View() call (driveLocked runs to
	// completion in one pass) — matches
	// TestRuntimeDriveLocked_PlaysTakenOverSeatAutomatically's end state.
	if view.Phase != rulesengine.PhaseClaimWindow || view.LastDiscard == nil || view.LastDiscard.Seat != rulesengine.North {
		t.Fatalf("phase = %s, lastDiscard = %#v, want North's bot-driven discard", view.Phase, view.LastDiscard)
	}

	// "north" reconnects now, mid-cascade, while still taken over. The
	// already-in-flight bot discard above is not undone; this only sets the
	// pending-restore flag for North's next opportunity.
	if _, err := runtime.View(ctx, key, "north"); err != nil {
		t.Fatalf("north View() (reconnect signal) error = %v", err)
	}

	// East/South/West pass on North's discard; nobody claims, so the next
	// active seat is East (rotation continues past North).
	for _, other := range []string{"east", "south", "west"} {
		otherView, err := runtime.View(ctx, key, other)
		if err != nil {
			t.Fatalf("View(%s) error = %v", other, err)
		}
		if _, _, err := runtime.Apply(ctx, key, other, rulesengine.MatchCommand{
			RequestID:       "post-reconnect-pass-" + other,
			Type:            rulesengine.CommandSubmitClaim,
			ExpectedVersion: otherView.StateVersion,
			Claim:           &rulesengine.ClaimResponse{ActionID: otherView.Claim.ActionID, Type: rulesengine.ClaimPass},
		}); err != nil {
			t.Fatalf("pass(%s) error = %v", other, err)
		}
	}
	eastView, err := runtime.View(ctx, key, "east")
	if err != nil {
		t.Fatalf("View(east) error = %v", err)
	}
	if eastView.ActiveSeat != rulesengine.East || eastView.Phase != rulesengine.PhaseAwaitingDraw {
		t.Fatalf("phase = %s, active = %s, want East awaiting draw", eastView.Phase, eastView.ActiveSeat)
	}
	drawResult, _, err := runtime.Apply(ctx, key, "east", rulesengine.MatchCommand{
		RequestID:       "east-draw-2",
		Type:            rulesengine.CommandDraw,
		ExpectedVersion: eastView.StateVersion,
	})
	if err != nil {
		t.Fatalf("East Draw() error = %v", err)
	}
	discardResult, _, err := runtime.Apply(ctx, key, "east", rulesengine.MatchCommand{
		RequestID:       "east-discard-2",
		Type:            rulesengine.CommandDiscard,
		ExpectedVersion: drawResult.Version,
		TileID:          drawResult.Draw.Tile.ID,
	})
	if err != nil {
		t.Fatalf("East Discard() error = %v", err)
	}
	if discardResult.ClaimWindow == nil || !seatIn(discardResult.ClaimWindow.Eligible, rulesengine.North) {
		t.Fatalf("expected North to be eligible to claim East's discard, got %#v", discardResult.ClaimWindow)
	}

	// This is North's next legal personal turn opportunity. Control must
	// already be restored: repeated View() calls must NOT auto-drive a
	// claim response for North anymore.
	for i := 0; i < 3; i++ {
		polled, err := runtime.View(ctx, key, "east")
		if err != nil {
			t.Fatalf("View() poll %d error = %v", i, err)
		}
		if polled.Claim == nil {
			t.Fatalf("poll %d: North's claim window resolved without North responding — takeover was not restored", i)
		}
	}

	// A real command from "north" must now work normally (control is
	// genuinely restored, not just left stalled).
	northView, err := runtime.View(ctx, key, "north")
	if err != nil {
		t.Fatalf("View(north) error = %v", err)
	}
	if northView.Claim == nil || northView.Claim.ActionID == "" {
		t.Fatalf("north view missing claim window: %#v", northView)
	}
	if _, _, err := runtime.Apply(ctx, key, "north", rulesengine.MatchCommand{
		RequestID:       "north-pass-restored",
		Type:            rulesengine.CommandSubmitClaim,
		ExpectedVersion: northView.StateVersion,
		Claim:           &rulesengine.ClaimResponse{ActionID: northView.Claim.ActionID, Type: rulesengine.ClaimPass},
	}); err != nil {
		t.Fatalf("North's real command after restoration error = %v", err)
	}
}

func concealedPongTilesForTest(kind rulesengine.TileKind, rank uint8) []rulesengine.Tile {
	id := func(copyNumber uint8) string {
		return fmt.Sprintf("%s-%d-%d", kind, rank, copyNumber)
	}
	return []rulesengine.Tile{
		{ID: id(1), Kind: kind, Rank: rank, Copy: 1},
		{ID: id(2), Kind: kind, Rank: rank, Copy: 2},
		{ID: id(3), Kind: kind, Rank: rank, Copy: 3},
	}
}

// TestEnrichedViewAttachesSettlementAndNextDealerOnlyAtHandEnd covers the
// §9.7 items ProjectSeat itself cannot compute (Settlement, NextDealer):
// nil mid-hand, populated identically for every seat once a real discard
// win completes the hand, using the runtime's own hardcoded
// dealer/tier/continuation assumption (matchDealer/matchTier).
func TestEnrichedViewAttachesSettlementAndNextDealerOnlyAtHandEnd(t *testing.T) {
	deal, err := rulesengine.Deal(20260719, [2]uint8{3, 4})
	if err != nil {
		t.Fatalf("Deal() error = %v", err)
	}
	// South holds a complete waiting hand (5 concealed melds + one tile
	// short of the pair): claiming East's dots-5-2 discard completes it.
	south := append(append(append(append(
		concealedPongTilesForTest(rulesengine.Characters, 1),
		concealedPongTilesForTest(rulesengine.Characters, 2)...),
		concealedPongTilesForTest(rulesengine.Characters, 3)...),
		concealedPongTilesForTest(rulesengine.Bamboo, 1)...),
		concealedPongTilesForTest(rulesengine.Bamboo, 2)...)
	south = append(south, rulesengine.Tile{ID: "dots-5-1", Kind: rulesengine.Dots, Rank: 5, Copy: 1})
	deal.Players[1].Hand = south
	deal.Players[0].Hand = []rulesengine.Tile{{ID: "dots-5-2", Kind: rulesengine.Dots, Rank: 5, Copy: 2}}

	clockValue := time.Date(2026, 7, 19, 12, 0, 0, 0, time.UTC)
	clock := func() time.Time { return clockValue }
	engine, err := rulesengine.NewTurnEngine(deal, clock)
	if err != nil {
		t.Fatalf("NewTurnEngine() error = %v", err)
	}
	ctx := context.Background()
	actor, err := rulesengine.NewMatchActor(ctx, "match-settlement", engine, rulesengine.NewMemoryEventStore(), clock)
	if err != nil {
		t.Fatalf("NewMatchActor() error = %v", err)
	}
	if _, err := actor.Apply(ctx, rulesengine.MatchCommand{RequestID: "setup", Type: rulesengine.CommandBeginInitialReplacement}); err != nil {
		t.Fatalf("BeginInitialReplacement error = %v", err)
	}

	midHandView, err := enrichedView(actor, rulesengine.West)
	if err != nil {
		t.Fatalf("enrichedView(West) mid-hand error = %v", err)
	}
	if midHandView.Settlement != nil || midHandView.NextDealer != nil {
		t.Fatalf("Settlement/NextDealer should be nil mid-hand, got %#v / %#v", midHandView.Settlement, midHandView.NextDealer)
	}

	discardView, err := actor.View(rulesengine.East)
	if err != nil {
		t.Fatalf("View(East) error = %v", err)
	}
	discardResult, err := actor.Apply(ctx, rulesengine.MatchCommand{
		RequestID: "east-discard", Type: rulesengine.CommandDiscard,
		ExpectedVersion: discardView.StateVersion, Seat: rulesengine.East, TileID: "dots-5-2",
	})
	if err != nil {
		t.Fatalf("Discard(East) error = %v", err)
	}
	claim := discardResult.Snapshot.Claim
	if claim == nil {
		t.Fatal("expected a claim window after East's discard")
	}
	if _, err := actor.Apply(ctx, rulesengine.MatchCommand{
		RequestID: "south-win", Type: rulesengine.CommandSubmitClaim,
		Claim: &rulesengine.ClaimResponse{Seat: rulesengine.South, Type: rulesengine.ClaimWin, ActionID: claim.ActionID, StateVersion: claim.StateVersion},
	}); err != nil {
		t.Fatalf("SubmitClaim(Win) error = %v", err)
	}
	for _, seat := range []rulesengine.Seat{rulesengine.West, rulesengine.North} {
		if _, err := actor.Apply(ctx, rulesengine.MatchCommand{
			RequestID: "pass-" + string(seat), Type: rulesengine.CommandSubmitClaim,
			Claim: &rulesengine.ClaimResponse{Seat: seat, Type: rulesengine.ClaimPass, ActionID: claim.ActionID, StateVersion: claim.StateVersion},
		}); err != nil {
			t.Fatalf("pass(%s) error = %v", seat, err)
		}
	}
	if _, err := actor.Apply(ctx, rulesengine.MatchCommand{
		RequestID: "resolve", Type: rulesengine.CommandResolveClaims, ExpectedVersion: claim.StateVersion,
	}); err != nil {
		t.Fatalf("ResolveClaims() error = %v", err)
	}
	if actor.Peek().Phase != rulesengine.PhaseHandComplete {
		t.Fatalf("phase = %s, want hand_complete", actor.Peek().Phase)
	}

	for _, seat := range []rulesengine.Seat{rulesengine.East, rulesengine.South, rulesengine.West, rulesengine.North} {
		view, err := enrichedView(actor, seat)
		if err != nil {
			t.Fatalf("enrichedView(%s) error = %v", seat, err)
		}
		if view.HandResult == nil || view.HandResult.Kind != rulesengine.WinDiscard {
			t.Fatalf("seat %s: HandResult = %#v, want a discard win", seat, view.HandResult)
		}
		if view.Settlement == nil {
			t.Fatalf("seat %s: expected Settlement to be attached", seat)
		}
		if view.Settlement.TotalCredits != view.Settlement.TotalDebits || view.Settlement.TotalCredits <= 0 {
			t.Fatalf("seat %s: settlement not balanced/nonzero: %#v", seat, view.Settlement)
		}
		if view.NextDealer == nil {
			t.Fatalf("seat %s: expected NextDealer to be attached", seat)
		}
		// East (the dealer) did not win and did not deal into a draw — the
		// dealer rotates.
		if view.NextDealer.DealerRetains || view.NextDealer.NextDealer != rulesengine.South {
			t.Fatalf("seat %s: NextDealer = %#v, want rotation to South", seat, view.NextDealer)
		}
	}
}

// TestRuntimeAIPractice_BotsPlaySoloMatchAutomatically proves the whole AI
// Practice mechanism end to end at the match-service layer: a roster with
// one real user and three session.IsBotUserID-prefixed IDs (the shape
// AGSResolver.Roster produces for an ai_practice-flagged session) results
// in a match where South/West/North are permanently bot-controlled, and
// their entire draw/discard/claim-response play is driven automatically —
// no command is ever submitted for "bot:1"/"bot:2"/"bot:3", only "human".
func TestRuntimeAIPractice_BotsPlaySoloMatchAutomatically(t *testing.T) {
	clock := time.Date(2026, 7, 19, 8, 0, 0, 0, time.UTC)
	now := func() time.Time { return clock }
	key := storage.MatchKey{Namespace: "gameswithout-mahjong", SessionID: "session-practice", MatchID: "match-practice"}
	runtime := NewRuntime(
		session.StaticResolver{Members: []string{"human", "bot:practice:1", "bot:practice:2", "bot:practice:3"}},
		&fakeMatchRepository{},
		rulesengine.NewMemoryEventStore(),
		now,
	)
	ctx := context.Background()

	view, err := runtime.Join(ctx, key, "human")
	if err != nil {
		t.Fatalf("human Join() error = %v", err)
	}
	if view.ActiveSeat != rulesengine.East {
		t.Fatalf("expected East (human) active first, got %s", view.ActiveSeat)
	}
	for _, player := range view.Players {
		wantBot := player.Seat != rulesengine.East
		if player.IsBot != wantBot {
			t.Fatalf("seat %s IsBot = %v, want %v", player.Seat, player.IsBot, wantBot)
		}
		if player.TakenOver != wantBot {
			t.Fatalf("seat %s TakenOver = %v, want %v", player.Seat, player.TakenOver, wantBot)
		}
	}
	// AI Practice is untimed: nothing for a real human to wait out.
	if view.TurnDeadline != "" {
		t.Fatalf("TurnDeadline = %q, want untimed (AI Practice deadline preset)", view.TurnDeadline)
	}

	seq := 0
	roundsPlayed := 0
	for roundsPlayed < 3 {
		if view.Phase == rulesengine.PhaseHandComplete || view.Phase == rulesengine.PhaseExhaustiveDraw {
			break
		}
		if view.ActiveSeat != rulesengine.East || (view.Phase != rulesengine.PhaseAwaitingDraw && view.Phase != rulesengine.PhaseAwaitingDiscard) {
			t.Fatalf("round %d: expected East awaiting draw/discard, got seat %s phase %s", roundsPlayed, view.ActiveSeat, view.Phase)
		}

		discardVersion := view.StateVersion
		tileID := view.OwnHand[0].ID
		// East is the dealer: their very first turn starts already holding
		// the dealt seventeenth tile (PhaseAwaitingDiscard, no draw step).
		// Every later round is a normal draw-then-discard turn.
		if view.Phase == rulesengine.PhaseAwaitingDraw {
			seq++
			drawResult, _, err := runtime.Apply(ctx, key, "human", rulesengine.MatchCommand{
				RequestID:       fmt.Sprintf("draw-%d", seq),
				Type:            rulesengine.CommandDraw,
				ExpectedVersion: view.StateVersion,
			})
			if err != nil {
				t.Fatalf("round %d: Draw() error = %v", roundsPlayed, err)
			}
			humanView, err := runtime.View(ctx, key, "human")
			if err != nil {
				t.Fatalf("round %d: View() after draw error = %v", roundsPlayed, err)
			}
			discardVersion = humanView.StateVersion
			tileID = drawResult.Draw.Tile.ID
		}

		seq++
		if _, _, err := runtime.Apply(ctx, key, "human", rulesengine.MatchCommand{
			RequestID:       fmt.Sprintf("discard-%d", seq),
			Type:            rulesengine.CommandDiscard,
			ExpectedVersion: discardVersion,
			TileID:          tileID,
		}); err != nil {
			t.Fatalf("round %d: Discard() error = %v", roundsPlayed, err)
		}

		// From here to the human's next decision point, every seat other
		// than East is bot-controlled: South/West/North's draws, discards,
		// and claim-window responses are all driven by driveLocked without
		// this test ever submitting a command on their behalf. The only
		// thing a real human still has to do is answer their OWN claim
		// eligibility, if any, on a bot's discard.
		for step := 0; step < 20; step++ {
			view, err = runtime.View(ctx, key, "human")
			if err != nil {
				t.Fatalf("round %d: View() while draining bot turns error = %v", roundsPlayed, err)
			}
			if view.Phase == rulesengine.PhaseHandComplete || view.Phase == rulesengine.PhaseExhaustiveDraw {
				break
			}
			if view.ActiveSeat == rulesengine.East && view.Phase == rulesengine.PhaseAwaitingDraw {
				break
			}
			if view.Phase == rulesengine.PhaseClaimWindow && view.Claim != nil && view.Claim.OwnResponse == nil &&
				seatIn(view.Claim.Eligible, rulesengine.East) {
				seq++
				if _, _, err := runtime.Apply(ctx, key, "human", rulesengine.MatchCommand{
					RequestID:       fmt.Sprintf("human-pass-%d", seq),
					Type:            rulesengine.CommandSubmitClaim,
					ExpectedVersion: view.StateVersion,
					Claim:           &rulesengine.ClaimResponse{ActionID: view.Claim.ActionID, Type: rulesengine.ClaimPass},
				}); err != nil {
					t.Fatalf("round %d: human Pass() error = %v", roundsPlayed, err)
				}
			}
		}
		roundsPlayed++
	}

	if roundsPlayed == 0 {
		t.Fatal("expected at least one full round to be played")
	}
	// Reaching here already proves the mechanism: roundsPlayed full rounds
	// completed, each requiring South/West/North to draw, discard, and
	// answer claim windows, entirely via driveLocked — this test never
	// once called Apply with a "bot:*" userID.
}

func TestRuntimeMatchLock_DifferentMatchesDoNotBlock(t *testing.T) {
	runtime := NewRuntime(nil, nil, nil, nil)
	first := runtime.matchLock("match-a")
	first.Lock()
	defer first.Unlock()

	acquired := make(chan struct{})
	go func() {
		second := runtime.matchLock("match-b")
		second.Lock()
		close(acquired)
		second.Unlock()
	}()

	select {
	case <-acquired:
	case <-time.After(time.Second):
		t.Fatal("unrelated match lock was blocked by match-a")
	}
	if runtime.matchLock("match-a") != first {
		t.Fatal("matchLock() did not return the stable lock for match-a")
	}
}
