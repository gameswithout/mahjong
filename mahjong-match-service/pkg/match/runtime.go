package match

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gameswithout/mahjong/bots"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/session"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/storage"
	"github.com/gameswithout/mahjong/rulesengine"
)

// takeoverSeatOrder fixes the scan order driveLocked uses when more than
// one seat is taken over simultaneously; only ordering, not fairness,
// depends on it (each drive pass re-evaluates from scratch).
var takeoverSeatOrder = []rulesengine.Seat{rulesengine.East, rulesengine.South, rulesengine.West, rulesengine.North}

var (
	ErrNotMember        = errors.New("player is not a member of this match")
	ErrMatchNotLoaded   = errors.New("match has not been joined")
	ErrActionNotAllowed = errors.New("match action is not allowed")
)

type MatchRepository interface {
	GetMatch(context.Context, storage.MatchKey) (storage.MatchRecord, error)
	EnsureMatch(context.Context, storage.MatchKey, []string) (storage.MatchRecord, bool, error)
}

type Runtime struct {
	mu      sync.Mutex
	rosters session.Resolver
	matches MatchRepository
	events  rulesengine.EventStore
	now     func() time.Time
	actors  map[string]*loadedMatch
	locks   map[string]*sync.Mutex
}

type loadedMatch struct {
	record storage.MatchRecord
	actor  *rulesengine.MatchActor
	// pendingRestore marks a seat whose rightful owner has been observed
	// present (an authenticated Join/View/Apply call) while that seat was
	// taken over (§8.7). It is only ever set while the seat is actually
	// taken over at the moment of the call — never preemptively — so a
	// call made before any takeover exists cannot leave a stale flag that
	// would instantly (and wrongly) restore control the next time the seat
	// happens to be taken over in some later, unrelated window. driveLocked
	// consumes (clears) this flag once it actually restores control, at
	// the seat's next legal personal turn rather than immediately.
	pendingRestore map[rulesengine.Seat]bool
}

// markPresentIfTakenOver records that seat's owner was just observed
// (an authenticated call succeeded) while the seat was under takeover —
// the §8.7 reconnect signal driveLocked acts on.
func (r *Runtime) markPresentIfTakenOver(current *loadedMatch, seat rulesengine.Seat) {
	engine := current.actor.Peek()
	if engine == nil || !engine.IsTakenOver(seat) {
		return
	}
	if current.pendingRestore == nil {
		current.pendingRestore = map[rulesengine.Seat]bool{}
	}
	current.pendingRestore[seat] = true
}

type eventHeadStore interface {
	LastSequence(context.Context, string) (uint64, error)
}

func NewRuntime(
	rosters session.Resolver,
	matches MatchRepository,
	events rulesengine.EventStore,
	now func() time.Time,
) *Runtime {
	if now == nil {
		now = time.Now
	}
	return &Runtime{
		rosters: rosters,
		matches: matches,
		events:  events,
		now:     now,
		actors:  make(map[string]*loadedMatch),
		locks:   make(map[string]*sync.Mutex),
	}
}

func (r *Runtime) Join(
	ctx context.Context,
	key storage.MatchKey,
	userID string,
) (rulesengine.SeatView, error) {
	if r == nil || r.rosters == nil || r.matches == nil || r.events == nil {
		return rulesengine.SeatView{}, fmt.Errorf("match runtime is not initialized")
	}
	if err := key.Validate(); err != nil {
		return rulesengine.SeatView{}, err
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return rulesengine.SeatView{}, ErrNotMember
	}

	matchLock := r.matchLock(key.RuntimeID())
	matchLock.Lock()
	defer matchLock.Unlock()
	record, err := r.matches.GetMatch(ctx, key)
	if errors.Is(err, storage.ErrMatchNotFound) {
		roster, rosterErr := r.rosters.Roster(ctx, key.Namespace, key.SessionID)
		if rosterErr != nil {
			return rulesengine.SeatView{}, rosterErr
		}
		if !contains(roster, userID) {
			return rulesengine.SeatView{}, ErrNotMember
		}
		record, _, err = r.matches.EnsureMatch(ctx, key, roster)
	}
	if err != nil {
		return rulesengine.SeatView{}, err
	}
	current, err := r.loadLocked(ctx, record)
	if err != nil {
		return rulesengine.SeatView{}, err
	}
	seat, ok := current.record.Seats[userID]
	if !ok {
		return rulesengine.SeatView{}, ErrNotMember
	}
	if err := r.refreshLocked(ctx, current); err != nil {
		return rulesengine.SeatView{}, err
	}
	r.markPresentIfTakenOver(current, seat)
	if err := r.driveLocked(ctx, current); err != nil {
		return rulesengine.SeatView{}, err
	}
	return current.actor.View(seat)
}

func (r *Runtime) View(
	ctx context.Context,
	key storage.MatchKey,
	userID string,
) (rulesengine.SeatView, error) {
	if r == nil {
		return rulesengine.SeatView{}, ErrMatchNotLoaded
	}
	if err := key.Validate(); err != nil {
		return rulesengine.SeatView{}, err
	}
	matchLock := r.matchLock(key.RuntimeID())
	matchLock.Lock()
	defer matchLock.Unlock()
	current, seat, err := r.loadPersisted(ctx, key, userID)
	if err != nil {
		return rulesengine.SeatView{}, err
	}
	if err := r.refreshLocked(ctx, current); err != nil {
		return rulesengine.SeatView{}, err
	}
	r.markPresentIfTakenOver(current, seat)
	if err := r.driveLocked(ctx, current); err != nil {
		return rulesengine.SeatView{}, err
	}
	return current.actor.View(seat)
}

func (r *Runtime) Apply(
	ctx context.Context,
	key storage.MatchKey,
	userID string,
	command rulesengine.MatchCommand,
) (rulesengine.CommandResult, rulesengine.SeatView, error) {
	if r == nil || strings.TrimSpace(command.RequestID) == "" {
		return rulesengine.CommandResult{}, rulesengine.SeatView{}, ErrActionNotAllowed
	}
	if err := key.Validate(); err != nil {
		return rulesengine.CommandResult{}, rulesengine.SeatView{}, err
	}
	matchLock := r.matchLock(key.RuntimeID())
	matchLock.Lock()
	defer matchLock.Unlock()
	current, seat, err := r.loadPersisted(ctx, key, userID)
	if err != nil {
		return rulesengine.CommandResult{}, rulesengine.SeatView{}, err
	}
	if err := r.refreshLocked(ctx, current); err != nil {
		return rulesengine.CommandResult{}, rulesengine.SeatView{}, err
	}
	r.markPresentIfTakenOver(current, seat)
	if err := r.driveLocked(ctx, current); err != nil {
		return rulesengine.CommandResult{}, rulesengine.SeatView{}, err
	}

	command.MatchID = current.record.RuntimeID
	command.RequestID = "player:" + userID + ":" + command.RequestID
	command.Seat = seat
	if previous, found := current.actor.Previous(command.RequestID); found {
		if command.Type == rulesengine.CommandSubmitClaim {
			previous, err = r.resolveClaimResponse(ctx, current, previous)
			if err != nil {
				return previous, rulesengine.SeatView{}, err
			}
		}
		view, err := current.actor.View(seat)
		return previous, view, err
	}
	view, err := current.actor.View(seat)
	if err != nil {
		return rulesengine.CommandResult{}, rulesengine.SeatView{}, err
	}
	if command.ExpectedVersion != view.StateVersion {
		return rulesengine.CommandResult{}, rulesengine.SeatView{}, rulesengine.ErrStaleAction
	}
	if err := authorizeCommand(view, seat, &command); err != nil {
		return rulesengine.CommandResult{}, rulesengine.SeatView{}, err
	}
	result, err := current.actor.Apply(ctx, command)
	if err != nil {
		if errors.Is(err, rulesengine.ErrEventSequence) {
			restored, restoreErr := rulesengine.RestoreMatchActor(ctx, current.record.RuntimeID, r.events, r.now)
			if restoreErr != nil {
				return result, rulesengine.SeatView{}, fmt.Errorf("restore after concurrent command: %w", restoreErr)
			}
			current.actor = restored
			if previous, found := restored.Previous(command.RequestID); found {
				view, viewErr := restored.View(seat)
				return previous, view, viewErr
			}
			return result, rulesengine.SeatView{}, fmt.Errorf("%w: another replica committed first", rulesengine.ErrStaleAction)
		}
		return result, rulesengine.SeatView{}, err
	}
	if command.Type == rulesengine.CommandSubmitClaim {
		result, err = r.resolveClaimResponse(ctx, current, result)
		if err != nil {
			return result, rulesengine.SeatView{}, err
		}
	}
	nextView, err := current.actor.View(seat)
	return result, nextView, err
}

func (r *Runtime) loadPersisted(
	ctx context.Context,
	key storage.MatchKey,
	userID string,
) (*loadedMatch, rulesengine.Seat, error) {
	if r == nil || r.matches == nil || r.events == nil {
		return nil, "", ErrMatchNotLoaded
	}
	if err := key.Validate(); err != nil {
		return nil, "", err
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, "", ErrNotMember
	}

	current := r.actor(key.RuntimeID())
	if current == nil {
		record, err := r.matches.GetMatch(ctx, key)
		if errors.Is(err, storage.ErrMatchNotFound) {
			return nil, "", ErrMatchNotLoaded
		}
		if err != nil {
			return nil, "", err
		}
		current, err = r.loadLocked(ctx, record)
		if err != nil {
			return nil, "", err
		}
	}
	seat, ok := current.record.Seats[userID]
	if !ok {
		return nil, "", ErrNotMember
	}
	return current, seat, nil
}

func (r *Runtime) resolveClaimResponse(
	ctx context.Context,
	current *loadedMatch,
	result rulesengine.CommandResult,
) (rulesengine.CommandResult, error) {
	resolved, err := resolveClaimsWhenReady(ctx, current.actor, result, r.now())
	if !errors.Is(err, rulesengine.ErrEventSequence) {
		return resolved, err
	}
	restored, restoreErr := rulesengine.RestoreMatchActor(ctx, current.record.RuntimeID, r.events, r.now)
	if restoreErr != nil {
		return resolved, fmt.Errorf("restore after concurrent claim resolution: %w", restoreErr)
	}
	current.actor = restored
	resolved, err = resolveClaimsWhenReady(ctx, restored, result, r.now())
	return resolved, err
}

// driveLocked lazily advances current toward its next human-actionable
// state (§5.10/§8.7/§11.1): committing an overdue turn's canonical
// auto-discard, resolving an overdue (or fully-answered) claim window, and
// playing any taken-over seat's move. It runs after every refreshLocked, so
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
// Rob windows and §5.9 offers are intentionally left alone: neither
// runtime's command surface accepts a player response to either yet (a
// pre-existing gap, not introduced here), so there is nothing for this
// driver to layer bot behavior on top of.
func (r *Runtime) driveLocked(ctx context.Context, current *loadedMatch) error {
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
					MatchID:   current.record.RuntimeID,
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
					MatchID:         current.record.RuntimeID,
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
				_, err := current.actor.Apply(ctx, rulesengine.MatchCommand{
					MatchID:   current.record.RuntimeID,
					RequestID: "system:restore-control:" + string(seat) + ":" + strconv.FormatUint(version, 10),
					Type:      rulesengine.CommandRestoreControl,
					Seat:      seat,
				})
				if err != nil {
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
			command.MatchID = current.record.RuntimeID
			command.RequestID = "system:takeover:" + string(seat) + ":" + strconv.FormatUint(version, 10)
			result, applyErr := current.actor.Apply(ctx, *command)
			if applyErr != nil && !errors.Is(applyErr, rulesengine.ErrHandComplete) {
				return applyErr
			}
			if command.Type == rulesengine.CommandSubmitClaim {
				if _, err := r.resolveClaimResponse(ctx, current, result); err != nil {
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

func (r *Runtime) matchLock(runtimeID string) *sync.Mutex {
	r.mu.Lock()
	defer r.mu.Unlock()
	lock := r.locks[runtimeID]
	if lock == nil {
		lock = &sync.Mutex{}
		r.locks[runtimeID] = lock
	}
	return lock
}

func (r *Runtime) actor(runtimeID string) *loadedMatch {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.actors[runtimeID]
}

func (r *Runtime) refreshLocked(ctx context.Context, current *loadedMatch) error {
	var (
		head uint64
		err  error
	)
	if store, ok := r.events.(eventHeadStore); ok {
		head, err = store.LastSequence(ctx, current.record.RuntimeID)
	} else {
		var events []rulesengine.MatchEvent
		events, err = r.events.Events(ctx, current.record.RuntimeID)
		if len(events) > 0 {
			head = events[len(events)-1].Sequence
		}
	}
	if err != nil {
		return fmt.Errorf("read match event head: %w", err)
	}
	if head <= current.actor.Sequence() {
		return nil
	}
	current.actor, err = rulesengine.RestoreMatchActor(ctx, current.record.RuntimeID, r.events, r.now)
	if err != nil {
		return fmt.Errorf("refresh match actor: %w", err)
	}
	return nil
}

func (r *Runtime) loadLocked(ctx context.Context, record storage.MatchRecord) (*loadedMatch, error) {
	if current := r.actor(record.RuntimeID); current != nil {
		return current, nil
	}
	events, err := r.events.Events(ctx, record.RuntimeID)
	if err != nil {
		return nil, err
	}
	var actor *rulesengine.MatchActor
	if len(events) > 0 {
		actor, err = rulesengine.RestoreMatchActor(ctx, record.RuntimeID, r.events, r.now)
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
					actor, err = rulesengine.NewMatchActor(ctx, record.RuntimeID, engine, r.events, r.now)
					if errors.Is(err, rulesengine.ErrEventSequence) {
						actor, err = rulesengine.RestoreMatchActor(ctx, record.RuntimeID, r.events, r.now)
					}
				}
			}
		}
	}
	if err != nil {
		return nil, fmt.Errorf("initialize match actor: %w", err)
	}
	if _, found := actor.Previous("server:initial-replacement"); !found {
		if _, err := actor.Apply(ctx, rulesengine.MatchCommand{
			MatchID:   record.RuntimeID,
			RequestID: "server:initial-replacement",
			Type:      rulesengine.CommandBeginInitialReplacement,
		}); err != nil && !errors.Is(err, rulesengine.ErrHandComplete) {
			if errors.Is(err, rulesengine.ErrEventSequence) {
				actor, err = rulesengine.RestoreMatchActor(ctx, record.RuntimeID, r.events, r.now)
			}
			if err != nil {
				return nil, fmt.Errorf("initialize match replacement: %w", err)
			}
		}
	}
	current := &loadedMatch{record: record, actor: actor, pendingRestore: map[rulesengine.Seat]bool{}}
	r.mu.Lock()
	r.actors[record.RuntimeID] = current
	r.mu.Unlock()
	return current, nil
}

func authorizeCommand(view rulesengine.SeatView, seat rulesengine.Seat, command *rulesengine.MatchCommand) error {
	switch command.Type {
	case rulesengine.CommandDraw:
		if view.ActiveSeat != seat || view.Phase != rulesengine.PhaseAwaitingDraw {
			return ErrActionNotAllowed
		}
	case rulesengine.CommandDiscard:
		if view.ActiveSeat != seat || view.Phase != rulesengine.PhaseAwaitingDiscard {
			return ErrActionNotAllowed
		}
	case rulesengine.CommandSubmitClaim:
		if command.Claim == nil || view.Phase != rulesengine.PhaseClaimWindow || view.Claim == nil ||
			command.Claim.ActionID != view.Claim.ActionID || !seatIn(view.Claim.Eligible, seat) {
			return ErrActionNotAllowed
		}
		claim := *command.Claim
		claim.Seat = seat
		claim.ActionID = view.Claim.ActionID
		claim.StateVersion = view.StateVersion
		claim.TileIDs = append([]string(nil), claim.TileIDs...)
		command.Claim = &claim
	default:
		return ErrActionNotAllowed
	}
	return nil
}

func resolveClaimsWhenReady(
	ctx context.Context,
	actor *rulesengine.MatchActor,
	result rulesengine.CommandResult,
	now time.Time,
) (rulesengine.CommandResult, error) {
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

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func seatIn(values []rulesengine.Seat, target rulesengine.Seat) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
