package storage

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/gameswithout/mahjong/rulesengine"
)

func TestTakenOverMajorityFromEventsUsesElapsedControlTime(t *testing.T) {
	start := time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC)
	events := []rulesengine.MatchEvent{
		progressionSnapshotEvent(t, start, false, true),
		progressionSnapshotEvent(t, start.Add(10*time.Second), true, false),
		progressionSnapshotEvent(t, start.Add(40*time.Second), true, false),
	}

	got, err := takenOverMajorityFromEvents(events, rulesengine.East)
	if err != nil {
		t.Fatalf("takenOverMajorityFromEvents() error = %v", err)
	}
	if !got {
		t.Fatal("30 seconds of takeover in a 40-second hand was not a majority")
	}
}

func TestTakenOverMajorityFromEventsRequiresMoreThanHalf(t *testing.T) {
	start := time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC)
	events := []rulesengine.MatchEvent{
		progressionSnapshotEvent(t, start, false, true),
		progressionSnapshotEvent(t, start.Add(20*time.Second), true, false),
		progressionSnapshotEvent(t, start.Add(40*time.Second), true, false),
	}

	got, err := takenOverMajorityFromEvents(events, rulesengine.East)
	if err != nil {
		t.Fatalf("takenOverMajorityFromEvents() error = %v", err)
	}
	if got {
		t.Fatal("exactly half of the hand under takeover counted as a majority")
	}
}

func TestTakenOverMajorityFromEventsRejectsCorruptHistory(t *testing.T) {
	events := []rulesengine.MatchEvent{
		{OccurredAt: time.Now(), Snapshot: json.RawMessage(`{"turn":{}}`)},
		{OccurredAt: time.Now().Add(time.Second), Result: json.RawMessage(`{`)},
	}
	if _, err := takenOverMajorityFromEvents(events, rulesengine.East); err == nil {
		t.Fatal("corrupt event history was accepted")
	}
}

func progressionSnapshotEvent(
	t *testing.T,
	at time.Time,
	takenOver bool,
	created bool,
) rulesengine.MatchEvent {
	t.Helper()
	snapshot := rulesengine.TurnSnapshot{}
	if takenOver {
		snapshot.TakenOver = []rulesengine.Seat{rulesengine.East}
	}
	var (
		encoded []byte
		err     error
	)
	if created {
		encoded, err = json.Marshal(struct {
			Turn rulesengine.TurnSnapshot `json:"turn"`
		}{Turn: snapshot})
	} else {
		encoded, err = json.Marshal(rulesengine.CommandResult{Snapshot: snapshot})
	}
	if err != nil {
		t.Fatalf("marshal progression event: %v", err)
	}
	event := rulesengine.MatchEvent{OccurredAt: at}
	if created {
		event.Snapshot = encoded
	} else {
		event.Result = encoded
	}
	return event
}
