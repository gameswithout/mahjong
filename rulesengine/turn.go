package rulesengine

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

type TurnPhase string

const (
	PhaseInitialReplacement TurnPhase = "initial_replacement"
	PhaseAwaitingDraw       TurnPhase = "awaiting_draw"
	PhaseOfferPending       TurnPhase = "offer_pending"
	PhaseAwaitingDiscard    TurnPhase = "awaiting_discard"
	PhaseClaimWindow        TurnPhase = "claim_window"
	PhaseReplacementChain   TurnPhase = "replacement_chain"
	PhaseExhaustiveDraw     TurnPhase = "exhaustive_draw"
	PhaseHandComplete       TurnPhase = "hand_complete"
)

type ClaimType string

const (
	ClaimPass ClaimType = "pass"
	ClaimWin  ClaimType = "win"
	ClaimPong ClaimType = "pong"
	ClaimKong ClaimType = "kong"
	ClaimChow ClaimType = "chow"
)

var (
	ErrTurnState       = errors.New("invalid turn state")
	ErrStaleAction     = errors.New("stale action or state version")
	ErrClaimPending    = errors.New("claim window is still pending")
	ErrClaimDeadline   = errors.New("claim window deadline has passed")
	ErrClaimIllegal    = errors.New("claim is not legal")
	ErrTileNotInHand   = errors.New("tile is not in the player's hand")
	ErrHandComplete    = errors.New("hand is complete")
	ErrActionDuplicate = errors.New("claim response revision is not next")
)

// WinValidator receives authoritative state and can never be supplied by the
// browser. TurnEngine uses DefaultWinValidator unless a test or alternate
// ruleset explicitly supplies one.
type WinValidator func(state *DealState, seat Seat, discard Tile) bool

type Discard struct {
	Seat     Seat   `json:"seat"`
	Tile     Tile   `json:"tile"`
	Sequence uint64 `json:"sequence"`
}

type ClaimResponse struct {
	ActionID         string    `json:"action_id,omitempty"`
	Seat             Seat      `json:"seat"`
	Type             ClaimType `json:"type"`
	TileIDs          []string  `json:"tile_ids,omitempty"`
	StateVersion     uint64    `json:"state_version"`
	ResponseRevision uint64    `json:"response_revision"`
	Deliberate       bool      `json:"deliberate,omitempty"`
}

type ClaimWindow struct {
	ActionID     string                 `json:"action_id"`
	StateVersion uint64                 `json:"state_version"`
	Discard      Discard                `json:"discard"`
	Deadline     time.Time              `json:"deadline"`
	Eligible     []Seat                 `json:"eligible"`
	Responses    map[Seat]ClaimResponse `json:"responses"`
}

type ClaimResolution struct {
	Type        ClaimType `json:"type"`
	Discard     Discard   `json:"discard"`
	Winners     []Seat    `json:"winners,omitempty"`
	Claimant    Seat      `json:"claimant,omitempty"`
	NextSeat    Seat      `json:"next_seat,omitempty"`
	Replacement bool      `json:"replacement,omitempty"`
	Completed   bool      `json:"completed"`
}

type DrawResult struct {
	Seat        Seat `json:"seat"`
	Tile        Tile `json:"tile,omitempty"`
	Replacement bool `json:"replacement"`
	Completed   bool `json:"completed"`
}

type TurnEngine struct {
	Deal        *DealState   `json:"-"`
	Phase       TurnPhase    `json:"phase"`
	ActiveSeat  Seat         `json:"active_seat"`
	Version     uint64       `json:"version"`
	LastDiscard *Discard     `json:"last_discard,omitempty"`
	Claim       *ClaimWindow `json:"claim,omitempty"`

	now          func() time.Time
	winValidator WinValidator
	winLocks     map[Seat]bool

	// Special-win and Kong-flow state (§5.7, §5.9).
	discards          []Discard
	claimsOccurred    bool
	hasDrawn          map[Seat]bool
	heavenlyAvailable bool
	heavenlyLapsed    bool
	initialNext       int
	offer             *OfferState
	rob               *RobWindow
	lastDraw          *DrawContext
	result            *HandResult
}

func NewTurnEngine(deal *DealState, now func() time.Time, validators ...WinValidator) (*TurnEngine, error) {
	if deal == nil || deal.Wall == nil || len(deal.Players) != len(seats) {
		return nil, ErrTurnState
	}
	if now == nil {
		now = time.Now
	}
	validator := WinValidator(DefaultWinValidator)
	if len(validators) > 0 && validators[0] != nil {
		validator = validators[0]
	}
	return &TurnEngine{
		Deal:         deal,
		Phase:        PhaseInitialReplacement,
		ActiveSeat:   East,
		Version:      1,
		now:          now,
		winValidator: validator,
		winLocks:     map[Seat]bool{},
		hasDrawn:     map[Seat]bool{},
	}, nil
}

// BeginInitialReplacement runs the seat-by-seat initial Flower replacement.
// East receives the dealer's seventeenth tile during the deal, so once every
// seat finishes (and any §5.9 offer resolves) the first normal action is a
// discard.
func (e *TurnEngine) BeginInitialReplacement() error {
	if e == nil || e.Deal == nil || e.Phase != PhaseInitialReplacement {
		return ErrTurnState
	}
	return e.continueInitialReplacement()
}

func (e *TurnEngine) Draw(expectedVersion uint64) (DrawResult, error) {
	if e == nil || e.Deal == nil || e.Phase != PhaseAwaitingDraw {
		return DrawResult{}, ErrTurnState
	}
	if expectedVersion != e.Version {
		return DrawResult{}, ErrStaleAction
	}

	tile, err := e.Deal.Wall.DrawFront()
	if err != nil {
		e.completeExhaustiveDraw()
		return DrawResult{Seat: e.ActiveSeat, Completed: true}, ErrHandComplete
	}
	result := DrawResult{Seat: e.ActiveSeat, Tile: tile}
	if tile.IsFlower() {
		result.Replacement = true
		e.Phase = PhaseReplacementChain
		tile, err = e.Deal.ReplaceFlower(e.ActiveSeat, tile)
		if err != nil {
			e.completeExhaustiveDraw()
			return DrawResult{Seat: e.ActiveSeat, Replacement: true, Completed: true}, ErrHandComplete
		}
	}
	player, err := e.player(e.ActiveSeat)
	if err != nil {
		return DrawResult{}, err
	}
	player.Hand = append(player.Hand, tile)
	sort.Slice(player.Hand, func(i, j int) bool { return player.Hand[i].ID < player.Hand[j].ID })
	result.Tile = tile
	// Earthly Hand eligibility attaches to a non-dealer's first personal draw
	// sequence before any Chow, Pong, or Kong has occurred (§5.9); a Flower
	// replacement in that sequence keeps eligibility and adds Win After
	// Replacement.
	earthly := e.ActiveSeat != East && !e.hasDrawn[e.ActiveSeat] && !e.claimsOccurred
	e.hasDrawn[e.ActiveSeat] = true
	e.lastDraw = &DrawContext{
		Seat:            e.ActiveSeat,
		TileID:          tile.ID,
		Replacement:     result.Replacement,
		LastTile:        e.Deal.Wall.DrawableRemaining() == 0,
		EarthlyEligible: earthly,
	}
	e.Version++
	if e.exposedFlowerCount(e.ActiveSeat) == 8 {
		e.raiseOffer(OfferEightFlowers, e.ActiveSeat, -1)
		return result, nil
	}
	e.Phase = PhaseAwaitingDiscard
	return result, nil
}

func (e *TurnEngine) Discard(expectedVersion uint64, seat Seat, tileID string) (*ClaimWindow, error) {
	if e == nil || e.Deal == nil || e.Phase != PhaseAwaitingDiscard || seat != e.ActiveSeat {
		return nil, ErrTurnState
	}
	if expectedVersion != e.Version {
		return nil, ErrStaleAction
	}
	player, err := e.player(seat)
	if err != nil {
		return nil, err
	}
	index := -1
	for i, tile := range player.Hand {
		if tile.ID == tileID {
			index = i
			break
		}
	}
	if index == -1 {
		return nil, ErrTileNotInHand
	}
	tile := player.Hand[index]
	if tile.IsFlower() {
		return nil, ErrClaimIllegal
	}
	player.Hand = append(player.Hand[:index], player.Hand[index+1:]...)
	e.winLocks[seat] = false
	e.lastDraw = nil
	e.heavenlyAvailable = false
	e.Version++
	discard := Discard{Seat: seat, Tile: tile, Sequence: e.Version}
	e.LastDiscard = &discard
	e.discards = append(e.discards, discard)
	eligible := make([]Seat, 0, len(seats)-1)
	for _, candidate := range seats {
		if candidate != seat {
			eligible = append(eligible, candidate)
		}
	}
	window := &ClaimWindow{
		ActionID:     fmt.Sprintf("claim-%d", e.Version),
		StateVersion: e.Version,
		Discard:      discard,
		Deadline:     e.now().UTC().Add(10 * time.Second),
		Eligible:     eligible,
		Responses:    map[Seat]ClaimResponse{},
	}
	e.Claim = window
	e.Phase = PhaseClaimWindow
	return window, nil
}

func (e *TurnEngine) SubmitClaim(response ClaimResponse) error {
	if e == nil || e.Phase != PhaseClaimWindow || e.Claim == nil {
		return ErrTurnState
	}
	window := e.Claim
	if response.StateVersion != window.StateVersion {
		return ErrStaleAction
	}
	if response.ActionID != "" && response.ActionID != window.ActionID {
		return ErrStaleAction
	}
	if e.now().UTC().After(window.Deadline) {
		return ErrClaimDeadline
	}
	if !containsSeat(window.Eligible, response.Seat) {
		return ErrClaimIllegal
	}
	previous, exists := window.Responses[response.Seat]
	wantRevision := uint64(0)
	if exists {
		wantRevision = previous.ResponseRevision + 1
	}
	if response.ResponseRevision != wantRevision {
		return ErrActionDuplicate
	}
	if response.Type == "" {
		return ErrClaimIllegal
	}

	switch response.Type {
	case ClaimPass:
		if response.Deliberate && e.winValidator != nil && !e.winLocks[response.Seat] &&
			e.winValidator(e.Deal, response.Seat, window.Discard.Tile) {
			e.winLocks[response.Seat] = true
		}
	case ClaimWin:
		if e.winLocks[response.Seat] || e.winValidator == nil ||
			!e.winValidator(e.Deal, response.Seat, window.Discard.Tile) {
			return ErrClaimIllegal
		}
	case ClaimPong:
		if !e.canPong(response.Seat, window.Discard.Tile, response.TileIDs) {
			return ErrClaimIllegal
		}
	case ClaimKong:
		if !e.canKong(response.Seat, window.Discard.Tile, response.TileIDs) {
			return ErrClaimIllegal
		}
	case ClaimChow:
		if !e.canChow(response.Seat, window.Discard.Tile, response.TileIDs) {
			return ErrClaimIllegal
		}
	default:
		return ErrClaimIllegal
	}
	response.TileIDs = append([]string(nil), response.TileIDs...)
	window.Responses[response.Seat] = response
	return nil
}

func (e *TurnEngine) ResolveClaims(expectedVersion uint64) (ClaimResolution, error) {
	if e == nil || e.Phase != PhaseClaimWindow || e.Claim == nil {
		return ClaimResolution{}, ErrTurnState
	}
	window := e.Claim
	if expectedVersion != window.StateVersion {
		return ClaimResolution{}, ErrStaleAction
	}
	if len(window.Responses) != len(window.Eligible) && e.now().UTC().Before(window.Deadline) {
		return ClaimResolution{}, ErrClaimPending
	}

	ordered := append([]Seat(nil), window.Eligible...)
	sort.SliceStable(ordered, func(i, j int) bool {
		return seatDistance(window.Discard.Seat, ordered[i]) < seatDistance(window.Discard.Seat, ordered[j])
	})
	resolution := ClaimResolution{Discard: window.Discard}
	for _, seat := range ordered {
		response, ok := window.Responses[seat]
		if ok && response.Type == ClaimWin && !e.winLocks[seat] {
			resolution.Winners = append(resolution.Winners, seat)
		}
	}
	if len(resolution.Winners) > 0 {
		resolution.Type = ClaimWin
		resolution.Completed = true
		winners := make([]HandWinner, 0, len(resolution.Winners))
		for _, seat := range resolution.Winners {
			player, err := e.player(seat)
			if err != nil {
				return ClaimResolution{}, err
			}
			context := ScoreContext{
				Seat:       seat,
				DiscardWin: true,
				SingleWait: e.singleWaitExcluding(player, ""),
			}
			score, err := ScoreWinningDiscard(*player, window.Discard.Tile, context)
			if err != nil {
				return ClaimResolution{}, err
			}
			winners = append(winners, HandWinner{Seat: seat, Context: context, Score: score})
		}
		// The winning tile leaves the discard pile with the win.
		e.popDiscard()
		e.finishHand(&HandResult{
			Kind:          WinDiscard,
			Winners:       winners,
			Payer:         window.Discard.Seat,
			WinningTileID: window.Discard.Tile.ID,
		})
		return resolution, nil
	}

	for _, seat := range ordered {
		response, ok := window.Responses[seat]
		if !ok || (response.Type != ClaimPong && response.Type != ClaimKong) {
			continue
		}
		resolution.Type = response.Type
		resolution.Claimant = seat
		if response.Type == ClaimPong {
			if err := e.applyPong(seat, window.Discard, response.TileIDs); err != nil {
				return ClaimResolution{}, err
			}
			resolution.NextSeat = seat
			return resolution, nil
		}
		resolution.Replacement = true
		completed, err := e.applyKong(seat, window.Discard, response.TileIDs)
		if err != nil {
			return ClaimResolution{}, err
		}
		resolution.Completed = completed
		resolution.NextSeat = seat
		return resolution, nil
	}

	next := nextSeat(window.Discard.Seat)
	if response, ok := window.Responses[next]; ok && response.Type == ClaimChow {
		if err := e.applyChow(next, window.Discard, response.TileIDs); err != nil {
			return ClaimResolution{}, err
		}
		resolution.Type = ClaimChow
		resolution.Claimant = next
		resolution.NextSeat = next
		return resolution, nil
	}

	e.ActiveSeat = next
	e.Phase = PhaseAwaitingDraw
	e.Claim = nil
	e.Version++
	resolution.NextSeat = next
	return resolution, nil
}

func (e *TurnEngine) IsWinLocked(seat Seat) bool {
	return e != nil && e.winLocks[seat]
}

func (e *TurnEngine) Snapshot() TurnSnapshot {
	snapshot := TurnSnapshot{Phase: e.Phase, ActiveSeat: e.ActiveSeat, Version: e.Version, WinLocks: []Seat{}}
	for _, seat := range seats {
		if e.winLocks[seat] {
			snapshot.WinLocks = append(snapshot.WinLocks, seat)
		}
	}
	if e.LastDiscard != nil {
		copy := *e.LastDiscard
		snapshot.LastDiscard = &copy
	}
	if e.Claim != nil {
		claim := ClaimSnapshot{ActionID: e.Claim.ActionID, StateVersion: e.Claim.StateVersion, Discard: e.Claim.Discard, Deadline: e.Claim.Deadline, Eligible: append([]Seat(nil), e.Claim.Eligible...)}
		for _, seat := range e.Claim.Eligible {
			if response, ok := e.Claim.Responses[seat]; ok {
				response.TileIDs = append([]string(nil), response.TileIDs...)
				claim.Responses = append(claim.Responses, response)
			}
		}
		snapshot.Claim = &claim
	}
	snapshot.Discards = append([]Discard(nil), e.discards...)
	snapshot.ClaimsOccurred = e.claimsOccurred
	for _, seat := range seats {
		if e.hasDrawn[seat] {
			snapshot.HasDrawn = append(snapshot.HasDrawn, seat)
		}
	}
	snapshot.HeavenlyAvailable = e.heavenlyAvailable
	snapshot.HeavenlyLapsed = e.heavenlyLapsed
	snapshot.InitialNext = e.initialNext
	snapshot.Offer = e.Offer()
	if e.rob != nil {
		rob := RobSnapshot{ActionID: e.rob.ActionID, StateVersion: e.rob.StateVersion, Declarer: e.rob.Declarer, Tile: e.rob.Tile, MeldIndex: e.rob.MeldIndex, Deadline: e.rob.Deadline, Eligible: append([]Seat(nil), e.rob.Eligible...)}
		for _, seat := range e.rob.Eligible {
			if response, ok := e.rob.Responses[seat]; ok {
				rob.Responses = append(rob.Responses, response)
			}
		}
		snapshot.Rob = &rob
	}
	if e.lastDraw != nil {
		draw := *e.lastDraw
		snapshot.LastDraw = &draw
	}
	snapshot.Result = e.Result()
	return snapshot
}

type TurnSnapshot struct {
	Phase             TurnPhase      `json:"phase"`
	ActiveSeat        Seat           `json:"active_seat"`
	Version           uint64         `json:"version"`
	LastDiscard       *Discard       `json:"last_discard,omitempty"`
	Claim             *ClaimSnapshot `json:"claim,omitempty"`
	WinLocks          []Seat         `json:"win_locks,omitempty"`
	Discards          []Discard      `json:"discards,omitempty"`
	ClaimsOccurred    bool           `json:"claims_occurred,omitempty"`
	HasDrawn          []Seat         `json:"has_drawn,omitempty"`
	HeavenlyAvailable bool           `json:"heavenly_available,omitempty"`
	HeavenlyLapsed    bool           `json:"heavenly_lapsed,omitempty"`
	InitialNext       int            `json:"initial_next,omitempty"`
	Offer             *OfferState    `json:"offer,omitempty"`
	Rob               *RobSnapshot   `json:"rob,omitempty"`
	LastDraw          *DrawContext   `json:"last_draw,omitempty"`
	Result            *HandResult    `json:"result,omitempty"`
}

type RobSnapshot struct {
	ActionID     string        `json:"action_id"`
	StateVersion uint64        `json:"state_version"`
	Declarer     Seat          `json:"declarer"`
	Tile         Tile          `json:"tile"`
	MeldIndex    int           `json:"meld_index"`
	Deadline     time.Time     `json:"deadline"`
	Eligible     []Seat        `json:"eligible"`
	Responses    []RobResponse `json:"responses,omitempty"`
}

type ClaimSnapshot struct {
	ActionID     string          `json:"action_id"`
	StateVersion uint64          `json:"state_version"`
	Discard      Discard         `json:"discard"`
	Deadline     time.Time       `json:"deadline"`
	Eligible     []Seat          `json:"eligible"`
	Responses    []ClaimResponse `json:"responses,omitempty"`
}

func (e *TurnEngine) Hash() (string, error) {
	encoded, err := json.Marshal(e.Snapshot())
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

func (e *TurnEngine) player(seat Seat) (*PlayerState, error) {
	for index := range e.Deal.Players {
		if e.Deal.Players[index].Seat == seat {
			return &e.Deal.Players[index], nil
		}
	}
	return nil, ErrUnknownSeat
}

func (e *TurnEngine) canPong(seat Seat, discard Tile, ids []string) bool {
	player, err := e.player(seat)
	if err != nil || discard.IsFlower() {
		return false
	}
	matching := matchingTiles(player.Hand, discard)
	return len(selectIDs(matching, ids, 2)) == 2
}

func (e *TurnEngine) canKong(seat Seat, discard Tile, ids []string) bool {
	player, err := e.player(seat)
	if err != nil || discard.IsFlower() {
		return false
	}
	matching := matchingTiles(player.Hand, discard)
	return len(selectIDs(matching, ids, 3)) == 3
}

func (e *TurnEngine) canChow(seat Seat, discard Tile, ids []string) bool {
	if e.LastDiscard == nil || seat != nextSeat(e.LastDiscard.Seat) || !discard.IsNumbered() || len(ids) != 2 {
		return false
	}
	player, err := e.player(seat)
	if err != nil {
		return false
	}
	selected := make([]Tile, 0, 2)
	for _, id := range ids {
		for _, tile := range player.Hand {
			if tile.ID == id {
				selected = append(selected, tile)
				break
			}
		}
	}
	if len(selected) != 2 || selected[0].Kind != discard.Kind || selected[1].Kind != discard.Kind {
		return false
	}
	ranks := []int{int(discard.Rank), int(selected[0].Rank), int(selected[1].Rank)}
	sort.Ints(ranks)
	return ranks[1] == ranks[0]+1 && ranks[2] == ranks[1]+1
}

func (e *TurnEngine) applyPong(seat Seat, discard Discard, requestedIDs []string) error {
	player, err := e.player(seat)
	if err != nil {
		return err
	}
	ids := selectIDs(matchingTiles(player.Hand, discard.Tile), requestedIDs, 2)
	if len(ids) != 2 {
		return ErrClaimIllegal
	}
	claimed, err := removeTileIDs(player, ids)
	if err != nil {
		return err
	}
	player.Exposed = append(player.Exposed, claimed...)
	player.Exposed = append(player.Exposed, discard.Tile)
	player.Melds = append(player.Melds, Meld{Type: MeldPong, Tiles: append(append([]Tile(nil), claimed...), discard.Tile), Claimed: true})
	e.popDiscard()
	e.claimsOccurred = true
	e.lastDraw = nil
	e.ActiveSeat = seat
	e.Phase = PhaseAwaitingDiscard
	e.Claim = nil
	e.Version++
	return nil
}

func (e *TurnEngine) applyKong(seat Seat, discard Discard, requestedIDs []string) (bool, error) {
	player, err := e.player(seat)
	if err != nil {
		return false, err
	}
	ids := selectIDs(matchingTiles(player.Hand, discard.Tile), requestedIDs, 3)
	if len(ids) != 3 {
		return false, ErrClaimIllegal
	}
	claimed, err := removeTileIDs(player, ids)
	if err != nil {
		return false, err
	}
	player.Exposed = append(player.Exposed, claimed...)
	player.Exposed = append(player.Exposed, discard.Tile)
	player.Melds = append(player.Melds, Meld{Type: MeldKong, Tiles: append(append([]Tile(nil), claimed...), discard.Tile), Claimed: true})
	e.popDiscard()
	e.claimsOccurred = true
	e.ActiveSeat = seat
	e.Claim = nil
	result, err := e.kongReplacementDraw(seat, player)
	return result.Completed, err
}

func (e *TurnEngine) applyChow(seat Seat, discard Discard, ids []string) error {
	if !e.canChow(seat, discard.Tile, ids) {
		return ErrClaimIllegal
	}
	player, err := e.player(seat)
	if err != nil {
		return err
	}
	claimed, err := removeTileIDs(player, ids)
	if err != nil {
		return err
	}
	player.Exposed = append(player.Exposed, claimed...)
	player.Exposed = append(player.Exposed, discard.Tile)
	player.Melds = append(player.Melds, Meld{Type: MeldChow, Tiles: append(append([]Tile(nil), claimed...), discard.Tile), Claimed: true})
	e.popDiscard()
	e.claimsOccurred = true
	e.lastDraw = nil
	e.ActiveSeat = seat
	e.Phase = PhaseAwaitingDiscard
	e.Claim = nil
	e.Version++
	return nil
}

// popDiscard removes the newest tile from the discard pile when a claim or
// win takes it out of the pile.
func (e *TurnEngine) popDiscard() {
	if len(e.discards) > 0 {
		e.discards = e.discards[:len(e.discards)-1]
	}
}

func matchingTiles(hand []Tile, target Tile) []Tile {
	matching := make([]Tile, 0, len(hand))
	for _, tile := range hand {
		if sameTileType(tile, target) {
			matching = append(matching, tile)
		}
	}
	sort.Slice(matching, func(i, j int) bool { return matching[i].ID < matching[j].ID })
	return matching
}

func sameTileType(left, right Tile) bool {
	if left.IsFlower() || right.IsFlower() || left.Kind != right.Kind {
		return false
	}
	if left.IsNumbered() {
		return left.Rank == right.Rank
	}
	return tileBaseID(left.ID) == tileBaseID(right.ID)
}

func tileBaseID(id string) string {
	index := strings.LastIndexByte(id, '-')
	if index == -1 {
		return id
	}
	return id[:index]
}

func selectIDs(tiles []Tile, ids []string, count int) []string {
	if len(ids) == 0 {
		return idsForCount(tiles, count)
	}
	if len(ids) != count {
		return nil
	}
	seen := map[string]struct{}{}
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			return nil
		}
		seen[id] = struct{}{}
		found := false
		for _, tile := range tiles {
			if tile.ID == id {
				found = true
				break
			}
		}
		if !found {
			return nil
		}
	}
	return append([]string(nil), ids...)
}

func idsForCount(tiles []Tile, count int) []string {
	if len(tiles) < count {
		return nil
	}
	ids := make([]string, 0, count)
	for _, tile := range tiles[:count] {
		ids = append(ids, tile.ID)
	}
	return ids
}

func removeTileIDs(player *PlayerState, ids []string) ([]Tile, error) {
	selected := make([]Tile, 0, len(ids))
	used := map[string]struct{}{}
	for _, id := range ids {
		if _, ok := used[id]; ok {
			return nil, ErrTileNotInHand
		}
		used[id] = struct{}{}
		found := -1
		for index, tile := range player.Hand {
			if tile.ID == id {
				found = index
				selected = append(selected, tile)
				break
			}
		}
		if found == -1 {
			return nil, ErrTileNotInHand
		}
	}
	for _, id := range ids {
		for index, tile := range player.Hand {
			if tile.ID == id {
				player.Hand = append(player.Hand[:index], player.Hand[index+1:]...)
				break
			}
		}
	}
	return selected, nil
}

func containsSeat(list []Seat, target Seat) bool {
	for _, seat := range list {
		if seat == target {
			return true
		}
	}
	return false
}

func seatDistance(from, to Seat) int {
	fromIndex, toIndex := 0, 0
	for index, seat := range seats {
		if seat == from {
			fromIndex = index
		}
		if seat == to {
			toIndex = index
		}
	}
	distance := (toIndex - fromIndex + len(seats)) % len(seats)
	if distance == 0 {
		return len(seats)
	}
	return distance
}

func nextSeat(current Seat) Seat {
	for index, seat := range seats {
		if seat == current {
			return seats[(index+1)%len(seats)]
		}
	}
	return East
}
