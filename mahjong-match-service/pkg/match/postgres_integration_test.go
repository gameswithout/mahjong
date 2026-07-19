//go:build integration

package match

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/session"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/storage"
	"github.com/gameswithout/mahjong/rulesengine"
	"github.com/jackc/pgx/v5"
)

func TestRuntime_ConcurrentReplicaInitialization(t *testing.T) {
	connectionString := os.Getenv("TEST_DATABASE_URL")
	if connectionString == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	store, err := storage.NewPostgreSQLStorage(connectionString)
	if err != nil {
		t.Fatalf("NewPostgreSQLStorage() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close(context.Background()) })

	resolver := session.StaticResolver{Members: []string{"east", "south", "west", "north"}}
	first := NewRuntime(resolver, store, store, time.Now)
	second := NewRuntime(resolver, store, store, time.Now)
	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "replica-session-" + matchRandomSuffix(t),
		MatchID:   "match-1",
	}
	cleanupPostgreSQLMatch(t, connectionString, key)

	start := make(chan struct{})
	errorsFound := make(chan error, 2)
	views := make(chan rulesengine.SeatView, 2)
	var wait sync.WaitGroup
	for _, runtime := range []*Runtime{first, second} {
		runtime := runtime
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			view, err := runtime.Join(context.Background(), key, "east")
			views <- view
			errorsFound <- err
		}()
	}
	close(start)
	wait.Wait()
	close(errorsFound)
	close(views)
	for err := range errorsFound {
		if err != nil {
			t.Errorf("concurrent Join() error = %v", err)
		}
	}
	var canonical rulesengine.SeatView
	for view := range views {
		if canonical.MatchID == "" {
			canonical = view
			continue
		}
		if !reflect.DeepEqual(view, canonical) {
			t.Fatalf("replica projections differ: %#v != %#v", view, canonical)
		}
	}
}

func TestRuntime_ConcurrentReplicaCommandsRefreshLoser(t *testing.T) {
	connectionString := os.Getenv("TEST_DATABASE_URL")
	if connectionString == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	store, err := storage.NewPostgreSQLStorage(connectionString)
	if err != nil {
		t.Fatalf("NewPostgreSQLStorage() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close(context.Background()) })

	resolver := session.StaticResolver{Members: []string{"east", "south", "west", "north"}}
	first := NewRuntime(resolver, store, store, time.Now)
	second := NewRuntime(resolver, store, store, time.Now)
	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "command-session-" + matchRandomSuffix(t),
		MatchID:   "match-1",
	}
	cleanupPostgreSQLMatch(t, connectionString, key)
	var eastUser string
	var firstView rulesengine.SeatView
	for _, userID := range resolver.Members {
		view, joinErr := first.Join(context.Background(), key, userID)
		if joinErr != nil {
			t.Fatalf("first Join(%q) error = %v", userID, joinErr)
		}
		if view.Seat == rulesengine.East {
			eastUser = userID
			firstView = view
		}
	}
	if eastUser == "" {
		t.Fatal("persisted roster has no East seat")
	}
	secondView, err := second.View(context.Background(), key, eastUser)
	if err != nil {
		t.Fatalf("second View() without Join() error = %v", err)
	}
	if firstView.StateVersion != secondView.StateVersion || len(firstView.OwnHand) < 2 {
		t.Fatalf("replica views are not aligned: %d/%d", firstView.StateVersion, secondView.StateVersion)
	}

	commands := []struct {
		runtime *Runtime
		command rulesengine.MatchCommand
	}{
		{
			runtime: first,
			command: rulesengine.MatchCommand{
				RequestID:       "request-a",
				Type:            rulesengine.CommandDiscard,
				ExpectedVersion: firstView.StateVersion,
				TileID:          firstView.OwnHand[0].ID,
			},
		},
		{
			runtime: second,
			command: rulesengine.MatchCommand{
				RequestID:       "request-b",
				Type:            rulesengine.CommandDiscard,
				ExpectedVersion: secondView.StateVersion,
				TileID:          secondView.OwnHand[1].ID,
			},
		},
	}

	start := make(chan struct{})
	results := make(chan error, len(commands))
	var wait sync.WaitGroup
	for _, item := range commands {
		item := item
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			_, _, err := item.runtime.Apply(context.Background(), key, eastUser, item.command)
			results <- err
		}()
	}
	close(start)
	wait.Wait()
	close(results)

	var successes, stale int
	for err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, rulesengine.ErrStaleAction):
			stale++
		default:
			t.Errorf("Apply() error = %v", err)
		}
	}
	if successes != 1 || stale != 1 {
		t.Fatalf("command outcomes: successes=%d stale=%d, want 1/1", successes, stale)
	}
	for index, runtime := range []*Runtime{first, second} {
		view, err := runtime.View(context.Background(), key, eastUser)
		if err != nil {
			t.Fatalf("runtime %d View() error = %v", index, err)
		}
		if view.StateVersion != firstView.StateVersion+1 {
			t.Fatalf("runtime %d state version = %d, want %d", index, view.StateVersion, firstView.StateVersion+1)
		}
	}
}

func TestRuntime_ConcurrentReplicaDuplicateRequestReturnsCommittedResult(t *testing.T) {
	connectionString := os.Getenv("TEST_DATABASE_URL")
	if connectionString == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	store, err := storage.NewPostgreSQLStorage(connectionString)
	if err != nil {
		t.Fatalf("NewPostgreSQLStorage() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close(context.Background()) })

	resolver := session.StaticResolver{Members: []string{"east", "south", "west", "north"}}
	first := NewRuntime(resolver, store, store, time.Now)
	second := NewRuntime(resolver, store, store, time.Now)
	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "duplicate-session-" + matchRandomSuffix(t),
		MatchID:   "match-1",
	}
	cleanupPostgreSQLMatch(t, connectionString, key)
	var eastUser string
	var eastView rulesengine.SeatView
	for _, userID := range resolver.Members {
		view, joinErr := first.Join(context.Background(), key, userID)
		if joinErr != nil {
			t.Fatalf("first Join(%q) error = %v", userID, joinErr)
		}
		if view.Seat == rulesengine.East {
			eastUser, eastView = userID, view
		}
	}
	command := rulesengine.MatchCommand{
		RequestID:       "same-request",
		Type:            rulesengine.CommandDiscard,
		ExpectedVersion: eastView.StateVersion,
		TileID:          eastView.OwnHand[0].ID,
	}

	start := make(chan struct{})
	results := make(chan rulesengine.CommandResult, 2)
	errorsFound := make(chan error, 2)
	var wait sync.WaitGroup
	for _, runtime := range []*Runtime{first, second} {
		runtime := runtime
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			result, _, err := runtime.Apply(context.Background(), key, eastUser, command)
			results <- result
			errorsFound <- err
		}()
	}
	close(start)
	wait.Wait()
	close(results)
	close(errorsFound)
	for err := range errorsFound {
		if err != nil {
			t.Errorf("duplicate Apply() error = %v", err)
		}
	}
	var sequence uint64
	for result := range results {
		if sequence == 0 {
			sequence = result.Event.Sequence
		}
		if result.Event.Sequence != sequence {
			t.Fatalf("duplicate event sequence = %d, want %d", result.Event.Sequence, sequence)
		}
	}
	events, err := store.Events(context.Background(), key.RuntimeID())
	if err != nil {
		t.Fatalf("Events() error = %v", err)
	}
	if got, want := len(events), 3; got != want {
		t.Fatalf("event count = %d, want %d", got, want)
	}
}

func matchRandomSuffix(t *testing.T) string {
	t.Helper()
	var value [8]byte
	if _, err := rand.Read(value[:]); err != nil {
		t.Fatalf("rand.Read() error = %v", err)
	}
	return hex.EncodeToString(value[:])
}

func cleanupPostgreSQLMatch(t *testing.T, connectionString string, key storage.MatchKey) {
	t.Helper()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		connection, err := pgx.Connect(ctx, connectionString)
		if err != nil {
			t.Errorf("connect for integration cleanup: %v", err)
			return
		}
		defer func() {
			if err := connection.Close(ctx); err != nil {
				t.Errorf("close integration cleanup connection: %v", err)
			}
		}()
		if _, err := connection.Exec(
			ctx,
			"DELETE FROM matches WHERE runtime_id = $1",
			key.RuntimeID(),
		); err != nil {
			t.Errorf("delete integration match: %v", err)
		}
	})
}
