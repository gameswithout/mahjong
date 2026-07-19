package match

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gameswithout/mahjong/bots"
	"github.com/gameswithout/mahjong/rulesengine"
	"github.com/gameswithout/mahjong/server/auth"
	"github.com/gameswithout/mahjong/server/protocol"
	"github.com/gorilla/websocket"
)

// takeoverSeatOrder fixes the scan order driveLocked uses when more than
// one seat is taken over simultaneously; only ordering, not fairness,
// depends on it (each drive pass re-evaluates from scratch).
var takeoverSeatOrder = []rulesengine.Seat{rulesengine.East, rulesengine.South, rulesengine.West, rulesengine.North}

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
			}, func() {
				// §8.7 cross-device revocation: a newer connection for this
				// seat has taken over; best-effort notify this connection
				// before forcing its read loop to unblock and exit.
				revokedEnvelope, _ := protocol.NewEnvelope("match.session_revoked", "", map[string]string{
					"reason": "Another device resumed this seat.",
				})
				_ = h.writeEnvelope(conn, revokedEnvelope)
				_ = conn.Close()
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

// DefaultSeatRetention is the §8.7 Quick Play/private-room seat retention
// window: a disconnected seat is held for the owning player to resume for
// this long. This runtime has no lobby-tier/mode concept yet to select the
// ranked 60s window instead, so a single configurable duration is used;
// context-specific selection is future work once match creation threads a
// tier through (mirrors rulesengine.DeadlineConfig's own per-context
// presets, which this runtime also does not yet select by tier).
const DefaultSeatRetention = 90 * time.Second

// The match runtime does not yet track dealer/prevailing-wind/continuation
// or lobby tier (E2.F6/E2.F7 multi-hand rotation and tier selection are
// unbuilt) — every current match is a single freshly-dealt hand with East
// as dealer at Bamboo Courtyard stakes, matching the same hardcoded
// assumption driveLocked already uses for takeover-bot purposes. Revisit
// once real rotation and tier selection exist.
const matchDealer = rulesengine.East
const matchContinuations = 0

var matchTier = rulesengine.TierBambooCourtyard

// enrichedView calls actor.View(seat) and, once the hand has actually
// ended, attaches the §9.7 items ProjectSeat itself cannot compute
// (Settlement, NextDealer) since those need dealer/continuation/tier
// session state ProjectSeat has no visibility into.
func enrichedView(actor *rulesengine.MatchActor, seat rulesengine.Seat) (rulesengine.SeatView, error) {
	view, err := actor.View(seat)
	if err != nil || view.HandResult == nil {
		return view, err
	}
	settlement, settleErr := rulesengine.SettleHand(rulesengine.SettlementInput{
		Tier:          matchTier,
		Dealer:        matchDealer,
		Continuations: matchContinuations,
		Result:        view.HandResult,
	})
	if settleErr == nil {
		view.Settlement = &settlement
	}
	dealerTing := false
	if view.HandResult.Kind == rulesengine.KindExhaustiveDraw {
		if engine := actor.Peek(); engine != nil {
			for _, player := range engine.Deal.Players {
				if player.Seat != matchDealer {
					continue
				}
				waits, _ := rulesengine.WinningTiles(player.Hand, player.Melds)
				dealerTing = len(waits) > 0
			}
		}
	}
	outcome, outcomeErr := rulesengine.NextDealerState(matchDealer, matchContinuations, view.HandResult, dealerTing)
	if outcomeErr == nil {
		view.NextDealer = &outcome
	}
	return view, nil
}

type Runtime struct {
	mu       sync.Mutex
	store    rulesengine.EventStore
	now      func() time.Time
	matches  map[string]*runtimeMatch
	retained time.Duration
}

type runtimeMatch struct {
	actor       *rulesengine.MatchActor
	seats       map[string]rulesengine.Seat
	subscribers map[*runtimeSubscriber]struct{}
	// pendingRestore marks a seat whose rightful owner has been observed
	// present (a successful Join/View/Apply call) while that seat was
	// taken over (§8.7) — see markPresentIfTakenOver and driveLocked.
	pendingRestore map[rulesengine.Seat]bool
	// disconnectedAt records when a seat's last live subscriber dropped, for
	// the §8.7 seat-retention window. Absent (zero value, checked via the
	// ok-form) while at least one subscriber is connected.
	disconnectedAt map[rulesengine.Seat]time.Time
}

type runtimeSubscriber struct {
	userID string
	seat   rulesengine.Seat
	send   func(protocol.Envelope) error
	// kick forcibly closes this subscriber's underlying connection — used
	// for §8.7 cross-device revocation: "the previous device's match
	// session is revoked" when a linked account resumes from elsewhere.
	// nil is safe to call-guard against (Subscribe always supplies one).
	kick func()
}

func NewRuntime(store rulesengine.EventStore, now func() time.Time) *Runtime {
	if store == nil {
		store = rulesengine.NewMemoryEventStore()
	}
	if now == nil {
		now = time.Now
	}
	return &Runtime{store: store, now: now, matches: map[string]*runtimeMatch{}, retained: DefaultSeatRetention}
}

// markPresentIfTakenOver records that seat's owner was just observed (a
// successful call) while the seat was under takeover — the §8.7 reconnect
// signal driveLocked acts on. It never sets the flag preemptively (only
// while genuinely taken over), so a call made before any takeover exists
// cannot leave a stale flag that would instantly restore control the next
// time the seat happens to be taken over in some later, unrelated window.
func markPresentIfTakenOver(current *runtimeMatch, seat rulesengine.Seat) {
	if current == nil || current.actor == nil {
		return
	}
	engine := current.actor.Peek()
	if engine == nil || !engine.IsTakenOver(seat) {
		return
	}
	if current.pendingRestore == nil {
		current.pendingRestore = map[rulesengine.Seat]bool{}
	}
	current.pendingRestore[seat] = true
}

// SeatRetentionWindow is the §8.7 duration a disconnected seat is held for
// before it is eligible to be considered abandoned (E2.F6/E2.F8's job to
// act on, not this runtime's).
func (r *Runtime) SeatRetentionWindow() time.Duration {
	if r == nil || r.retained <= 0 {
		return DefaultSeatRetention
	}
	return r.retained
}

// SeatDisconnectedFor reports how long matchID's seat has been without a
// live subscriber, and whether it is currently disconnected at all. It is
// exposed for the §8.7 seat-retention window (currently observational —
// this runtime has no multi-hand abandonment/match-ending logic yet to
// act on an expired window; that is E2.F6/E2.F8's job).
func (r *Runtime) SeatDisconnectedFor(matchID string, seat rulesengine.Seat) (time.Duration, bool) {
	if r == nil {
		return 0, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	current := r.matches[matchID]
	if current == nil {
		return 0, false
	}
	since, ok := current.disconnectedAt[seat]
	if !ok {
		return 0, false
	}
	return r.now().Sub(since), true
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
	markPresentIfTakenOver(current, seat)
	if err := r.driveLocked(ctx, current); err != nil {
		return "", rulesengine.SeatView{}, err
	}
	view, err := enrichedView(current.actor, seat)
	return seat, view, err
}

// driveLocked lazily advances current toward its next human-actionable
// state (§5.10/§8.7/§11.1): committing an overdue turn's canonical
// auto-discard, resolving an overdue (or fully-answered) claim window, and
// playing any taken-over seat's move. It is called from Join/View/Apply, so
// it fires speculatively on each client request; a premature attempt is
// rejected harmlessly by the engine's own deadline check, so calling it
// whether or not anything has actually expired is safe.
//
// This is lazy, request-triggered expiry, not a background ticker — a match
// nobody calls Join/View/Apply against again will not self-advance past a
// deadline on its own. In practice this is bounded by the other seats at
// the table continuing to interact with the match while waiting on an AFK
// player; a dedicated reaper is out of scope here.
//
// Rob windows and §5.9 offers are intentionally left alone: this runtime's
// command surface does not accept a player response to either yet (a
// pre-existing gap, not introduced here), so there is nothing for this
// driver to layer bot behavior on top of.
func (r *Runtime) driveLocked(ctx context.Context, current *runtimeMatch) error {
	const dealer, prevailingWind = rulesengine.East, rulesengine.East
	const maxSteps = 16
	for step := 0; step < maxSteps; step++ {
		engine := current.actor.Peek()
		if engine == nil {
			return nil
		}
		version := engine.Version
		now := r.now()

		if engine.TurnDeadline != nil && !now.Before(*engine.TurnDeadline) {
			switch engine.Phase {
			case rulesengine.PhaseAwaitingDraw, rulesengine.PhaseAwaitingDiscard, rulesengine.PhaseOfferPending:
				_, err := current.actor.Apply(ctx, rulesengine.MatchCommand{
					RequestID: "system:auto-discard:" + strconv.FormatUint(version, 10),
					Type:      rulesengine.CommandAutoDiscardExpiredTurn,
				})
				if err == nil {
					continue
				}
				if !errors.Is(err, rulesengine.ErrTurnNotExpired) {
					return err
				}
			}
		}

		if engine.Phase == rulesengine.PhaseClaimWindow && engine.Claim != nil {
			claim := engine.Claim
			fullyAnswered := len(claim.Responses) == len(claim.Eligible)
			if fullyAnswered || now.After(claim.Deadline) {
				// Same request ID scheme as resolveClaimsWhenReady, so this
				// stays idempotent whether resolution is triggered from
				// here or from a player's own claim response completing
				// the window.
				_, err := current.actor.Apply(ctx, rulesengine.MatchCommand{
					RequestID:       "server:resolve-claims:" + claim.ActionID,
					Type:            rulesengine.CommandResolveClaims,
					ExpectedVersion: claim.StateVersion,
				})
				if err != nil {
					return err
				}
				continue
			}
		}

		acted := false
		for _, seat := range takeoverSeatOrder {
			if !engine.IsTakenOver(seat) {
				continue
			}
			if current.pendingRestore[seat] {
				// §8.7: the seat's rightful owner has been observed present
				// (Join/View/Apply succeeded while taken over) and this is
				// their next legal personal turn/claim opportunity — hand
				// control back now instead of driving another bot move.
				delete(current.pendingRestore, seat)
				if _, err := current.actor.Apply(ctx, rulesengine.MatchCommand{
					RequestID: "system:restore-control:" + string(seat) + ":" + strconv.FormatUint(version, 10),
					Type:      rulesengine.CommandRestoreControl,
					Seat:      seat,
				}); err != nil {
					return err
				}
				acted = true
				break
			}
			command, err := bots.DecideTakeoverCommand(engine, seat, dealer, prevailingWind, 0, version)
			if err != nil {
				return fmt.Errorf("drive takeover seat %s: %w", seat, err)
			}
			if command == nil {
				continue
			}
			command.RequestID = "system:takeover:" + string(seat) + ":" + strconv.FormatUint(version, 10)
			result, applyErr := current.actor.Apply(ctx, *command)
			if applyErr != nil && !errors.Is(applyErr, rulesengine.ErrHandComplete) {
				return applyErr
			}
			if command.Type == rulesengine.CommandSubmitClaim {
				if _, err := resolveClaimsWhenReady(ctx, current.actor, result, now); err != nil {
					return err
				}
			}
			acted = true
			break
		}
		if !acted {
			return nil
		}
	}
	return nil
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
		actor:          actor,
		seats:          map[string]rulesengine.Seat{},
		subscribers:    map[*runtimeSubscriber]struct{}{},
		pendingRestore: map[rulesengine.Seat]bool{},
		disconnectedAt: map[rulesengine.Seat]time.Time{},
	}
	r.matches[matchID] = current
	return current, nil
}

func (r *Runtime) View(matchID, userID string) (rulesengine.SeatView, error) {
	if r == nil {
		return rulesengine.SeatView{}, ErrMatchMember
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	current := r.matches[matchID]
	if current == nil {
		return rulesengine.SeatView{}, ErrMatchMember
	}
	seat, ok := current.seats[userID]
	if !ok {
		return rulesengine.SeatView{}, ErrMatchMember
	}
	markPresentIfTakenOver(current, seat)
	if err := r.driveLocked(context.Background(), current); err != nil {
		return rulesengine.SeatView{}, err
	}
	return enrichedView(current.actor, seat)
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
	if !ok {
		r.mu.Unlock()
		return rulesengine.CommandResult{}, ErrMatchMember
	}
	markPresentIfTakenOver(current, seat)
	driveErr := r.driveLocked(ctx, current)
	r.mu.Unlock()
	if driveErr != nil {
		return rulesengine.CommandResult{}, driveErr
	}
	actor := current.actor

	actorRequestID := "player:" + userID + ":" + requestID
	if previous, found := actor.Previous(actorRequestID); found {
		if request.Type == rulesengine.CommandSubmitClaim {
			return resolveClaimsWhenReady(ctx, actor, previous, r.now())
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
	return resolveClaimsWhenReady(ctx, actor, result, r.now())
}

// Claim resolution is a server-owned transition. Clients submit only their
// private response; once every eligible seat has responded — or the claim
// deadline has passed, §5.10/§8.7 — the runtime deterministically resolves
// the window under an idempotent server request ID.
func resolveClaimsWhenReady(ctx context.Context, actor *rulesengine.MatchActor, result rulesengine.CommandResult, now time.Time) (rulesengine.CommandResult, error) {
	claim := result.Snapshot.Claim
	if claim == nil || (len(claim.Responses) != len(claim.Eligible) && !now.After(claim.Deadline)) {
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

// Subscribe registers a live connection for userID's seat, revoking any
// other connection already subscribed to that same seat (§8.7: "the
// previous device's match session is revoked" when a linked account
// resumes elsewhere — this runtime does not yet distinguish guest from
// linked accounts, so revocation applies uniformly, which is harmless
// today since only guest, single-device accounts exist, per E4.F2's
// current scope). kick is called for the caller's own connection later if
// a subsequent Subscribe for the same seat revokes it in turn; it may be
// nil if the caller has no way to force-close its own connection.
func (r *Runtime) Subscribe(matchID, userID string, seat rulesengine.Seat, send func(protocol.Envelope) error, kick func()) func() {
	if r == nil || send == nil {
		return func() {}
	}
	subscriber := &runtimeSubscriber{userID: userID, seat: seat, send: send, kick: kick}
	var revoked []func()
	r.mu.Lock()
	current := r.matches[matchID]
	if current != nil && current.seats[userID] == seat {
		for existing := range current.subscribers {
			if existing.seat != seat {
				continue
			}
			delete(current.subscribers, existing)
			if existing.kick != nil {
				revoked = append(revoked, existing.kick)
			}
		}
		current.subscribers[subscriber] = struct{}{}
		delete(current.disconnectedAt, seat)
	}
	r.mu.Unlock()
	// Called outside the lock: kick may block on network I/O (closing a
	// websocket), which must never happen while r.mu is held.
	for _, revoke := range revoked {
		revoke()
	}
	return func() {
		r.mu.Lock()
		if current := r.matches[matchID]; current != nil {
			delete(current.subscribers, subscriber)
			if !hasSubscriberForSeat(current.subscribers, seat) {
				current.disconnectedAt[seat] = r.now()
			}
		}
		r.mu.Unlock()
	}
}

func hasSubscriberForSeat(subscribers map[*runtimeSubscriber]struct{}, seat rulesengine.Seat) bool {
	for subscriber := range subscribers {
		if subscriber.seat == seat {
			return true
		}
	}
	return false
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
		view, err := enrichedView(actor, subscriber.seat)
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
