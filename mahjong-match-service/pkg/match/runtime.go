package match

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/session"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/storage"
	"github.com/gameswithout/mahjong/rulesengine"
)

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
	resolved, err := resolveClaimsWhenReady(ctx, current.actor, result)
	if !errors.Is(err, rulesengine.ErrEventSequence) {
		return resolved, err
	}
	restored, restoreErr := rulesengine.RestoreMatchActor(ctx, current.record.RuntimeID, r.events, r.now)
	if restoreErr != nil {
		return resolved, fmt.Errorf("restore after concurrent claim resolution: %w", restoreErr)
	}
	current.actor = restored
	resolved, err = resolveClaimsWhenReady(ctx, restored, result)
	return resolved, err
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
	current := &loadedMatch{record: record, actor: actor}
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
) (rulesengine.CommandResult, error) {
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
