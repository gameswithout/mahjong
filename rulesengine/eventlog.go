package rulesengine

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

// EventStore is the append-only boundary used by MatchActor. Implementations
// must make Append durable before returning nil; the actor does not acknowledge
// a command until that call succeeds.
type EventStore interface {
	Append(context.Context, MatchEvent) error
	Events(context.Context, string) ([]MatchEvent, error)
}

var (
	ErrEventStore      = errors.New("event store error")
	ErrEventSequence   = errors.New("event sequence is not next")
	ErrMatchMismatch   = errors.New("event belongs to another match")
	ErrRequestRequired = errors.New("request ID is required")
	ErrMatchRequired   = errors.New("match ID is required")
)

type MatchEvent struct {
	Sequence     uint64          `json:"sequence"`
	MatchID      string          `json:"match_id"`
	Type         string          `json:"type"`
	RequestID    string          `json:"request_id,omitempty"`
	OccurredAt   time.Time       `json:"occurred_at"`
	StateVersion uint64          `json:"state_version"`
	StateHash    string          `json:"state_hash"`
	Command      json.RawMessage `json:"command,omitempty"`
	Result       json.RawMessage `json:"result,omitempty"`
	Snapshot     json.RawMessage `json:"snapshot,omitempty"`
	ErrorCode    string          `json:"error_code,omitempty"`
}

// MemoryEventStore is deterministic and useful for unit tests. Production
// deployments should use a store that fsyncs before Append returns.
type MemoryEventStore struct {
	mu     sync.Mutex
	events map[string][]MatchEvent
}

// FileEventStore is a small append-only JSONL store for local development and
// recovery drills. Each append writes one complete record and calls Sync before
// returning, which gives MatchActor the append-before-ack property. Production
// deployments can replace this adapter with app-owned AGS/Extend storage while
// preserving the EventStore contract.
type FileEventStore struct {
	mu   sync.Mutex
	path string
}

func NewFileEventStore(path string) (*FileEventStore, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("%w: file path is empty", ErrEventStore)
	}
	return &FileEventStore{path: path}, nil
}

func (s *FileEventStore) Append(_ context.Context, event MatchEvent) error {
	if s == nil {
		return fmt.Errorf("%w: nil store", ErrEventStore)
	}
	if event.MatchID == "" {
		return ErrMatchRequired
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	items, err := s.readLocked()
	if err != nil {
		return err
	}
	matchEvents := items[event.MatchID]
	want := uint64(len(matchEvents) + 1)
	if event.Sequence != want {
		return fmt.Errorf("%w: got %d want %d", ErrEventSequence, event.Sequence, want)
	}
	encoded, err := json.Marshal(event)
	if err != nil {
		return err
	}
	file, err := os.OpenFile(s.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := file.Write(append(encoded, '\n')); err != nil {
		return err
	}
	return file.Sync()
}

func (s *FileEventStore) Events(_ context.Context, matchID string) ([]MatchEvent, error) {
	if s == nil {
		return nil, fmt.Errorf("%w: nil store", ErrEventStore)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	items, err := s.readLocked()
	if err != nil {
		return nil, err
	}
	return append([]MatchEvent(nil), items[matchID]...), nil
}

func (s *FileEventStore) readLocked() (map[string][]MatchEvent, error) {
	items := map[string][]MatchEvent{}
	file, err := os.Open(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return items, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var event MatchEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			return nil, fmt.Errorf("%w: invalid event: %v", ErrEventStore, err)
		}
		if event.MatchID == "" {
			return nil, fmt.Errorf("%w: event has no match ID", ErrEventStore)
		}
		matchEvents := items[event.MatchID]
		if event.Sequence != uint64(len(matchEvents)+1) {
			return nil, fmt.Errorf("%w: match %s sequence %d", ErrEventSequence, event.MatchID, event.Sequence)
		}
		items[event.MatchID] = append(matchEvents, event)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func NewMemoryEventStore() *MemoryEventStore {
	return &MemoryEventStore{events: map[string][]MatchEvent{}}
}

func (s *MemoryEventStore) Append(_ context.Context, event MatchEvent) error {
	if s == nil {
		return fmt.Errorf("%w: nil store", ErrEventStore)
	}
	if event.MatchID == "" {
		return ErrMatchRequired
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	items := s.events[event.MatchID]
	want := uint64(len(items) + 1)
	if event.Sequence != want {
		return fmt.Errorf("%w: got %d want %d", ErrEventSequence, event.Sequence, want)
	}
	event.Command = append(json.RawMessage(nil), event.Command...)
	event.Result = append(json.RawMessage(nil), event.Result...)
	event.Snapshot = append(json.RawMessage(nil), event.Snapshot...)
	s.events[event.MatchID] = append(items, event)
	return nil
}

func (s *MemoryEventStore) Events(_ context.Context, matchID string) ([]MatchEvent, error) {
	if s == nil {
		return nil, fmt.Errorf("%w: nil store", ErrEventStore)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	items := append([]MatchEvent(nil), s.events[matchID]...)
	for index := range items {
		items[index].Command = append(json.RawMessage(nil), items[index].Command...)
		items[index].Result = append(json.RawMessage(nil), items[index].Result...)
		items[index].Snapshot = append(json.RawMessage(nil), items[index].Snapshot...)
	}
	return items, nil
}

type CommandType string

const (
	CommandBeginInitialReplacement CommandType = "begin_initial_replacement"
	CommandDraw                    CommandType = "draw"
	CommandDiscard                 CommandType = "discard"
	CommandSubmitClaim             CommandType = "submit_claim"
	CommandResolveClaims           CommandType = "resolve_claims"
	CommandDeclareZimo             CommandType = "declare_zimo"
	CommandDeclareConcealedKong    CommandType = "declare_concealed_kong"
	CommandDeclareAddedKong        CommandType = "declare_added_kong"
	CommandSubmitRob               CommandType = "submit_rob"
	CommandResolveRob              CommandType = "resolve_rob"
	CommandRespondOffer            CommandType = "respond_offer"
	// CommandAutoDiscardExpiredTurn is a server-originated command (§5.10/
	// §8.7): no client submits it directly. A runtime issues it once it
	// believes the active seat's decision deadline has passed; the engine
	// itself re-validates the deadline against the command's own commit
	// time, so a premature or duplicate issue is simply rejected rather
	// than corrupting state.
	CommandAutoDiscardExpiredTurn CommandType = "auto_discard_expired_turn"
)

type MatchCommand struct {
	MatchID         string         `json:"match_id"`
	RequestID       string         `json:"request_id"`
	Type            CommandType    `json:"type"`
	ExpectedVersion uint64         `json:"expected_version,omitempty"`
	Seat            Seat           `json:"seat,omitempty"`
	TileID          string         `json:"tile_id,omitempty"`
	TileIDs         []string       `json:"tile_ids,omitempty"`
	Accept          bool           `json:"accept,omitempty"`
	Claim           *ClaimResponse `json:"claim,omitempty"`
	Rob             *RobResponse   `json:"rob,omitempty"`
}

type CommandResult struct {
	Event       MatchEvent       `json:"event"`
	Phase       TurnPhase        `json:"phase"`
	Version     uint64           `json:"version"`
	StateHash   string           `json:"state_hash"`
	Snapshot    TurnSnapshot     `json:"snapshot"`
	Draw        *DrawResult      `json:"draw,omitempty"`
	ClaimWindow *ClaimWindow     `json:"claim_window,omitempty"`
	Resolution  *ClaimResolution `json:"resolution,omitempty"`
	RobWindow   *RobWindow       `json:"rob_window,omitempty"`
	HandResult  *HandResult      `json:"hand_result,omitempty"`
}

type MatchActor struct {
	mu             sync.Mutex
	matchID        string
	store          EventStore
	engine         *TurnEngine
	clock          func() time.Time
	snapshotEvery  uint64
	lastSnapshotAt time.Time
	sequence       uint64
	results        map[string]CommandResult
}

// Sequence returns the last event sequence incorporated into the actor.
func (a *MatchActor) Sequence() uint64 {
	if a == nil {
		return 0
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.sequence
}

// RestoreMatchActor recovers from the newest embedded snapshot and replays all
// later commands. It verifies every resulting state hash, so a torn/corrupt
// event or a non-deterministic reducer is rejected before the actor is served.
func RestoreMatchActor(ctx context.Context, matchID string, store EventStore, now func() time.Time) (*MatchActor, error) {
	if matchID == "" {
		return nil, ErrMatchRequired
	}
	if store == nil {
		return nil, fmt.Errorf("%w: nil store", ErrEventStore)
	}
	if now == nil {
		now = time.Now
	}
	events, err := store.Events(ctx, matchID)
	if err != nil {
		return nil, err
	}
	if len(events) == 0 || events[0].Type != "match.created" || len(events[0].Snapshot) == 0 {
		return nil, fmt.Errorf("%w: missing match.created snapshot", ErrEventStore)
	}
	start := 0
	for index := range events {
		if len(events[index].Snapshot) > 0 {
			start = index
		}
		if events[index].Sequence != uint64(index+1) || events[index].MatchID != matchID {
			return nil, fmt.Errorf("%w: invalid event chain", ErrEventStore)
		}
	}
	engine, err := engineFromSnapshot(events[start].Snapshot, now)
	if err != nil {
		return nil, err
	}
	actor := &MatchActor{
		matchID:        matchID,
		store:          store,
		engine:         engine,
		clock:          now,
		snapshotEvery:  30,
		lastSnapshotAt: events[start].OccurredAt,
		sequence:       events[len(events)-1].Sequence,
		results:        map[string]CommandResult{},
	}
	for _, event := range events {
		if event.Type == "match.created" || len(event.Command) == 0 {
			continue
		}
		var command MatchCommand
		if err := json.Unmarshal(event.Command, &command); err != nil {
			return nil, fmt.Errorf("%w: command %d: %v", ErrEventStore, event.Sequence, err)
		}
		var logged CommandResult
		if len(event.Result) > 0 {
			if err := json.Unmarshal(event.Result, &logged); err != nil {
				return nil, fmt.Errorf("%w: result %d: %v", ErrEventStore, event.Sequence, err)
			}
		}
		logged.Event = event
		actor.results[command.RequestID] = logged
	}
	for _, event := range events[start+1:] {
		var command MatchCommand
		if err := json.Unmarshal(event.Command, &command); err != nil {
			return nil, fmt.Errorf("%w: command %d: %v", ErrEventStore, event.Sequence, err)
		}
		// Historical deadlines are derived from the event's committed time,
		// not the wall clock at recovery time. This keeps replay hashes stable
		// across process restarts and clock advancement.
		eventTime := event.OccurredAt
		actor.engine.now = func() time.Time { return eventTime }
		result, actionErr := applyCommand(actor.engine, command)
		if actionErr != nil && !errors.Is(actionErr, ErrHandComplete) {
			return nil, fmt.Errorf("%w: replay command %d: %v", ErrEventStore, event.Sequence, actionErr)
		}
		hash, hashErr := stateHash(actor.engine)
		if hashErr != nil || hash != event.StateHash {
			return nil, fmt.Errorf("%w: replay hash mismatch at event %d", ErrEventStore, event.Sequence)
		}
		_ = result
	}
	actor.engine.now = now
	return actor, nil
}

func applyCommand(engine *TurnEngine, command MatchCommand) (CommandResult, error) {
	result := CommandResult{}
	var actionErr error
	switch command.Type {
	case CommandBeginInitialReplacement:
		actionErr = engine.BeginInitialReplacement()
	case CommandDraw:
		var draw DrawResult
		draw, actionErr = engine.Draw(command.ExpectedVersion)
		result.Draw = &draw
	case CommandDiscard:
		var window *ClaimWindow
		window, actionErr = engine.Discard(command.ExpectedVersion, command.Seat, command.TileID)
		result.ClaimWindow = window
	case CommandSubmitClaim:
		if command.Claim == nil {
			actionErr = ErrClaimIllegal
		} else {
			actionErr = engine.SubmitClaim(*command.Claim)
		}
	case CommandResolveClaims:
		var resolution ClaimResolution
		resolution, actionErr = engine.ResolveClaims(command.ExpectedVersion)
		result.Resolution = &resolution
	case CommandDeclareZimo:
		result.HandResult, actionErr = engine.DeclareZimo(command.ExpectedVersion, command.Seat)
	case CommandDeclareConcealedKong:
		var draw DrawResult
		draw, actionErr = engine.DeclareConcealedKong(command.ExpectedVersion, command.Seat, command.TileIDs)
		result.Draw = &draw
	case CommandDeclareAddedKong:
		result.RobWindow, actionErr = engine.DeclareAddedKong(command.ExpectedVersion, command.Seat, command.TileID)
	case CommandSubmitRob:
		if command.Rob == nil {
			actionErr = ErrClaimIllegal
		} else {
			actionErr = engine.SubmitRobResponse(*command.Rob)
		}
	case CommandResolveRob:
		result.HandResult, actionErr = engine.ResolveRob(command.ExpectedVersion)
	case CommandRespondOffer:
		result.HandResult, actionErr = engine.RespondOffer(command.ExpectedVersion, command.Seat, command.Accept)
	case CommandAutoDiscardExpiredTurn:
		result.ClaimWindow, actionErr = engine.AutoDiscardExpiredTurn(engine.now())
	default:
		actionErr = ErrTurnState
	}
	if result.HandResult == nil {
		result.HandResult = engine.Result()
	}
	return result, actionErr
}

func engineFromSnapshot(encoded []byte, now func() time.Time) (*TurnEngine, error) {
	var saved actorSnapshot
	if err := json.Unmarshal(encoded, &saved); err != nil {
		return nil, fmt.Errorf("%w: snapshot JSON: %v", ErrEventStore, err)
	}
	deal, err := dealFromSnapshot(saved.Deal)
	if err != nil {
		return nil, err
	}
	engine, err := NewTurnEngine(deal, now)
	if err != nil {
		return nil, err
	}
	engine.Phase = saved.Turn.Phase
	engine.ActiveSeat = saved.Turn.ActiveSeat
	engine.Version = saved.Turn.Version
	if saved.Turn.LastDiscard != nil {
		last := *saved.Turn.LastDiscard
		engine.LastDiscard = &last
	}
	if saved.Turn.Claim != nil {
		claim := saved.Turn.Claim
		engine.Claim = &ClaimWindow{ActionID: claim.ActionID, StateVersion: claim.StateVersion, Discard: claim.Discard, Deadline: claim.Deadline, Eligible: append([]Seat(nil), claim.Eligible...), Responses: map[Seat]ClaimResponse{}}
		for _, response := range claim.Responses {
			response.TileIDs = append([]string(nil), response.TileIDs...)
			engine.Claim.Responses[response.Seat] = response
		}
	}
	engine.winLocks = map[Seat]bool{}
	for _, seat := range saved.Turn.WinLocks {
		engine.winLocks[seat] = true
	}
	engine.discards = append([]Discard(nil), saved.Turn.Discards...)
	engine.claimsOccurred = saved.Turn.ClaimsOccurred
	engine.hasDrawn = map[Seat]bool{}
	for _, seat := range saved.Turn.HasDrawn {
		engine.hasDrawn[seat] = true
	}
	engine.heavenlyAvailable = saved.Turn.HeavenlyAvailable
	engine.heavenlyLapsed = saved.Turn.HeavenlyLapsed
	engine.initialNext = saved.Turn.InitialNext
	if saved.Turn.Offer != nil {
		offer := *saved.Turn.Offer
		engine.offer = &offer
	}
	if saved.Turn.Rob != nil {
		rob := saved.Turn.Rob
		engine.rob = &RobWindow{ActionID: rob.ActionID, StateVersion: rob.StateVersion, Declarer: rob.Declarer, Tile: rob.Tile, MeldIndex: rob.MeldIndex, Deadline: rob.Deadline, Eligible: append([]Seat(nil), rob.Eligible...), Responses: map[Seat]RobResponse{}}
		for _, response := range rob.Responses {
			engine.rob.Responses[response.Seat] = response
		}
	}
	if saved.Turn.LastDraw != nil {
		draw := *saved.Turn.LastDraw
		engine.lastDraw = &draw
	}
	if saved.Turn.Result != nil {
		result := *saved.Turn.Result
		result.Winners = append([]HandWinner(nil), saved.Turn.Result.Winners...)
		engine.result = &result
	}
	if saved.Turn.TurnDeadline != nil {
		deadline := *saved.Turn.TurnDeadline
		engine.TurnDeadline = &deadline
	}
	engine.deadlineConfig = saved.Turn.DeadlineConfig
	engine.networkEstimate = saved.Turn.NetworkEstimate
	engine.afkStrikes = map[Seat]int{}
	for _, entry := range saved.Turn.AFKStrikes {
		engine.afkStrikes[entry.Seat] = entry.Strikes
	}
	engine.takenOver = map[Seat]bool{}
	for _, seat := range saved.Turn.TakenOver {
		engine.takenOver[seat] = true
	}
	return engine, nil
}

func dealFromSnapshot(encoded []byte) (*DealState, error) {
	var saved struct {
		Seed        uint64        `json:"seed"`
		Dice        [2]uint8      `json:"dice"`
		CatalogHash string        `json:"catalog_hash"`
		WallHash    string        `json:"wall_hash"`
		Players     []PlayerState `json:"players"`
		Wall        wallSnapshot  `json:"wall"`
	}
	if err := json.Unmarshal(encoded, &saved); err != nil {
		return nil, fmt.Errorf("%w: deal snapshot JSON: %v", ErrEventStore, err)
	}
	if saved.CatalogHash != CatalogHash() || len(saved.Wall.Tiles) != len(Catalog()) || len(saved.Players) != len(seats) || hashTiles(saved.Wall.Tiles) != saved.WallHash {
		return nil, fmt.Errorf("%w: deal snapshot catalog/state mismatch", ErrEventStore)
	}
	wall := &Wall{tiles: append([]Tile(nil), saved.Wall.Tiles...), front: saved.Wall.Front, back: saved.Wall.Back, reserve: saved.Wall.ReserveRemaining}
	if wall.front < 0 || wall.back < 0 || wall.front+wall.back > len(wall.tiles) || wall.reserve < 0 || wall.reserve > wall.Remaining() {
		return nil, fmt.Errorf("%w: deal snapshot wall bounds", ErrEventStore)
	}
	return &DealState{Seed: saved.Seed, Dice: saved.Dice, CatalogHash: saved.CatalogHash, WallHash: saved.WallHash, Players: saved.Players, Wall: wall}, nil
}

// NewMatchActor writes a match.created event containing the initial state. It
// is the first durable record, so a later actor can recover without trusting a
// caller-provided in-memory state.
func NewMatchActor(ctx context.Context, matchID string, engine *TurnEngine, store EventStore, now func() time.Time) (*MatchActor, error) {
	if matchID == "" {
		return nil, ErrMatchRequired
	}
	if engine == nil || engine.Deal == nil || store == nil {
		return nil, fmt.Errorf("%w: actor dependencies are incomplete", ErrEventStore)
	}
	if now == nil {
		now = time.Now
	}
	actor := &MatchActor{
		matchID:       matchID,
		store:         store,
		engine:        cloneTurnEngine(engine),
		clock:         now,
		snapshotEvery: 30,
		results:       map[string]CommandResult{},
	}
	// The actor clock is authoritative for deadlines during command handling;
	// retaining a caller's test clock here would make replay hashes diverge.
	actor.engine.now = now
	snapshot, err := actor.snapshotBytes()
	if err != nil {
		return nil, err
	}
	hash, err := stateHash(actor.engine)
	if err != nil {
		return nil, err
	}
	event := MatchEvent{
		Sequence:     1,
		MatchID:      matchID,
		Type:         "match.created",
		OccurredAt:   now().UTC().Truncate(time.Microsecond),
		StateVersion: actor.engine.Version,
		StateHash:    hash,
		Snapshot:     snapshot,
	}
	if err := store.Append(ctx, event); err != nil {
		return nil, err
	}
	actor.sequence = 1
	actor.lastSnapshotAt = event.OccurredAt
	return actor, nil
}

func (a *MatchActor) Apply(ctx context.Context, command MatchCommand) (CommandResult, error) {
	if a == nil {
		return CommandResult{}, fmt.Errorf("%w: actor is incomplete", ErrEventStore)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.engine == nil || a.store == nil {
		return CommandResult{}, fmt.Errorf("%w: actor is incomplete", ErrEventStore)
	}
	if command.MatchID == "" {
		command.MatchID = a.matchID
	}
	if command.MatchID != a.matchID {
		return CommandResult{}, ErrMatchMismatch
	}
	if command.RequestID == "" {
		return CommandResult{}, ErrRequestRequired
	}
	if previous, ok := a.results[command.RequestID]; ok {
		return previous, nil
	}

	// PostgreSQL timestamptz persists microsecond precision. Normalize before
	// deriving state so the event clock survives a storage round trip exactly.
	now := a.clock().UTC().Truncate(time.Microsecond)
	working := cloneTurnEngine(a.engine)
	// Any time-derived state (notably claim deadlines) must use the exact
	// timestamp persisted on the event. Replay uses OccurredAt as its clock,
	// so deriving state from a separate wall-clock read would make hashes
	// differ by the time elapsed between the two reads.
	working.now = func() time.Time { return now }
	result, actionErr := applyCommand(working, command)
	committed := actionErr == nil || errors.Is(actionErr, ErrHandComplete)
	if !committed {
		return CommandResult{}, actionErr
	}

	hash, err := stateHash(working)
	if err != nil {
		return CommandResult{}, err
	}
	result.Phase = working.Phase
	result.Version = working.Version
	result.StateHash = hash
	result.Snapshot = working.Snapshot()
	resultBytes, err := json.Marshal(result)
	if err != nil {
		return CommandResult{}, err
	}
	commandBytes, err := json.Marshal(command)
	if err != nil {
		return CommandResult{}, err
	}
	event := MatchEvent{
		Sequence:     a.sequence + 1,
		MatchID:      a.matchID,
		Type:         "command." + string(command.Type),
		RequestID:    command.RequestID,
		OccurredAt:   now,
		StateVersion: working.Version,
		StateHash:    hash,
		Command:      commandBytes,
		Result:       resultBytes,
	}
	if a.snapshotDue(now) {
		snapshot, snapshotErr := snapshotBytes(working)
		if snapshotErr != nil {
			return CommandResult{}, snapshotErr
		}
		event.Snapshot = snapshot
	}
	if actionErr != nil {
		event.ErrorCode = "hand_complete"
	}
	if err := a.store.Append(ctx, event); err != nil {
		return CommandResult{}, err
	}
	a.engine = working
	a.sequence = event.Sequence
	if len(event.Snapshot) > 0 {
		a.lastSnapshotAt = now
	}
	eventResult := result
	eventResult.Event = event
	a.results[command.RequestID] = eventResult
	return eventResult, actionErr
}

// Peek returns a throwaway clone of the current engine state, safe for a
// caller to inspect (or even mutate) for decision-making purposes — e.g. a
// bot policy computing a takeover move. The clone is never merged back;
// any resulting action must be submitted through Apply using the normal
// command shape so it is properly logged and replayable.
func (a *MatchActor) Peek() *TurnEngine {
	if a == nil {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.engine == nil {
		return nil
	}
	return cloneTurnEngine(a.engine)
}

func (a *MatchActor) snapshotDue(now time.Time) bool {
	return a.snapshotEvery > 0 && (a.sequence%a.snapshotEvery == 0 || now.Sub(a.lastSnapshotAt) >= 30*time.Second)
}

func (a *MatchActor) View(seat Seat) (SeatView, error) {
	if a == nil {
		return SeatView{}, fmt.Errorf("%w: actor is incomplete", ErrEventStore)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.engine == nil {
		return SeatView{}, fmt.Errorf("%w: actor is incomplete", ErrEventStore)
	}
	return a.engine.ProjectSeat(a.matchID, seat)
}

func (a *MatchActor) Events(ctx context.Context) ([]MatchEvent, error) {
	if a == nil || a.store == nil {
		return nil, fmt.Errorf("%w: actor is incomplete", ErrEventStore)
	}
	return a.store.Events(ctx, a.matchID)
}

// Previous returns the committed result for an idempotency key. Match-runtime
// adapters use this before current-phase authorization so a retry receives its
// original acknowledgement even after the actor has advanced.
func (a *MatchActor) Previous(requestID string) (CommandResult, bool) {
	if a == nil || requestID == "" {
		return CommandResult{}, false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	result, ok := a.results[requestID]
	return result, ok
}

func (a *MatchActor) snapshotBytes() ([]byte, error) {
	return snapshotBytes(a.engine)
}

type actorSnapshot struct {
	Deal json.RawMessage `json:"deal"`
	Turn TurnSnapshot    `json:"turn"`
}

func snapshotBytes(engine *TurnEngine) ([]byte, error) {
	deal, err := engine.Deal.SnapshotBytes()
	if err != nil {
		return nil, err
	}
	return json.Marshal(actorSnapshot{Deal: deal, Turn: engine.Snapshot()})
}

func stateHash(engine *TurnEngine) (string, error) {
	if engine == nil || engine.Deal == nil {
		return "", ErrTurnState
	}
	dealHash, err := engine.Deal.Hash()
	if err != nil {
		return "", err
	}
	turnHash, err := engine.Hash()
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(struct {
		DealHash string `json:"deal_hash"`
		TurnHash string `json:"turn_hash"`
	}{DealHash: dealHash, TurnHash: turnHash})
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

func cloneTurnEngine(engine *TurnEngine) *TurnEngine {
	if engine == nil {
		return nil
	}
	cloned := *engine
	cloned.Deal = cloneDealState(engine.Deal)
	cloned.LastDiscard = nil
	if engine.LastDiscard != nil {
		last := *engine.LastDiscard
		cloned.LastDiscard = &last
	}
	cloned.Claim = cloneClaimWindow(engine.Claim)
	cloned.winLocks = map[Seat]bool{}
	for seat, locked := range engine.winLocks {
		cloned.winLocks[seat] = locked
	}
	cloned.discards = append([]Discard(nil), engine.discards...)
	cloned.hasDrawn = map[Seat]bool{}
	for seat, drawn := range engine.hasDrawn {
		cloned.hasDrawn[seat] = drawn
	}
	cloned.offer = engine.Offer()
	cloned.rob = cloneRobWindow(engine.rob)
	if engine.lastDraw != nil {
		draw := *engine.lastDraw
		cloned.lastDraw = &draw
	}
	cloned.result = engine.Result()
	cloned.TurnDeadline = nil
	if engine.TurnDeadline != nil {
		deadline := *engine.TurnDeadline
		cloned.TurnDeadline = &deadline
	}
	// afkStrikes/takenOver are maps: the `cloned := *engine` shallow copy
	// above left them aliased to engine's own maps, which would let a
	// speculative working-copy mutation (Apply's clone-before-commit
	// pattern) leak back into the committed engine before the command even
	// succeeds.
	cloned.afkStrikes = map[Seat]int{}
	for seat, strikes := range engine.afkStrikes {
		cloned.afkStrikes[seat] = strikes
	}
	cloned.takenOver = map[Seat]bool{}
	for seat, taken := range engine.takenOver {
		cloned.takenOver[seat] = taken
	}
	return &cloned
}

func cloneClaimWindow(window *ClaimWindow) *ClaimWindow {
	if window == nil {
		return nil
	}
	cloned := *window
	cloned.Eligible = append([]Seat(nil), window.Eligible...)
	cloned.Responses = map[Seat]ClaimResponse{}
	for seat, response := range window.Responses {
		response.TileIDs = append([]string(nil), response.TileIDs...)
		cloned.Responses[seat] = response
	}
	return &cloned
}

func cloneDealState(state *DealState) *DealState {
	if state == nil {
		return nil
	}
	cloned := *state
	cloned.Players = make([]PlayerState, len(state.Players))
	for index, player := range state.Players {
		cloned.Players[index] = player
		cloned.Players[index].Hand = append([]Tile(nil), player.Hand...)
		cloned.Players[index].Exposed = append([]Tile(nil), player.Exposed...)
		cloned.Players[index].Melds = cloneMelds(player.Melds)
	}
	if state.Wall != nil {
		snapshot := state.Wall.Snapshot()
		cloned.Wall = &Wall{tiles: append([]Tile(nil), snapshot.Tiles...), front: snapshot.Front, back: snapshot.Back, reserve: snapshot.ReserveRemaining}
	}
	return &cloned
}
