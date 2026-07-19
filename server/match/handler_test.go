package match

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

	// A modest clock advance (well short of the claim window's own §5.10
	// deadline) proves recovery replays state from the events' own recorded
	// timestamps rather than depending on wall-clock proximity, without
	// also triggering driveLocked's now-real deadline-expiry behavior —
	// that is covered separately.
	recoveredRuntime := NewRuntime(store, func() time.Time { return clock().Add(time.Second) })
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

func TestRuntimeDriveLockedAutoDiscardsExpiredTurn(t *testing.T) {
	clock := time.Date(2026, 7, 19, 8, 0, 0, 0, time.UTC)
	runtime := NewRuntime(rulesengine.NewMemoryEventStore(), func() time.Time { return clock })

	_, view, err := runtime.Join(context.Background(), "session-expiry", "user-east")
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
	advanced, err := runtime.View("session-expiry", "user-east")
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

// TestRuntimeDriveLockedPlaysTakenOverSeatAutomatically mirrors the
// mahjong-match-service runtime's equivalent test: East, then South, then
// West each discard for real with every other non-North seat explicitly
// passing, leaving North as the only seat that never responds. Rotation
// order E-S-W-N means North is never the discarder in this sequence and is
// eligible on all three claim windows, so three consecutive unanswered
// windows land North exactly as it becomes North's own turn — taken over,
// per §8.7/§11.1 — with nobody ever submitting a command on North's behalf.
func TestRuntimeDriveLockedPlaysTakenOverSeatAutomatically(t *testing.T) {
	clock := time.Date(2026, 7, 19, 8, 0, 0, 0, time.UTC)
	runtime := NewRuntime(rulesengine.NewMemoryEventStore(), func() time.Time { return clock })
	ctx := context.Background()
	const matchID = "session-takeover"

	var view rulesengine.SeatView
	for _, user := range []string{"user-east", "user-south", "user-west", "user-north"} {
		_, joined, err := runtime.Join(ctx, matchID, user)
		if err != nil {
			t.Fatalf("%s Join() error = %v", user, err)
		}
		if user == "user-east" {
			view = joined
		}
	}

	discarders := []struct {
		user   string
		seat   rulesengine.Seat
		others []string
	}{
		{"user-east", rulesengine.East, []string{"user-south", "user-west"}},
		{"user-south", rulesengine.South, []string{"user-east", "user-west"}},
		{"user-west", rulesengine.West, []string{"user-east", "user-south"}},
	}
	seq := 0
	for _, step := range discarders {
		seq++
		if view.ActiveSeat != step.seat {
			t.Fatalf("expected %s active, got %s", step.seat, view.ActiveSeat)
		}
		tileID := view.OwnHand[0].ID
		if view.Phase == rulesengine.PhaseAwaitingDraw {
			result, err := runtime.Apply(ctx, matchID, step.user, fmt.Sprintf("draw-%d", seq), protocol.MatchCommandRequest{
				MatchID:         matchID,
				Type:            rulesengine.CommandDraw,
				ExpectedVersion: view.StateVersion,
			})
			if err != nil {
				t.Fatalf("Draw(%s) error = %v", step.user, err)
			}
			tileID = result.Draw.Tile.ID
			if view, err = runtime.View(matchID, step.user); err != nil {
				t.Fatalf("View(%s) after draw error = %v", step.user, err)
			}
		}
		if _, err := runtime.Apply(ctx, matchID, step.user, fmt.Sprintf("discard-%d", seq), protocol.MatchCommandRequest{
			MatchID:         matchID,
			Type:            rulesengine.CommandDiscard,
			ExpectedVersion: view.StateVersion,
			TileID:          tileID,
		}); err != nil {
			t.Fatalf("Discard(%s) error = %v", step.user, err)
		}
		for _, other := range step.others {
			otherView, err := runtime.View(matchID, other)
			if err != nil {
				t.Fatalf("View(%s) error = %v", other, err)
			}
			if otherView.Claim == nil {
				t.Fatalf("expected a claim window for %s after %s's discard", other, step.user)
			}
			if _, err := runtime.Apply(ctx, matchID, other, fmt.Sprintf("pass-%d-%s", seq, other), protocol.MatchCommandRequest{
				MatchID:         matchID,
				Type:            rulesengine.CommandSubmitClaim,
				ExpectedVersion: otherView.StateVersion,
				Claim:           &rulesengine.ClaimResponse{Type: rulesengine.ClaimPass},
			}); err != nil {
				t.Fatalf("pass(%s) error = %v", other, err)
			}
		}
		// North deliberately never responds -> one AFK strike per round.
		clock = clock.Add(20 * time.Second)
		var err error
		if view, err = runtime.View(matchID, "user-east"); err != nil {
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

// TestRuntimeRestoresControlAtNextTurnAfterReconnect mirrors the
// mahjong-match-service runtime's equivalent test: drives North into
// takeover (its own bot-driven discard included), has "user-north" call
// View() — the §8.7 reconnect signal — while still taken over, then proves
// North's very next decision point (its claim eligibility on East's
// following real discard) is left for a real command instead of being
// auto-driven.
func TestRuntimeRestoresControlAtNextTurnAfterReconnect(t *testing.T) {
	clock := time.Date(2026, 7, 19, 8, 0, 0, 0, time.UTC)
	runtime := NewRuntime(rulesengine.NewMemoryEventStore(), func() time.Time { return clock })
	ctx := context.Background()
	const matchID = "session-reconnect"

	var view rulesengine.SeatView
	for _, user := range []string{"user-east", "user-south", "user-west", "user-north"} {
		_, joined, err := runtime.Join(ctx, matchID, user)
		if err != nil {
			t.Fatalf("%s Join() error = %v", user, err)
		}
		if user == "user-east" {
			view = joined
		}
	}

	discarders := []struct {
		user   string
		seat   rulesengine.Seat
		others []string
	}{
		{"user-east", rulesengine.East, []string{"user-south", "user-west"}},
		{"user-south", rulesengine.South, []string{"user-east", "user-west"}},
		{"user-west", rulesengine.West, []string{"user-east", "user-south"}},
	}
	seq := 0
	for _, step := range discarders {
		seq++
		if view.ActiveSeat != step.seat {
			t.Fatalf("expected %s active, got %s", step.seat, view.ActiveSeat)
		}
		tileID := view.OwnHand[0].ID
		if view.Phase == rulesengine.PhaseAwaitingDraw {
			result, err := runtime.Apply(ctx, matchID, step.user, fmt.Sprintf("draw-%d", seq), protocol.MatchCommandRequest{
				MatchID:         matchID,
				Type:            rulesengine.CommandDraw,
				ExpectedVersion: view.StateVersion,
			})
			if err != nil {
				t.Fatalf("Draw(%s) error = %v", step.user, err)
			}
			tileID = result.Draw.Tile.ID
			if view, err = runtime.View(matchID, step.user); err != nil {
				t.Fatalf("View(%s) after draw error = %v", step.user, err)
			}
		}
		if _, err := runtime.Apply(ctx, matchID, step.user, fmt.Sprintf("discard-%d", seq), protocol.MatchCommandRequest{
			MatchID:         matchID,
			Type:            rulesengine.CommandDiscard,
			ExpectedVersion: view.StateVersion,
			TileID:          tileID,
		}); err != nil {
			t.Fatalf("Discard(%s) error = %v", step.user, err)
		}
		for _, other := range step.others {
			otherView, err := runtime.View(matchID, other)
			if err != nil {
				t.Fatalf("View(%s) error = %v", other, err)
			}
			if otherView.Claim == nil {
				t.Fatalf("expected a claim window for %s after %s's discard", other, step.user)
			}
			if _, err := runtime.Apply(ctx, matchID, other, fmt.Sprintf("pass-%d-%s", seq, other), protocol.MatchCommandRequest{
				MatchID:         matchID,
				Type:            rulesengine.CommandSubmitClaim,
				ExpectedVersion: otherView.StateVersion,
				Claim:           &rulesengine.ClaimResponse{Type: rulesengine.ClaimPass},
			}); err != nil {
				t.Fatalf("pass(%s) error = %v", other, err)
			}
		}
		clock = clock.Add(20 * time.Second)
		var err error
		if view, err = runtime.View(matchID, "user-east"); err != nil {
			t.Fatalf("View() after claim deadline error = %v", err)
		}
	}
	if view.Phase != rulesengine.PhaseClaimWindow || view.LastDiscard == nil || view.LastDiscard.Seat != rulesengine.North {
		t.Fatalf("phase = %s, lastDiscard = %#v, want North's bot-driven discard", view.Phase, view.LastDiscard)
	}

	// "user-north" reconnects now, mid-cascade, while still taken over.
	if _, err := runtime.View(matchID, "user-north"); err != nil {
		t.Fatalf("north View() (reconnect signal) error = %v", err)
	}

	// East/South/West pass on North's discard; nobody claims, so the next
	// active seat is East.
	for _, other := range []string{"user-east", "user-south", "user-west"} {
		otherView, err := runtime.View(matchID, other)
		if err != nil {
			t.Fatalf("View(%s) error = %v", other, err)
		}
		if _, err := runtime.Apply(ctx, matchID, other, "post-reconnect-pass-"+other, protocol.MatchCommandRequest{
			MatchID:         matchID,
			Type:            rulesengine.CommandSubmitClaim,
			ExpectedVersion: otherView.StateVersion,
			Claim:           &rulesengine.ClaimResponse{Type: rulesengine.ClaimPass},
		}); err != nil {
			t.Fatalf("pass(%s) error = %v", other, err)
		}
	}
	eastView, err := runtime.View(matchID, "user-east")
	if err != nil {
		t.Fatalf("View(east) error = %v", err)
	}
	if eastView.ActiveSeat != rulesengine.East || eastView.Phase != rulesengine.PhaseAwaitingDraw {
		t.Fatalf("phase = %s, active = %s, want East awaiting draw", eastView.Phase, eastView.ActiveSeat)
	}
	drawResult, err := runtime.Apply(ctx, matchID, "user-east", "east-draw-2", protocol.MatchCommandRequest{
		MatchID:         matchID,
		Type:            rulesengine.CommandDraw,
		ExpectedVersion: eastView.StateVersion,
	})
	if err != nil {
		t.Fatalf("East Draw() error = %v", err)
	}
	discardResult, err := runtime.Apply(ctx, matchID, "user-east", "east-discard-2", protocol.MatchCommandRequest{
		MatchID:         matchID,
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
		polled, err := runtime.View(matchID, "user-east")
		if err != nil {
			t.Fatalf("View() poll %d error = %v", i, err)
		}
		if polled.Claim == nil {
			t.Fatalf("poll %d: North's claim window resolved without North responding — takeover was not restored", i)
		}
	}

	// A real command from "user-north" must now work normally.
	northView, err := runtime.View(matchID, "user-north")
	if err != nil {
		t.Fatalf("View(north) error = %v", err)
	}
	if northView.Claim == nil {
		t.Fatalf("north view missing claim window: %#v", northView)
	}
	if _, err := runtime.Apply(ctx, matchID, "user-north", "north-pass-restored", protocol.MatchCommandRequest{
		MatchID:         matchID,
		Type:            rulesengine.CommandSubmitClaim,
		ExpectedVersion: northView.StateVersion,
		Claim:           &rulesengine.ClaimResponse{Type: rulesengine.ClaimPass},
	}); err != nil {
		t.Fatalf("North's real command after restoration error = %v", err)
	}
}

// TestHandlerRevokesPreviousConnectionOnSameSeatReconnect covers §8.7's
// cross-device rule: "the previous device's match session is revoked" when
// the same account resumes an active match elsewhere. The same user token
// joins the same match from two separate connections; the first must be
// notified and force-closed once the second successfully subscribes to the
// same seat.
func TestHandlerRevokesPreviousConnectionOnSameSeatReconnect(t *testing.T) {
	runtime := NewRuntime(rulesengine.NewMemoryEventStore(), func() time.Time {
		return time.Date(2026, 7, 19, 10, 0, 0, 0, time.UTC)
	})
	handler := &Handler{
		Verifier: tokenVerifier{"east-token": "user-east"},
		Runtime:  runtime,
		Now: func() time.Time {
			return time.Date(2026, 7, 19, 10, 0, 0, 0, time.UTC)
		},
	}
	server := httptest.NewServer(handler)
	defer server.Close()

	firstConn := dialRuntime(t, server.URL, "east-token")
	defer firstConn.Close()
	readEnvelope(t, firstConn, "server.ready")
	writeEnvelope(t, firstConn, "match.join", "join-1", protocol.MatchJoinRequest{MatchID: "session-revoke"})
	readEnvelope(t, firstConn, "match.joined")

	secondConn := dialRuntime(t, server.URL, "east-token")
	defer secondConn.Close()
	readEnvelope(t, secondConn, "server.ready")
	writeEnvelope(t, secondConn, "match.join", "join-2", protocol.MatchJoinRequest{MatchID: "session-revoke"})
	readEnvelope(t, secondConn, "match.joined")

	revoked := readEnvelope(t, firstConn, "match.session_revoked")
	if len(revoked.Payload) == 0 {
		t.Fatal("expected a non-empty session_revoked payload")
	}
	_ = firstConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := firstConn.ReadMessage(); err == nil {
		t.Fatal("expected the revoked connection to be closed")
	}
}

// TestSeatDisconnectedForTracksRetentionWindow covers the §8.7 seat-
// retention bookkeeping this runtime exposes: a seat has no disconnect
// timer while a live connection is subscribed, gets one the moment its
// last subscriber drops, and loses it again once a new one attaches.
func TestSeatDisconnectedForTracksRetentionWindow(t *testing.T) {
	clock := time.Date(2026, 7, 19, 11, 0, 0, 0, time.UTC)
	runtime := NewRuntime(rulesengine.NewMemoryEventStore(), func() time.Time { return clock })
	ctx := context.Background()
	const matchID = "session-retention"
	if _, _, err := runtime.Join(ctx, matchID, "user-east"); err != nil {
		t.Fatalf("Join() error = %v", err)
	}
	if _, ok := runtime.SeatDisconnectedFor(matchID, rulesengine.East); ok {
		t.Fatal("seat should not be marked disconnected before any subscriber exists")
	}

	unsubscribe := runtime.Subscribe(matchID, "user-east", rulesengine.East, func(protocol.Envelope) error { return nil }, nil)
	if _, ok := runtime.SeatDisconnectedFor(matchID, rulesengine.East); ok {
		t.Fatal("seat should not be disconnected while subscribed")
	}

	unsubscribe()
	clock = clock.Add(45 * time.Second)
	elapsed, ok := runtime.SeatDisconnectedFor(matchID, rulesengine.East)
	if !ok || elapsed != 45*time.Second {
		t.Fatalf("SeatDisconnectedFor() = %v, %v; want 45s, true", elapsed, ok)
	}
	if runtime.SeatRetentionWindow() != DefaultSeatRetention {
		t.Fatalf("SeatRetentionWindow() = %v, want %v", runtime.SeatRetentionWindow(), DefaultSeatRetention)
	}

	runtime.Subscribe(matchID, "user-east", rulesengine.East, func(protocol.Envelope) error { return nil }, nil)
	if _, ok := runtime.SeatDisconnectedFor(matchID, rulesengine.East); ok {
		t.Fatal("seat should be cleared as disconnected once resubscribed")
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
// dealer/tier/continuation assumption (matchDealer/matchTier). Mirrors
// mahjong-match-service's equivalent test for its own enrichedView.
func TestEnrichedViewAttachesSettlementAndNextDealerOnlyAtHandEnd(t *testing.T) {
	deal, err := rulesengine.Deal(20260719, [2]uint8{3, 4})
	if err != nil {
		t.Fatalf("Deal() error = %v", err)
	}
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
		if view.NextDealer.DealerRetains || view.NextDealer.NextDealer != rulesengine.South {
			t.Fatalf("seat %s: NextDealer = %#v, want rotation to South", seat, view.NextDealer)
		}
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
