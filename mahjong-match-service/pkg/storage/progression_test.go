package storage

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/gameswithout/mahjong/rulesengine"
)

func TestMatchHistoryResultDistinguishesPersonalOutcomes(t *testing.T) {
	discard := &rulesengine.HandResult{
		Kind:    rulesengine.WinDiscard,
		Payer:   rulesengine.East,
		Winners: []rulesengine.HandWinner{{Seat: rulesengine.South}},
	}
	if got := matchHistoryResult(discard, rulesengine.South); got != "Win" {
		t.Fatalf("winner result = %q, want Win", got)
	}
	if got := matchHistoryResult(discard, rulesengine.East); got != "Loss" {
		t.Fatalf("payer result = %q, want Loss", got)
	}
	if got := matchHistoryResult(discard, rulesengine.West); got != "Neutral" {
		t.Fatalf("uninvolved result = %q, want Neutral", got)
	}
	if got := matchHistoryResult(&rulesengine.HandResult{Kind: rulesengine.KindExhaustiveDraw}, rulesengine.North); got != "Draw" {
		t.Fatalf("exhaustive result = %q, want Draw", got)
	}
	if got := matchHistoryResult(&rulesengine.HandResult{Kind: rulesengine.WinZimo, Winners: []rulesengine.HandWinner{{Seat: rulesengine.South}}}, rulesengine.West); got != "Loss" {
		t.Fatalf("zimo opponent result = %q, want Loss", got)
	}
}

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
