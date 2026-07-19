package match

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gameswithout/mahjong/rulesengine"
	"github.com/gameswithout/mahjong/server/auth"
	"github.com/gameswithout/mahjong/server/protocol"
	"github.com/gorilla/websocket"
)

const (
	readLimit       = 1 << 20
	connectionLimit = 10 * time.Minute
)

type Handler struct {
	Verifier  auth.Verifier
	Runtime   *Runtime
	Now       func() time.Time
	Upgrader  websocket.Upgrader
	WriteLock sync.Mutex
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Verifier == nil {
		http.Error(w, "authentication is not configured", http.StatusInternalServerError)
		return
	}

	accessToken := accessTokenFromRequest(r)
	if accessToken == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	principal, err := h.Verifier.Verify(r.Context(), accessToken)
	if err != nil {
		if errors.Is(err, auth.ErrUnauthenticated) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		http.Error(w, "authentication unavailable", http.StatusBadGateway)
		return
	}

	upgrader := h.Upgrader
	if upgrader.CheckOrigin == nil {
		upgrader.CheckOrigin = localOrigin
	}
	if len(upgrader.Subprotocols) == 0 {
		// Select only the fixed safe protocol. The separate ags.token.<token>
		// offer carries the credential into the request but is never echoed in
		// the upgrade response or exposed as the selected socket protocol.
		upgrader.Subprotocols = []string{"ags.bearer"}
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	conn.SetReadLimit(readLimit)
	_ = conn.SetReadDeadline(time.Now().Add(connectionLimit))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(connectionLimit))
	})

	if err := h.writeEnvelope(conn, readyEnvelope(h.Now, principal.UserID)); err != nil {
		return
	}

	var joinedMatchID string
	var joinedSeat rulesengine.Seat
	var unsubscribe func()
	defer func() {
		if unsubscribe != nil {
			unsubscribe()
		}
	}()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}

		var incoming protocol.Envelope
		if err := json.Unmarshal(raw, &incoming); err != nil {
			_ = h.writeEnvelope(conn, errorEnvelope("", "protocol.invalid_json", "Message must be valid JSON."))
			continue
		}
		if incoming.Version != protocol.Version {
			_ = h.writeEnvelope(conn, errorEnvelope(incoming.RequestID, "protocol.version_unsupported", "Unsupported protocol version."))
			continue
		}

		switch incoming.Type {
		case "hello":
			if err := h.writeEnvelope(conn, readyEnvelope(h.Now, principal.UserID)); err != nil {
				return
			}
		case "ping":
			if err := h.writeEnvelope(conn, pongEnvelope(h.Now, incoming.RequestID)); err != nil {
				return
			}
		case "match.join":
			if h.Runtime == nil {
				_ = h.writeEnvelope(conn, errorEnvelope(incoming.RequestID, "match.runtime_unavailable", "Match runtime is not configured."))
				continue
			}
			var request protocol.MatchJoinRequest
			if err := json.Unmarshal(incoming.Payload, &request); err != nil || strings.TrimSpace(request.MatchID) == "" {
				_ = h.writeEnvelope(conn, errorEnvelope(incoming.RequestID, "match.invalid_join", "A valid match ID is required."))
				continue
			}
			seat, view, err := h.Runtime.Join(r.Context(), request.MatchID, principal.UserID)
			if err != nil {
				_ = h.writeEnvelope(conn, runtimeErrorEnvelope(incoming.RequestID, err))
				continue
			}
			if unsubscribe != nil {
				unsubscribe()
			}
			joinedMatchID = request.MatchID
			joinedSeat = seat
			unsubscribe = h.Runtime.Subscribe(joinedMatchID, principal.UserID, seat, func(envelope protocol.Envelope) error {
				return h.writeEnvelope(conn, envelope)
			})
			envelope, _ := protocol.NewEnvelope("match.joined", incoming.RequestID, protocol.MatchJoinedPayload{
				MatchID: joinedMatchID,
				Seat:    joinedSeat,
				View:    view,
			})
			if err := h.writeEnvelope(conn, envelope); err != nil {
				return
			}
		case "match.sync":
			if h.Runtime == nil || joinedMatchID == "" {
				_ = h.writeEnvelope(conn, errorEnvelope(incoming.RequestID, "match.not_joined", "Join a match before requesting state."))
				continue
			}
			view, err := h.Runtime.View(joinedMatchID, principal.UserID)
			if err != nil {
				_ = h.writeEnvelope(conn, runtimeErrorEnvelope(incoming.RequestID, err))
				continue
			}
			envelope, _ := protocol.NewEnvelope("match.state", incoming.RequestID, protocol.MatchStatePayload{
				MatchID: joinedMatchID,
				Seat:    joinedSeat,
				View:    view,
			})
			if err := h.writeEnvelope(conn, envelope); err != nil {
				return
			}
		case "match.command":
			if h.Runtime == nil || joinedMatchID == "" {
				_ = h.writeEnvelope(conn, errorEnvelope(incoming.RequestID, "match.not_joined", "Join a match before submitting commands."))
				continue
			}
			var request protocol.MatchCommandRequest
			if err := json.Unmarshal(incoming.Payload, &request); err != nil {
				_ = h.writeEnvelope(conn, errorEnvelope(incoming.RequestID, "match.invalid_command", "Match command payload is invalid."))
				continue
			}
			if request.MatchID != joinedMatchID {
				_ = h.writeEnvelope(conn, errorEnvelope(incoming.RequestID, "match.match_mismatch", "Command does not belong to the joined match."))
				continue
			}
			result, err := h.Runtime.Apply(r.Context(), joinedMatchID, principal.UserID, incoming.RequestID, request)
			if err != nil && !errors.Is(err, rulesengine.ErrHandComplete) {
				_ = h.writeEnvelope(conn, runtimeErrorEnvelope(incoming.RequestID, err))
				continue
			}
			envelope, _ := protocol.NewEnvelope("match.command.accepted", incoming.RequestID, protocol.MatchCommandAcceptedPayload{
				MatchID:      joinedMatchID,
				Seat:         joinedSeat,
				StateVersion: result.Version,
				Phase:        result.Phase,
			})
			if err := h.writeEnvelope(conn, envelope); err != nil {
				return
			}
			h.Runtime.Broadcast(joinedMatchID, incoming.RequestID)
		default:
			if err := h.writeEnvelope(conn, errorEnvelope(incoming.RequestID, "protocol.unknown_message", "Unknown client message type.")); err != nil {
				return
			}
		}
	}
}

func (h *Handler) writeEnvelope(conn *websocket.Conn, envelope protocol.Envelope) error {
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return err
	}

	h.WriteLock.Lock()
	defer h.WriteLock.Unlock()
	return conn.WriteMessage(websocket.TextMessage, encoded)
}

func accessTokenFromRequest(r *http.Request) string {
	if authorization := r.Header.Get("Authorization"); strings.HasPrefix(authorization, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer "))
	}

	// Browsers cannot set Authorization on a WebSocket handshake. The
	// Browsers offer a fixed selectable `ags.bearer` protocol and a separate
	// `ags.token.<token>` credential entry. Only the fixed protocol is selected,
	// so the token is never echoed or logged by this service. The legacy
	// `ags.bearer.<token>` form remains accepted for older local clients.
	for _, value := range strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",") {
		value = strings.TrimSpace(value)
		if strings.HasPrefix(value, "ags.token.") {
			encoded := strings.TrimPrefix(value, "ags.token.")
			if decoded, err := base64.RawURLEncoding.DecodeString(encoded); err == nil {
				return string(decoded)
			}
		}
		if strings.HasPrefix(value, "ags.bearer.") {
			return strings.TrimPrefix(value, "ags.bearer.")
		}
	}

	return ""
}

func localOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}

	return strings.HasPrefix(origin, "http://127.0.0.1:") ||
		strings.HasPrefix(origin, "http://localhost:")
}

func readyEnvelope(now func() time.Time, userID string) protocol.Envelope {
	if now == nil {
		now = time.Now
	}

	envelope, _ := protocol.Ready(userID, "", now())
	return envelope
}

func pongEnvelope(now func() time.Time, requestID string) protocol.Envelope {
	if now == nil {
		now = time.Now
	}

	envelope, _ := protocol.NewEnvelope("pong", requestID, map[string]string{
		"server_time": now().UTC().Format(time.RFC3339Nano),
	})
	return envelope
}

func errorEnvelope(requestID, code, message string) protocol.Envelope {
	envelope, _ := protocol.Error(requestID, code, message)
	return envelope
}

func runtimeErrorEnvelope(requestID string, err error) protocol.Envelope {
	code := "match.internal"
	message := "Match runtime could not process the request."
	switch {
	case errors.Is(err, ErrMatchID):
		code, message = "match.invalid_id", "A valid match ID is required."
	case errors.Is(err, ErrMatchFull):
		code, message = "match.full", "This local test match already has four seats."
	case errors.Is(err, ErrMatchMember):
		code, message = "match.not_joined", "The authenticated player has not joined this match."
	case errors.Is(err, ErrMatchAction):
		code, message = "match.action_not_allowed", "That action is not legal for this seat right now."
	case errors.Is(err, rulesengine.ErrStaleAction):
		code, message = "match.stale_state", "The match state changed. Refresh and try again."
	case errors.Is(err, rulesengine.ErrClaimDeadline):
		code, message = "match.claim_deadline", "The claim window has closed."
	case errors.Is(err, rulesengine.ErrClaimIllegal):
		code, message = "match.claim_illegal", "That claim is not legal."
	case errors.Is(err, rulesengine.ErrTileNotInHand):
		code, message = "match.tile_not_in_hand", "That tile is not in your hand."
	case errors.Is(err, rulesengine.ErrActionDuplicate):
		code, message = "match.revision_invalid", "The claim response revision is invalid."
	case errors.Is(err, rulesengine.ErrTurnState):
		code, message = "match.turn_state", "That command is not valid in the current phase."
	}
	return errorEnvelope(requestID, code, message)
}

var (
	ErrMatchID     = errors.New("invalid match ID")
	ErrMatchFull   = errors.New("match has no available seat")
	ErrMatchMember = errors.New("player is not a match member")
	ErrMatchAction = errors.New("match action is not allowed")
)

type Runtime struct {
	mu      sync.Mutex
	store   rulesengine.EventStore
	now     func() time.Time
	matches map[string]*runtimeMatch
}

type runtimeMatch struct {
	actor       *rulesengine.MatchActor
	seats       map[string]rulesengine.Seat
	subscribers map[*runtimeSubscriber]struct{}
}

type runtimeSubscriber struct {
	userID string
	seat   rulesengine.Seat
	send   func(protocol.Envelope) error
}

func NewRuntime(store rulesengine.EventStore, now func() time.Time) *Runtime {
	if store == nil {
		store = rulesengine.NewMemoryEventStore()
	}
	if now == nil {
		now = time.Now
	}
	return &Runtime{store: store, now: now, matches: map[string]*runtimeMatch{}}
}

func (r *Runtime) Join(ctx context.Context, matchID, userID string) (rulesengine.Seat, rulesengine.SeatView, error) {
	matchID = strings.TrimSpace(matchID)
	if r == nil || matchID == "" || len(matchID) > 128 {
		return "", rulesengine.SeatView{}, ErrMatchID
	}
	if userID == "" {
		return "", rulesengine.SeatView{}, ErrMatchMember
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	current, err := r.matchLocked(ctx, matchID)
	if err != nil {
		return "", rulesengine.SeatView{}, err
	}
	seat, ok := current.seats[userID]
	if !ok {
		used := map[rulesengine.Seat]bool{}
		for _, assigned := range current.seats {
			used[assigned] = true
		}
		for _, candidate := range []rulesengine.Seat{rulesengine.East, rulesengine.South, rulesengine.West, rulesengine.North} {
			if !used[candidate] {
				seat = candidate
				ok = true
				break
			}
		}
		if !ok {
			return "", rulesengine.SeatView{}, ErrMatchFull
		}
		current.seats[userID] = seat
	}
	view, err := current.actor.View(seat)
	return seat, view, err
}

func (r *Runtime) matchLocked(ctx context.Context, matchID string) (*runtimeMatch, error) {
	if current := r.matches[matchID]; current != nil {
		return current, nil
	}
	events, err := r.store.Events(ctx, matchID)
	if err != nil {
		return nil, err
	}
	var actor *rulesengine.MatchActor
	if len(events) > 0 {
		actor, err = rulesengine.RestoreMatchActor(ctx, matchID, r.store, r.now)
	} else {
		var seed uint64
		seed, err = rulesengine.NewSeed()
		if err == nil {
			dice := [2]uint8{uint8(seed%6) + 1, uint8((seed/6)%6) + 1}
			var deal *rulesengine.DealState
			deal, err = rulesengine.Deal(seed, dice)
			if err == nil {
				var engine *rulesengine.TurnEngine
				engine, err = rulesengine.NewTurnEngine(deal, r.now)
				if err == nil {
					actor, err = rulesengine.NewMatchActor(ctx, matchID, engine, r.store, r.now)
				}
			}
		}
	}
	if err != nil {
		return nil, fmt.Errorf("initialize match actor: %w", err)
	}
	if actor == nil {
		return nil, fmt.Errorf("initialize match actor: %w", rulesengine.ErrTurnState)
	}
	if _, found := actor.Previous("server:initial-replacement"); !found {
		if _, err := actor.Apply(ctx, rulesengine.MatchCommand{
			MatchID:   matchID,
			RequestID: "server:initial-replacement",
			Type:      rulesengine.CommandBeginInitialReplacement,
		}); err != nil && !errors.Is(err, rulesengine.ErrHandComplete) {
			return nil, fmt.Errorf("initialize match replacements: %w", err)
		}
	}
	current := &runtimeMatch{
		actor:       actor,
		seats:       map[string]rulesengine.Seat{},
		subscribers: map[*runtimeSubscriber]struct{}{},
	}
	r.matches[matchID] = current
	return current, nil
}

func (r *Runtime) View(matchID, userID string) (rulesengine.SeatView, error) {
	if r == nil {
		return rulesengine.SeatView{}, ErrMatchMember
	}
	r.mu.Lock()
	current := r.matches[matchID]
	if current == nil {
		r.mu.Unlock()
		return rulesengine.SeatView{}, ErrMatchMember
	}
	seat, ok := current.seats[userID]
	actor := current.actor
	r.mu.Unlock()
	if !ok {
		return rulesengine.SeatView{}, ErrMatchMember
	}
	return actor.View(seat)
}

func (r *Runtime) Apply(ctx context.Context, matchID, userID, requestID string, request protocol.MatchCommandRequest) (rulesengine.CommandResult, error) {
	if r == nil || requestID == "" {
		return rulesengine.CommandResult{}, ErrMatchAction
	}
	r.mu.Lock()
	current := r.matches[matchID]
	if current == nil {
		r.mu.Unlock()
		return rulesengine.CommandResult{}, ErrMatchMember
	}
	seat, ok := current.seats[userID]
	actor := current.actor
	r.mu.Unlock()
	if !ok {
		return rulesengine.CommandResult{}, ErrMatchMember
	}

	actorRequestID := "player:" + userID + ":" + requestID
	if previous, found := actor.Previous(actorRequestID); found {
		if request.Type == rulesengine.CommandSubmitClaim {
			return resolveClaimsWhenReady(ctx, actor, previous)
		}
		return previous, nil
	}
	view, err := actor.View(seat)
	if err != nil {
		return rulesengine.CommandResult{}, err
	}
	command := rulesengine.MatchCommand{
		MatchID:         matchID,
		RequestID:       actorRequestID,
		Type:            request.Type,
		ExpectedVersion: request.ExpectedVersion,
		Seat:            seat,
		TileID:          request.TileID,
	}
	switch request.Type {
	case rulesengine.CommandDraw:
		if view.ActiveSeat != seat || view.Phase != rulesengine.PhaseAwaitingDraw {
			return rulesengine.CommandResult{}, ErrMatchAction
		}
	case rulesengine.CommandDiscard:
		if view.ActiveSeat != seat || view.Phase != rulesengine.PhaseAwaitingDiscard {
			return rulesengine.CommandResult{}, ErrMatchAction
		}
	case rulesengine.CommandSubmitClaim:
		if request.Claim == nil || view.Phase != rulesengine.PhaseClaimWindow || view.Claim == nil ||
			!seatIn(view.Claim.Eligible, seat) {
			return rulesengine.CommandResult{}, ErrMatchAction
		}
		claim := *request.Claim
		claim.Seat = seat
		claim.ActionID = view.Claim.ActionID
		claim.StateVersion = view.StateVersion
		claim.TileIDs = append([]string(nil), claim.TileIDs...)
		command.Claim = &claim
	default:
		return rulesengine.CommandResult{}, ErrMatchAction
	}
	result, err := actor.Apply(ctx, command)
	if err != nil || command.Type != rulesengine.CommandSubmitClaim {
		return result, err
	}
	return resolveClaimsWhenReady(ctx, actor, result)
}

// Claim resolution is a server-owned transition. Clients submit only their
// private response; once every eligible seat has responded, the runtime
// deterministically resolves the window under an idempotent server request ID.
func resolveClaimsWhenReady(ctx context.Context, actor *rulesengine.MatchActor, result rulesengine.CommandResult) (rulesengine.CommandResult, error) {
	claim := result.Snapshot.Claim
	if claim == nil || len(claim.Responses) != len(claim.Eligible) {
		return result, nil
	}
	requestID := "server:resolve-claims:" + claim.ActionID
	if previous, found := actor.Previous(requestID); found {
		return previous, nil
	}
	return actor.Apply(ctx, rulesengine.MatchCommand{
		MatchID:         result.Event.MatchID,
		RequestID:       requestID,
		Type:            rulesengine.CommandResolveClaims,
		ExpectedVersion: claim.StateVersion,
	})
}

func (r *Runtime) Subscribe(matchID, userID string, seat rulesengine.Seat, send func(protocol.Envelope) error) func() {
	if r == nil || send == nil {
		return func() {}
	}
	subscriber := &runtimeSubscriber{userID: userID, seat: seat, send: send}
	r.mu.Lock()
	current := r.matches[matchID]
	if current != nil && current.seats[userID] == seat {
		current.subscribers[subscriber] = struct{}{}
	}
	r.mu.Unlock()
	return func() {
		r.mu.Lock()
		if current := r.matches[matchID]; current != nil {
			delete(current.subscribers, subscriber)
		}
		r.mu.Unlock()
	}
}

func (r *Runtime) Broadcast(matchID, requestID string) {
	if r == nil {
		return
	}
	r.mu.Lock()
	current := r.matches[matchID]
	if current == nil {
		r.mu.Unlock()
		return
	}
	actor := current.actor
	subscribers := make([]*runtimeSubscriber, 0, len(current.subscribers))
	for subscriber := range current.subscribers {
		subscribers = append(subscribers, subscriber)
	}
	r.mu.Unlock()

	for _, subscriber := range subscribers {
		view, err := actor.View(subscriber.seat)
		if err != nil {
			continue
		}
		envelope, err := protocol.NewEnvelope("match.state", requestID, protocol.MatchStatePayload{
			MatchID: matchID,
			Seat:    subscriber.seat,
			View:    view,
		})
		if err == nil {
			_ = subscriber.send(envelope)
		}
	}
}

func seatIn(values []rulesengine.Seat, target rulesengine.Seat) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

type StaticVerifier struct {
	Principal auth.Principal
}

func (v StaticVerifier) Verify(context.Context, string) (auth.Principal, error) {
	if v.Principal.UserID == "" {
		return auth.Principal{}, auth.ErrUnauthenticated
	}
	return v.Principal, nil
}
