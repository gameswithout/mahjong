package match

import (
	"context"
	"errors"
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
		f.record = storage.MatchRecord{
			Key:       key,
			RuntimeID: key.RuntimeID(),
			Seats: map[string]rulesengine.Seat{
				"east":  rulesengine.East,
				"south": rulesengine.South,
				"west":  rulesengine.West,
				"north": rulesengine.North,
			},
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
