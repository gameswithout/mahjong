package protocol

import (
	"encoding/json"
	"testing"
	"time"
)

func TestReadyEnvelopeIsVersionedAndStable(t *testing.T) {
	message, err := Ready("guest-123", "request-1", time.Date(2026, 7, 18, 1, 2, 3, 4, time.UTC))
	if err != nil {
		t.Fatalf("Ready() error = %v", err)
	}

	encoded, err := json.Marshal(message)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}

	got := string(encoded)
	want := `{"v":1,"type":"server.ready","request_id":"request-1","payload":{"user_id":"guest-123","server_time":"2026-07-18T01:02:03.000000004Z"}}`
	if got != want {
		t.Fatalf("encoded envelope = %s, want %s", got, want)
	}
}
