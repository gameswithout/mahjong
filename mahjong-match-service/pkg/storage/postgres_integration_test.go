//go:build integration

package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"reflect"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gameswithout/mahjong/rulesengine"
)

func TestPostgreSQLStorage_ConcurrentStartup(t *testing.T) {
	connectionString := os.Getenv("TEST_DATABASE_URL")
	if connectionString == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}

	const workers = 8
	stores := make(chan *PostgreSQLStorage, workers)
	errorsFound := make(chan error, workers)
	var wait sync.WaitGroup
	for range workers {
		wait.Add(1)
		go func() {
			defer wait.Done()
			store, err := NewPostgreSQLStorage(connectionString)
			if err != nil {
				errorsFound <- err
				return
			}
			stores <- store
		}()
	}
	wait.Wait()
	close(stores)
	close(errorsFound)
	for store := range stores {
		if err := store.Close(context.Background()); err != nil {
			t.Errorf("Close() error = %v", err)
		}
	}
	for err := range errorsFound {
		t.Errorf("NewPostgreSQLStorage() error = %v", err)
	}
}

func TestPostgreSQLStorage_ConcurrentMatchCreationAndEventOrdering(t *testing.T) {
	connectionString := os.Getenv("TEST_DATABASE_URL")
	if connectionString == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	store, err := NewPostgreSQLStorage(connectionString)
	if err != nil {
		t.Fatalf("NewPostgreSQLStorage() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close(context.Background()) })

	key := MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "integration-session-" + randomSuffix(t),
		MatchID:   "match-1",
	}
	t.Cleanup(func() {
		if _, err := store.pool.Exec(
			context.Background(),
			"DELETE FROM matches WHERE runtime_id = $1",
			key.RuntimeID(),
		); err != nil {
			t.Errorf("delete integration match: %v", err)
		}
	})
	roster := []string{"u1", "u2", "u3", "u4"}

	const workers = 8
	var created atomic.Int32
	records := make(chan MatchRecord, workers)
	errorsFound := make(chan error, workers)
	var wait sync.WaitGroup
	for index := 0; index < workers; index++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			record, wasCreated, err := store.EnsureMatch(context.Background(), key, roster)
			if err != nil {
				errorsFound <- err
				return
			}
			if wasCreated {
				created.Add(1)
			}
			records <- record
		}()
	}
	wait.Wait()
	close(records)
	close(errorsFound)
	for err := range errorsFound {
		t.Errorf("EnsureMatch() error = %v", err)
	}
	if got := created.Load(); got != 1 {
		t.Fatalf("created count = %d, want 1", got)
	}
	var canonical MatchRecord
	for record := range records {
		if canonical.RuntimeID == "" {
			canonical = record
			continue
		}
		if record.RuntimeID != canonical.RuntimeID || !reflect.DeepEqual(record.Seats, canonical.Seats) {
			t.Fatalf("concurrent record differs: %#v != %#v", record, canonical)
		}
	}

	first := rulesengine.MatchEvent{
		Sequence:     1,
		MatchID:      canonical.RuntimeID,
		Type:         "match.created",
		RequestID:    "server:create",
		OccurredAt:   time.Now().UTC(),
		StateVersion: 1,
		StateHash:    "hash-1",
		Snapshot:     []byte(`{"version":1}`),
	}
	if err := store.Append(context.Background(), first); err != nil {
		t.Fatalf("Append(first) error = %v", err)
	}
	if err := store.Append(context.Background(), rulesengine.MatchEvent{
		Sequence:     3,
		MatchID:      canonical.RuntimeID,
		Type:         "command.applied",
		RequestID:    "request-out-of-order",
		OccurredAt:   time.Now().UTC(),
		StateVersion: 2,
		StateHash:    "hash-2",
	}); !errors.Is(err, rulesengine.ErrEventSequence) {
		t.Fatalf("Append(out of order) error = %v, want ErrEventSequence", err)
	}
	second := rulesengine.MatchEvent{
		Sequence:     2,
		MatchID:      canonical.RuntimeID,
		Type:         "command.applied",
		RequestID:    "request-1",
		OccurredAt:   time.Now().UTC(),
		StateVersion: 2,
		StateHash:    "hash-2",
		Command:      []byte(`{"type":"discard"}`),
	}
	if err := store.Append(context.Background(), second); err != nil {
		t.Fatalf("Append(second) error = %v", err)
	}
	events, err := store.Events(context.Background(), canonical.RuntimeID)
	if err != nil {
		t.Fatalf("Events() error = %v", err)
	}
	if len(events) != 2 || events[0].Sequence != 1 || events[1].Sequence != 2 {
		t.Fatalf("Events() = %#v", events)
	}
	head, err := store.LastSequence(context.Background(), canonical.RuntimeID)
	if err != nil {
		t.Fatalf("LastSequence() error = %v", err)
	}
	if head != 2 {
		t.Fatalf("LastSequence() = %d, want 2", head)
	}
}

func BenchmarkPostgreSQLStorage_Append(b *testing.B) {
	connectionString := os.Getenv("TEST_DATABASE_URL")
	if connectionString == "" {
		b.Skip("TEST_DATABASE_URL is not set")
	}
	store, err := NewPostgreSQLStorage(connectionString)
	if err != nil {
		b.Fatalf("NewPostgreSQLStorage() error = %v", err)
	}
	b.Cleanup(func() { _ = store.Close(context.Background()) })

	key := MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "benchmark-session-" + benchmarkRandomSuffix(b),
		MatchID:   "match-1",
	}
	record, _, err := store.EnsureMatch(
		context.Background(),
		key,
		[]string{"u1", "u2", "u3", "u4"},
	)
	if err != nil {
		b.Fatalf("EnsureMatch() error = %v", err)
	}
	b.Cleanup(func() {
		if _, err := store.pool.Exec(
			context.Background(),
			"DELETE FROM matches WHERE runtime_id = $1",
			record.RuntimeID,
		); err != nil {
			b.Errorf("delete benchmark match: %v", err)
		}
	})

	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		event := rulesengine.MatchEvent{
			Sequence:     uint64(index + 1),
			MatchID:      record.RuntimeID,
			Type:         "benchmark.append",
			RequestID:    "benchmark-" + strconv.Itoa(index),
			OccurredAt:   time.Now().UTC(),
			StateVersion: uint64(index + 1),
			StateHash:    "benchmark-state-hash",
			Command:      []byte(`{"type":"benchmark"}`),
		}
		if err := store.Append(context.Background(), event); err != nil {
			b.Fatalf("Append(%d) error = %v", index+1, err)
		}
	}
}

func BenchmarkPostgreSQLStorage_LastSequence(b *testing.B) {
	connectionString := os.Getenv("TEST_DATABASE_URL")
	if connectionString == "" {
		b.Skip("TEST_DATABASE_URL is not set")
	}
	store, err := NewPostgreSQLStorage(connectionString)
	if err != nil {
		b.Fatalf("NewPostgreSQLStorage() error = %v", err)
	}
	b.Cleanup(func() { _ = store.Close(context.Background()) })

	key := MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "benchmark-session-" + benchmarkRandomSuffix(b),
		MatchID:   "match-1",
	}
	record, _, err := store.EnsureMatch(
		context.Background(),
		key,
		[]string{"u1", "u2", "u3", "u4"},
	)
	if err != nil {
		b.Fatalf("EnsureMatch() error = %v", err)
	}
	b.Cleanup(func() {
		if _, err := store.pool.Exec(
			context.Background(),
			"DELETE FROM matches WHERE runtime_id = $1",
			record.RuntimeID,
		); err != nil {
			b.Errorf("delete benchmark match: %v", err)
		}
	})
	if err := store.Append(context.Background(), rulesengine.MatchEvent{
		Sequence:     1,
		MatchID:      record.RuntimeID,
		Type:         "benchmark.created",
		RequestID:    "benchmark-created",
		OccurredAt:   time.Now().UTC(),
		StateVersion: 1,
		StateHash:    "benchmark-state-hash",
	}); err != nil {
		b.Fatalf("Append() error = %v", err)
	}

	b.ResetTimer()
	for range b.N {
		sequence, err := store.LastSequence(context.Background(), record.RuntimeID)
		if err != nil {
			b.Fatalf("LastSequence() error = %v", err)
		}
		if sequence != 1 {
			b.Fatalf("LastSequence() = %d, want 1", sequence)
		}
	}
}

func randomSuffix(t *testing.T) string {
	t.Helper()
	var value [8]byte
	if _, err := rand.Read(value[:]); err != nil {
		t.Fatalf("rand.Read() error = %v", err)
	}
	return hex.EncodeToString(value[:])
}

func benchmarkRandomSuffix(b *testing.B) string {
	b.Helper()
	var value [8]byte
	if _, err := rand.Read(value[:]); err != nil {
		b.Fatalf("rand.Read() error = %v", err)
	}
	return hex.EncodeToString(value[:])
}
