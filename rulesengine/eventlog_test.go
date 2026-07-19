package rulesengine

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMatchActorAppendsBeforeAckAndDeduplicatesRequests(t *testing.T) {
	store := NewMemoryEventStore()
	clock := time.Date(2026, 7, 18, 2, 0, 0, 0, time.UTC)
	actor, err := NewMatchActor(context.Background(), "match-1", newInitialTurn(t, turnFixture(t)), store, func() time.Time { return clock })
	if err != nil {
		t.Fatalf("NewMatchActor() error = %v", err)
	}
	first, err := actor.Apply(context.Background(), MatchCommand{MatchID: "match-1", RequestID: "r1", Type: CommandBeginInitialReplacement})
	if err != nil {
		t.Fatalf("BeginInitialReplacement error = %v", err)
	}
	duplicate, err := actor.Apply(context.Background(), MatchCommand{MatchID: "match-1", RequestID: "r1", Type: CommandBeginInitialReplacement})
	if err != nil {
		t.Fatalf("duplicate request error = %v", err)
	}
	if duplicate.Event.Sequence != first.Event.Sequence {
		t.Fatalf("duplicate sequence = %d, want %d", duplicate.Event.Sequence, first.Event.Sequence)
	}
	if actor.Sequence() != 2 {
		t.Fatalf("Sequence() = %d, want 2", actor.Sequence())
	}
	previous, found := actor.Previous("r1")
	if !found || previous.Event.Sequence != first.Event.Sequence {
		t.Fatalf("Previous(r1) = sequence %d, %v", previous.Event.Sequence, found)
	}
	if _, found := actor.Previous("missing"); found {
		t.Fatal("Previous(missing) unexpectedly found a result")
	}
	events, err := actor.Events(context.Background())
	if err != nil {
		t.Fatalf("Events() error = %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("event count = %d, want created + one command", len(events))
	}
	if actor.engine.Phase != PhaseAwaitingDiscard {
		t.Fatalf("phase after command = %s", actor.engine.Phase)
	}
}

func TestMatchActorDoesNotAcknowledgeWhenStoreAppendFails(t *testing.T) {
	store := &failAfterFirstAppendStore{inner: NewMemoryEventStore()}
	actor, err := NewMatchActor(context.Background(), "match-2", newInitialTurn(t, turnFixture(t)), store, time.Now)
	if err != nil {
		t.Fatalf("NewMatchActor() error = %v", err)
	}
	_, err = actor.Apply(context.Background(), MatchCommand{MatchID: "match-2", RequestID: "r1", Type: CommandBeginInitialReplacement})
	if err == nil {
		t.Fatal("Apply() unexpectedly acknowledged failed append")
	}
	if actor.engine.Phase != PhaseInitialReplacement || actor.engine.Version != 1 {
		t.Fatalf("engine changed after failed append: %#v", actor.engine.Snapshot())
	}
}

func TestMatchActorFileRecoveryReplaysIdenticalState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.jsonl")
	store, err := NewFileEventStore(path)
	if err != nil {
		t.Fatalf("NewFileEventStore() error = %v", err)
	}
	clock := time.Date(2026, 7, 18, 3, 0, 0, 0, time.UTC)
	actor, err := NewMatchActor(context.Background(), "match-3", newInitialTurn(t, turnFixture(t)), store, func() time.Time { return clock })
	if err != nil {
		t.Fatalf("NewMatchActor() error = %v", err)
	}
	if _, err := actor.Apply(context.Background(), MatchCommand{MatchID: "match-3", RequestID: "setup", Type: CommandBeginInitialReplacement}); err != nil {
		t.Fatalf("setup error = %v", err)
	}
	view, err := actor.View(East)
	if err != nil {
		t.Fatalf("View() error = %v", err)
	}
	if view.StateVersion != 2 || view.Phase != PhaseAwaitingDiscard {
		t.Fatalf("setup view = %d/%s", view.StateVersion, view.Phase)
	}
	if _, err := actor.Apply(context.Background(), MatchCommand{MatchID: "match-3", RequestID: "discard", Type: CommandDiscard, ExpectedVersion: 2, Seat: East, TileID: view.OwnHand[0].ID}); err != nil {
		t.Fatalf("discard error = %v", err)
	}

	restored, err := RestoreMatchActor(context.Background(), "match-3", store, func() time.Time { return clock.Add(24 * time.Hour) })
	if err != nil {
		t.Fatalf("RestoreMatchActor() error = %v", err)
	}
	want, err := actor.View(East)
	if err != nil {
		t.Fatalf("original view error = %v", err)
	}
	got, err := restored.View(East)
	if err != nil {
		t.Fatalf("restored view error = %v", err)
	}
	wantJSON, _ := json.Marshal(want)
	gotJSON, _ := json.Marshal(got)
	if string(wantJSON) != string(gotJSON) {
		t.Fatalf("restored view differs\nwant %s\ngot  %s", wantJSON, gotJSON)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("event file missing: %v", err)
	}
}

func TestMatchActorRecoveryUsesCommittedTimestampForTimeDerivedState(t *testing.T) {
	store := &timestampTruncatingEventStore{inner: NewMemoryEventStore()}
	next := time.Date(2026, 7, 18, 3, 0, 0, 123, time.UTC)
	clock := func() time.Time {
		current := next
		next = next.Add(137 * time.Nanosecond)
		return current
	}
	actor, err := NewMatchActor(context.Background(), "match-clock", newInitialTurn(t, turnFixture(t)), store, clock)
	if err != nil {
		t.Fatalf("NewMatchActor() error = %v", err)
	}
	if _, err := actor.Apply(context.Background(), MatchCommand{
		MatchID:   "match-clock",
		RequestID: "setup",
		Type:      CommandBeginInitialReplacement,
	}); err != nil {
		t.Fatalf("setup error = %v", err)
	}
	view, err := actor.View(East)
	if err != nil {
		t.Fatalf("View() error = %v", err)
	}
	if _, err := actor.Apply(context.Background(), MatchCommand{
		MatchID:         "match-clock",
		RequestID:       "discard",
		Type:            CommandDiscard,
		ExpectedVersion: view.StateVersion,
		Seat:            East,
		TileID:          view.OwnHand[0].ID,
	}); err != nil {
		t.Fatalf("discard error = %v", err)
	}
	if _, err := RestoreMatchActor(context.Background(), "match-clock", store, time.Now); err != nil {
		t.Fatalf("RestoreMatchActor() with advancing command clock error = %v", err)
	}
}

func TestRestoreRejectsReplayHashMismatch(t *testing.T) {
	inner := NewMemoryEventStore()
	actor, err := NewMatchActor(context.Background(), "match-tamper", newInitialTurn(t, turnFixture(t)), inner, time.Now)
	if err != nil {
		t.Fatalf("NewMatchActor() error = %v", err)
	}
	if _, err := actor.Apply(context.Background(), MatchCommand{MatchID: "match-tamper", RequestID: "setup", Type: CommandBeginInitialReplacement}); err != nil {
		t.Fatalf("setup error = %v", err)
	}
	tampered := &tamperingEventStore{inner: inner}
	if _, err := RestoreMatchActor(context.Background(), "match-tamper", tampered, time.Now); err == nil {
		t.Fatal("RestoreMatchActor() accepted a tampered state hash")
	}
}

func TestSeatProjectionRedactsConcealedHandsWallAndOtherClaimResponses(t *testing.T) {
	state := turnFixture(t)
	state.Players[0].Hand = []Tile{tile("characters-2-1", Characters, 2, 1), tile("dots-8-1", Dots, 8, 1)}
	state.Players[2].Hand = []Tile{tile("characters-2-2", Characters, 2, 2), tile("characters-2-3", Characters, 2, 3)}
	engine := newTurnForClaims(t, state, nil)
	window := discardForClaims(t, engine, "characters-2-1")
	if err := engine.SubmitClaim(ClaimResponse{Seat: South, Type: ClaimPass, StateVersion: window.StateVersion, ResponseRevision: 0}); err != nil {
		t.Fatalf("South response error = %v", err)
	}
	if err := engine.SubmitClaim(ClaimResponse{Seat: West, Type: ClaimPong, TileIDs: []string{"characters-2-2", "characters-2-3"}, StateVersion: window.StateVersion, ResponseRevision: 0}); err != nil {
		t.Fatalf("West response error = %v", err)
	}
	view, err := engine.ProjectSeat("match-4", South)
	if err != nil {
		t.Fatalf("ProjectSeat() error = %v", err)
	}
	encoded, err := json.Marshal(view)
	if err != nil {
		t.Fatalf("view JSON error = %v", err)
	}
	text := string(encoded)
	if !strings.Contains(text, "characters-2-1") || strings.Contains(text, "characters-2-2") || strings.Contains(text, "characters-2-3") {
		t.Fatalf("projection did not preserve public/private boundaries: %s", text)
	}
	if strings.Contains(text, "dots-8-1") {
		t.Fatalf("projection leaked another concealed hand: %s", text)
	}
	if len(view.Players[2].Exposed) != 0 || view.Players[2].HandCount != 2 {
		t.Fatalf("other player view = %#v", view.Players[2])
	}
	if view.Claim == nil || view.Claim.OwnResponse == nil || view.Claim.OwnResponse.Seat != South {
		t.Fatalf("own claim response missing: %#v", view.Claim)
	}
	views, err := engine.ProjectAll("match-4")
	if err != nil {
		t.Fatalf("ProjectAll() error = %v", err)
	}
	if len(views) != 4 {
		t.Fatalf("ProjectAll() view count = %d, want 4", len(views))
	}
	for _, seat := range seats {
		if views[seat].Seat != seat {
			t.Errorf("ProjectAll()[%s].Seat = %s", seat, views[seat].Seat)
		}
	}
}

type failAfterFirstAppendStore struct {
	inner *MemoryEventStore
	count int
}

func (s *failAfterFirstAppendStore) Append(ctx context.Context, event MatchEvent) error {
	s.count++
	if s.count > 1 {
		return errors.New("simulated append failure")
	}
	return s.inner.Append(ctx, event)
}

func (s *failAfterFirstAppendStore) Events(ctx context.Context, matchID string) ([]MatchEvent, error) {
	return s.inner.Events(ctx, matchID)
}

type tamperingEventStore struct {
	inner *MemoryEventStore
}

type timestampTruncatingEventStore struct {
	inner *MemoryEventStore
}

func (s *timestampTruncatingEventStore) Append(ctx context.Context, event MatchEvent) error {
	event.OccurredAt = event.OccurredAt.Truncate(time.Microsecond)
	return s.inner.Append(ctx, event)
}

func (s *timestampTruncatingEventStore) Events(ctx context.Context, matchID string) ([]MatchEvent, error) {
	return s.inner.Events(ctx, matchID)
}

func (s *tamperingEventStore) Append(ctx context.Context, event MatchEvent) error {
	return s.inner.Append(ctx, event)
}

func (s *tamperingEventStore) Events(ctx context.Context, matchID string) ([]MatchEvent, error) {
	events, err := s.inner.Events(ctx, matchID)
	if err != nil {
		return nil, err
	}
	if len(events) > 1 {
		events[1].StateHash = "tampered"
	}
	return events, nil
}

func newInitialTurn(t *testing.T, state *DealState) *TurnEngine {
	t.Helper()
	clock := time.Date(2026, 7, 18, 1, 2, 3, 0, time.UTC)
	engine, err := NewTurnEngine(state, func() time.Time { return clock })
	if err != nil {
		t.Fatalf("NewTurnEngine() error = %v", err)
	}
	return engine
}
