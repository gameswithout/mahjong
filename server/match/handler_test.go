package match

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gameswithout/mahjong/rulesengine"
	"github.com/gameswithout/mahjong/server/auth"
	"github.com/gameswithout/mahjong/server/protocol"
	"github.com/gorilla/websocket"
)

func TestHandlerAuthenticatesAndServesTypedPing(t *testing.T) {
	handler := &Handler{
		Verifier: StaticVerifier{Principal: auth.Principal{UserID: "guest-123"}},
		Now: func() time.Time {
			return time.Date(2026, 7, 18, 1, 2, 3, 4, time.UTC)
		},
	}
	server := httptest.NewServer(handler)
	defer server.Close()

	wsURL := "ws" + server.URL[len("http"):]
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Authorization": []string{"Bearer token"}})
	if err != nil {
		t.Fatalf("Dial() error = %v", err)
	}
	defer conn.Close()

	var ready protocol.Envelope
	if err := conn.ReadJSON(&ready); err != nil {
		t.Fatalf("ReadJSON(ready) error = %v", err)
	}
	if ready.Type != "server.ready" || ready.Version != protocol.Version {
		t.Fatalf("ready envelope = %#v", ready)
	}
	if string(ready.Payload) == "" || string(ready.Payload) == "token" {
		t.Fatalf("ready payload unexpectedly contains token")
	}

	ping, err := protocol.NewEnvelope("ping", "request-1", map[string]string{"client_time": "now"})
	if err != nil {
		t.Fatalf("NewEnvelope() error = %v", err)
	}
	if err := conn.WriteJSON(ping); err != nil {
		t.Fatalf("WriteJSON(ping) error = %v", err)
	}

	var pong protocol.Envelope
	if err := conn.ReadJSON(&pong); err != nil {
		t.Fatalf("ReadJSON(pong) error = %v", err)
	}
	if pong.Type != "pong" || pong.RequestID != "request-1" {
		t.Fatalf("pong envelope = %#v", pong)
	}
}

func TestHandlerRejectsMissingTokenBeforeUpgrade(t *testing.T) {
	handler := &Handler{Verifier: StaticVerifier{Principal: auth.Principal{UserID: "guest-123"}}}
	server := httptest.NewServer(handler)
	defer server.Close()

	wsURL := "ws" + server.URL[len("http"):]
	_, response, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatal("Dial() unexpectedly succeeded")
	}
	if response == nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("response = %#v, error = %v", response, err)
	}
}

func TestHandlerReportsUnknownMessage(t *testing.T) {
	handler := &Handler{Verifier: StaticVerifier{Principal: auth.Principal{UserID: "guest-123"}}}
	server := httptest.NewServer(handler)
	defer server.Close()

	wsURL := "ws" + server.URL[len("http"):]
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Authorization": []string{"Bearer token"}})
	if err != nil {
		t.Fatalf("Dial() error = %v", err)
	}
	defer conn.Close()
	_, _, _ = conn.ReadMessage()

	unknown := protocol.Envelope{Version: protocol.Version, Type: "table.play"}
	if err := conn.WriteJSON(unknown); err != nil {
		t.Fatalf("WriteJSON(unknown) error = %v", err)
	}

	var response protocol.Envelope
	if err := conn.ReadJSON(&response); err != nil {
		t.Fatalf("ReadJSON(error) error = %v", err)
	}
	if response.Type != "error" {
		t.Fatalf("response type = %q", response.Type)
	}
	var payload protocol.ErrorPayload
	if err := json.Unmarshal(response.Payload, &payload); err != nil {
		t.Fatalf("json.Unmarshal(error payload) error = %v", err)
	}
	if payload.Code != "protocol.unknown_message" {
		t.Fatalf("error code = %q", payload.Code)
	}
}

func TestAccessTokenFromWebSocketSubprotocol(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "http://localhost", nil)
	req.Header.Set("Sec-WebSocket-Protocol", "ags.bearer, ags.token.dG9rZW4tMTIz")
	if got := accessTokenFromRequest(req); got != "token-123" {
		t.Fatalf("token = %q", got)
	}
}

func TestHandlerNegotiatesFixedBearerProtocolWithoutEchoingToken(t *testing.T) {
	handler := &Handler{Verifier: tokenVerifier{"token-123": "guest-123"}}
	server := httptest.NewServer(handler)
	defer server.Close()

	wsURL := "ws" + server.URL[len("http"):]
	dialer := websocket.Dialer{Subprotocols: []string{"ags.bearer", "ags.token.dG9rZW4tMTIz"}}
	conn, response, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Dial() error = %v", err)
	}
	defer conn.Close()
	if conn.Subprotocol() != "ags.bearer" {
		t.Fatalf("selected protocol = %q", conn.Subprotocol())
	}
	selected := response.Header.Get("Sec-WebSocket-Protocol")
	if selected != "ags.bearer" || strings.Contains(selected, "token") || strings.Contains(selected, "dG9r") {
		t.Fatalf("unsafe selected protocol = %q", selected)
	}
}

func TestRuntimeAssignsStableSeatsAndAuthorizesActiveSeat(t *testing.T) {
	runtime := NewRuntime(rulesengine.NewMemoryEventStore(), func() time.Time {
		return time.Date(2026, 7, 18, 4, 0, 0, 0, time.UTC)
	})
	east, eastView, err := runtime.Join(context.Background(), "session-1", "user-east")
	if err != nil {
		t.Fatalf("Join(east) error = %v", err)
	}
	south, _, err := runtime.Join(context.Background(), "session-1", "user-south")
	if err != nil {
		t.Fatalf("Join(south) error = %v", err)
	}
	reconnected, _, err := runtime.Join(context.Background(), "session-1", "user-east")
	if err != nil {
		t.Fatalf("Join(reconnect) error = %v", err)
	}
	if east != rulesengine.East || south != rulesengine.South || reconnected != east {
		t.Fatalf("assigned seats = %s, %s, reconnect %s", east, south, reconnected)
	}

	request := protocol.MatchCommandRequest{
		MatchID:         "session-1",
		Type:            rulesengine.CommandDiscard,
		ExpectedVersion: eastView.StateVersion,
		TileID:          eastView.OwnHand[0].ID,
	}
	if _, err := runtime.Apply(context.Background(), "session-1", "user-south", "discard-wrong-seat", request); !errors.Is(err, ErrMatchAction) {
		t.Fatalf("South Discard() error = %v", err)
	}
	result, err := runtime.Apply(context.Background(), "session-1", "user-east", "discard-1", request)
	if err != nil {
		t.Fatalf("East Discard() error = %v", err)
	}
	if result.Phase != rulesengine.PhaseClaimWindow {
		t.Fatalf("phase = %s, want claim window", result.Phase)
	}
	duplicate, err := runtime.Apply(context.Background(), "session-1", "user-east", "discard-1", request)
	if err != nil {
		t.Fatalf("duplicate Discard() error = %v", err)
	}
	if duplicate.Event.Sequence != result.Event.Sequence {
		t.Fatalf("duplicate event sequence = %d, want %d", duplicate.Event.Sequence, result.Event.Sequence)
	}

	for index, userID := range []string{"user-west", "user-north"} {
		if _, _, err := runtime.Join(context.Background(), "session-1", userID); err != nil {
			t.Fatalf("Join(extra %d) error = %v", index, err)
		}
	}
	if _, _, err := runtime.Join(context.Background(), "session-1", "user-fifth"); !errors.Is(err, ErrMatchFull) {
		t.Fatalf("fifth Join() error = %v", err)
	}
}

func TestRuntimeRecoversActorAndIdempotentResult(t *testing.T) {
	store := rulesengine.NewMemoryEventStore()
	clock := func() time.Time {
		return time.Date(2026, 7, 18, 4, 30, 0, 0, time.UTC)
	}
	firstRuntime := NewRuntime(store, clock)
	_, initial, err := firstRuntime.Join(context.Background(), "session-recover", "user-east")
	if err != nil {
		t.Fatalf("first Join() error = %v", err)
	}
	request := protocol.MatchCommandRequest{
		MatchID:         "session-recover",
		Type:            rulesengine.CommandDiscard,
		ExpectedVersion: initial.StateVersion,
		TileID:          initial.OwnHand[0].ID,
	}
	first, err := firstRuntime.Apply(context.Background(), "session-recover", "user-east", "discard-recover", request)
	if err != nil {
		t.Fatalf("first Discard() error = %v", err)
	}

	recoveredRuntime := NewRuntime(store, func() time.Time { return clock().Add(time.Hour) })
	seat, recoveredView, err := recoveredRuntime.Join(context.Background(), "session-recover", "user-east")
	if err != nil {
		t.Fatalf("recovered Join() error = %v", err)
	}
	if seat != rulesengine.East || recoveredView.StateVersion != first.Version ||
		recoveredView.Phase != rulesengine.PhaseClaimWindow {
		t.Fatalf("recovered state = seat %s version %d phase %s", seat, recoveredView.StateVersion, recoveredView.Phase)
	}
	duplicate, err := recoveredRuntime.Apply(context.Background(), "session-recover", "user-east", "discard-recover", request)
	if err != nil {
		t.Fatalf("recovered duplicate Discard() error = %v", err)
	}
	if duplicate.Event.Sequence != first.Event.Sequence {
		t.Fatalf("recovered duplicate sequence = %d, want %d", duplicate.Event.Sequence, first.Event.Sequence)
	}
}

func TestRuntimeResolvesAllPassesAndAdvancesToNextDraw(t *testing.T) {
	runtime := NewRuntime(rulesengine.NewMemoryEventStore(), func() time.Time {
		return time.Date(2026, 7, 18, 4, 45, 0, 0, time.UTC)
	})
	users := []string{"user-east", "user-south", "user-west", "user-north"}
	views := make(map[string]rulesengine.SeatView, len(users))
	for _, userID := range users {
		_, view, err := runtime.Join(context.Background(), "session-passes", userID)
		if err != nil {
			t.Fatalf("Join(%s) error = %v", userID, err)
		}
		views[userID] = view
	}

	east := views["user-east"]
	discarded, err := runtime.Apply(context.Background(), "session-passes", "user-east", "discard-opening", protocol.MatchCommandRequest{
		MatchID:         "session-passes",
		Type:            rulesengine.CommandDiscard,
		ExpectedVersion: east.StateVersion,
		TileID:          east.OwnHand[0].ID,
	})
	if err != nil {
		t.Fatalf("opening Discard() error = %v", err)
	}
	if discarded.Phase != rulesengine.PhaseClaimWindow {
		t.Fatalf("discard phase = %s", discarded.Phase)
	}

	var resolved rulesengine.CommandResult
	for _, userID := range users[1:] {
		resolved, err = runtime.Apply(context.Background(), "session-passes", userID, "pass-"+userID, protocol.MatchCommandRequest{
			MatchID:         "session-passes",
			Type:            rulesengine.CommandSubmitClaim,
			ExpectedVersion: discarded.Version,
			Claim:           &rulesengine.ClaimResponse{Type: rulesengine.ClaimPass},
		})
		if err != nil {
			t.Fatalf("Pass(%s) error = %v", userID, err)
		}
	}
	if resolved.Phase != rulesengine.PhaseAwaitingDraw || resolved.Version != discarded.Version+1 {
		t.Fatalf("resolved phase/version = %s/%d", resolved.Phase, resolved.Version)
	}
	southView, err := runtime.View("session-passes", "user-south")
	if err != nil {
		t.Fatalf("South View() error = %v", err)
	}
	if southView.ActiveSeat != rulesengine.South || southView.Phase != rulesengine.PhaseAwaitingDraw {
		t.Fatalf("South view active/phase = %s/%s", southView.ActiveSeat, southView.Phase)
	}

	duplicate, err := runtime.Apply(context.Background(), "session-passes", "user-north", "pass-user-north", protocol.MatchCommandRequest{
		MatchID:         "session-passes",
		Type:            rulesengine.CommandSubmitClaim,
		ExpectedVersion: discarded.Version,
		Claim:           &rulesengine.ClaimResponse{Type: rulesengine.ClaimPass},
	})
	if err != nil {
		t.Fatalf("duplicate final Pass() error = %v", err)
	}
	if duplicate.Event.Sequence != resolved.Event.Sequence {
		t.Fatalf("duplicate resolution sequence = %d, want %d", duplicate.Event.Sequence, resolved.Event.Sequence)
	}

	drawn, err := runtime.Apply(context.Background(), "session-passes", "user-south", "south-draw", protocol.MatchCommandRequest{
		MatchID:         "session-passes",
		Type:            rulesengine.CommandDraw,
		ExpectedVersion: southView.StateVersion,
	})
	if err != nil {
		t.Fatalf("South Draw() error = %v", err)
	}
	if drawn.Phase != rulesengine.PhaseAwaitingDiscard {
		t.Fatalf("South draw phase = %s", drawn.Phase)
	}
}

func TestHandlerJoinsActorAndReturnsOnlyProjectedState(t *testing.T) {
	runtime := NewRuntime(rulesengine.NewMemoryEventStore(), func() time.Time {
		return time.Date(2026, 7, 18, 5, 0, 0, 0, time.UTC)
	})
	handler := &Handler{
		Verifier: tokenVerifier{"east-token": "user-east", "south-token": "user-south"},
		Runtime:  runtime,
		Now: func() time.Time {
			return time.Date(2026, 7, 18, 5, 0, 0, 0, time.UTC)
		},
	}
	server := httptest.NewServer(handler)
	defer server.Close()

	eastConn := dialRuntime(t, server.URL, "east-token")
	defer eastConn.Close()
	southConn := dialRuntime(t, server.URL, "south-token")
	defer southConn.Close()
	readEnvelope(t, eastConn, "server.ready")
	readEnvelope(t, southConn, "server.ready")

	writeEnvelope(t, eastConn, "match.join", "join-east", protocol.MatchJoinRequest{MatchID: "session-2"})
	eastJoined := readEnvelope(t, eastConn, "match.joined")
	var eastPayload protocol.MatchJoinedPayload
	if err := json.Unmarshal(eastJoined.Payload, &eastPayload); err != nil {
		t.Fatalf("decode east joined: %v", err)
	}
	writeEnvelope(t, southConn, "match.join", "join-south", protocol.MatchJoinRequest{MatchID: "session-2"})
	southJoined := readEnvelope(t, southConn, "match.joined")
	var southPayload protocol.MatchJoinedPayload
	if err := json.Unmarshal(southJoined.Payload, &southPayload); err != nil {
		t.Fatalf("decode south joined: %v", err)
	}
	if eastPayload.Seat != rulesengine.East || southPayload.Seat != rulesengine.South {
		t.Fatalf("joined seats = %s/%s", eastPayload.Seat, southPayload.Seat)
	}

	eastDiscardID := eastPayload.View.OwnHand[0].ID
	eastHiddenID := eastPayload.View.OwnHand[1].ID
	southJSON, _ := json.Marshal(southPayload)
	if strings.Contains(string(southJSON), eastHiddenID) {
		t.Fatalf("South projection leaked East tile %q", eastHiddenID)
	}

	writeEnvelope(t, eastConn, "match.command", "discard-east", protocol.MatchCommandRequest{
		MatchID:         "session-2",
		Type:            rulesengine.CommandDiscard,
		ExpectedVersion: eastPayload.View.StateVersion,
		TileID:          eastDiscardID,
	})
	readEnvelope(t, eastConn, "match.command.accepted")
	eastState := readEnvelope(t, eastConn, "match.state")
	southState := readEnvelope(t, southConn, "match.state")
	if strings.Contains(string(southState.Payload), eastHiddenID) {
		t.Fatalf("broadcast leaked East tile %q to South: %s", eastHiddenID, southState.Payload)
	}
	if eastState.RequestID != "discard-east" || southState.RequestID != "discard-east" {
		t.Fatalf("broadcast request IDs = %q/%q", eastState.RequestID, southState.RequestID)
	}
}

type tokenVerifier map[string]string

func (v tokenVerifier) Verify(_ context.Context, token string) (auth.Principal, error) {
	if userID := v[token]; userID != "" {
		return auth.Principal{UserID: userID}, nil
	}
	return auth.Principal{}, auth.ErrUnauthenticated
}

func dialRuntime(t *testing.T, serverURL, token string) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + serverURL[len("http"):]
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Authorization": []string{"Bearer " + token}})
	if err != nil {
		t.Fatalf("Dial() error = %v", err)
	}
	return conn
}

func writeEnvelope(t *testing.T, conn *websocket.Conn, messageType, requestID string, payload any) {
	t.Helper()
	envelope, err := protocol.NewEnvelope(messageType, requestID, payload)
	if err != nil {
		t.Fatalf("NewEnvelope(%s) error = %v", messageType, err)
	}
	if err := conn.WriteJSON(envelope); err != nil {
		t.Fatalf("WriteJSON(%s) error = %v", messageType, err)
	}
}

func readEnvelope(t *testing.T, conn *websocket.Conn, wantType string) protocol.Envelope {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var envelope protocol.Envelope
	if err := conn.ReadJSON(&envelope); err != nil {
		t.Fatalf("ReadJSON(%s) error = %v", wantType, err)
	}
	if envelope.Type != wantType {
		t.Fatalf("envelope type = %q, want %q; payload = %s", envelope.Type, wantType, envelope.Payload)
	}
	return envelope
}
