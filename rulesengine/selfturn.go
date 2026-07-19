package rulesengine

import (
	"fmt"
	"time"
)

// PhaseRobWindow is the pause opened by an added-Kong declaration while
// opponents decide whether to rob it (§5.7).
const PhaseRobWindow TurnPhase = "rob_window"

type WinKind string

const (
	WinDiscard        WinKind = "discard"
	WinZimo           WinKind = "zimo"
	WinRob            WinKind = "rob"
	WinEightFlowers   WinKind = "eight_flowers"
	WinHeavenly       WinKind = "heavenly"
	KindExhaustiveDraw WinKind = "exhaustive_draw"
)

type OfferType string

const (
	OfferEightFlowers OfferType = "eight_flowers"
	OfferHeavenly     OfferType = "heavenly"
)

// OfferState is a server-initiated Win offer (§5.9). ResumeIndex is the next
// seat index of the interrupted initial replacement, or -1 when the offer was
// raised during normal play.
type OfferState struct {
	Type         OfferType `json:"type"`
	Seat         Seat      `json:"seat"`
	StateVersion uint64    `json:"state_version"`
	ResumeIndex  int       `json:"resume_index"`
}

type RobResponse struct {
	Seat             Seat   `json:"seat"`
	Win              bool   `json:"win"`
	StateVersion     uint64 `json:"state_version"`
	ResponseRevision uint64 `json:"response_revision"`
}

type RobWindow struct {
	ActionID     string               `json:"action_id"`
	StateVersion uint64               `json:"state_version"`
	Declarer     Seat                 `json:"declarer"`
	Tile         Tile                 `json:"tile"`
	MeldIndex    int                  `json:"meld_index"`
	Deadline     time.Time            `json:"deadline"`
	Eligible     []Seat               `json:"eligible"`
	Responses    map[Seat]RobResponse `json:"responses"`
}

// DrawContext records the most recent tile a seat brought into hand and the
// special-win eligibilities that attach to it (§5.9).
type DrawContext struct {
	Seat            Seat   `json:"seat"`
	TileID          string `json:"tile_id"`
	Replacement     bool   `json:"replacement"`
	LastTile        bool   `json:"last_tile"`
	EarthlyEligible bool   `json:"earthly_eligible"`
}

type HandWinner struct {
	Seat    Seat         `json:"seat"`
	Context ScoreContext `json:"context"`
	Score   ScoreResult  `json:"score"`
}

// HandResult is the terminal record of a hand. Discard and rob wins name one
// payer; Zimo, Heavenly, and Eight Flowers use the three-opponent model, and
// an exhaustive draw transfers nothing (§7.3).
type HandResult struct {
	Kind          WinKind      `json:"kind"`
	Winners       []HandWinner `json:"winners,omitempty"`
	Payer         Seat         `json:"payer,omitempty"`
	WinningTileID string       `json:"winning_tile_id,omitempty"`
}

func (e *TurnEngine) Result() *HandResult {
	if e == nil || e.result == nil {
		return nil
	}
	copied := *e.result
	copied.Winners = append([]HandWinner(nil), e.result.Winners...)
	return &copied
}

func (e *TurnEngine) Offer() *OfferState {
	if e == nil || e.offer == nil {
		return nil
	}
	copied := *e.offer
	return &copied
}

func (e *TurnEngine) Rob() *RobWindow {
	if e == nil || e.rob == nil {
		return nil
	}
	return cloneRobWindow(e.rob)
}

func (e *TurnEngine) DiscardPile() []Discard {
	if e == nil {
		return nil
	}
	return append([]Discard(nil), e.discards...)
}

// RespondOffer accepts or declines a pending §5.9 Win offer. Declining an
// Eight Flowers offer never forfeits the win — it is re-offered on that
// player's later turns — while declining Heavenly lapses it permanently.
func (e *TurnEngine) RespondOffer(expectedVersion uint64, seat Seat, accept bool) (*HandResult, error) {
	if e == nil || e.Deal == nil || e.Phase != PhaseOfferPending || e.offer == nil || seat != e.offer.Seat {
		return nil, ErrTurnState
	}
	if expectedVersion != e.Version {
		return nil, ErrStaleAction
	}
	offer := *e.offer
	e.offer = nil
	if accept {
		switch offer.Type {
		case OfferEightFlowers:
			return e.completeEightFlowers(seat)
		case OfferHeavenly:
			return e.completeHeavenly()
		}
		return nil, ErrTurnState
	}
	switch offer.Type {
	case OfferEightFlowers:
		if offer.ResumeIndex >= 0 {
			e.Phase = PhaseInitialReplacement
			return nil, e.continueInitialReplacement()
		}
		e.Phase = PhaseAwaitingDiscard
		e.Version++
		return nil, nil
	case OfferHeavenly:
		e.heavenlyAvailable = false
		e.heavenlyLapsed = true
		e.Phase = PhaseAwaitingDiscard
		e.Version++
		return nil, nil
	}
	return nil, ErrTurnState
}

// DeclareZimo wins on the active seat's own most recent draw. Replacement,
// last-tile, and Earthly eligibility come from that draw's context.
func (e *TurnEngine) DeclareZimo(expectedVersion uint64, seat Seat) (*HandResult, error) {
	if e == nil || e.Deal == nil || e.Phase != PhaseAwaitingDiscard || seat != e.ActiveSeat ||
		e.lastDraw == nil || e.lastDraw.Seat != seat {
		return nil, ErrTurnState
	}
	if expectedVersion != e.Version {
		return nil, ErrStaleAction
	}
	player, err := e.player(seat)
	if err != nil {
		return nil, err
	}
	if !CanWin(player.Hand, player.Melds) {
		return nil, ErrClaimIllegal
	}
	context := ScoreContext{
		Seat:        seat,
		Zimo:        true,
		Replacement: e.lastDraw.Replacement,
		LastTile:    e.lastDraw.LastTile,
		EarthlyHand: e.lastDraw.EarthlyEligible,
		SingleWait:  e.singleWaitExcluding(player, e.lastDraw.TileID),
	}
	score, err := ScoreHand(*player, context)
	if err != nil {
		return nil, err
	}
	if !score.Winning {
		return nil, ErrClaimIllegal
	}
	result := &HandResult{
		Kind:          WinZimo,
		Winners:       []HandWinner{{Seat: seat, Context: context, Score: score}},
		WinningTileID: e.lastDraw.TileID,
	}
	e.finishHand(result)
	return e.Result(), nil
}

// DeclareConcealedKong exposes four self-drawn copies during the active
// seat's discard window, then takes the mandatory replacement draw (§5.7).
func (e *TurnEngine) DeclareConcealedKong(expectedVersion uint64, seat Seat, tileIDs []string) (DrawResult, error) {
	if e == nil || e.Deal == nil || e.Phase != PhaseAwaitingDiscard || seat != e.ActiveSeat {
		return DrawResult{}, ErrTurnState
	}
	if expectedVersion != e.Version {
		return DrawResult{}, ErrStaleAction
	}
	if len(tileIDs) == 0 {
		return DrawResult{}, ErrClaimIllegal
	}
	player, err := e.player(seat)
	if err != nil {
		return DrawResult{}, err
	}
	var target *Tile
	for index := range player.Hand {
		if player.Hand[index].ID == tileIDs[0] {
			target = &player.Hand[index]
			break
		}
	}
	if target == nil {
		return DrawResult{}, ErrTileNotInHand
	}
	matching := matchingTiles(player.Hand, *target)
	requested := tileIDs
	if len(requested) == 1 {
		requested = nil
	}
	ids := selectIDs(matching, requested, 4)
	if len(ids) != 4 {
		return DrawResult{}, ErrClaimIllegal
	}
	claimed, err := removeTileIDs(player, ids)
	if err != nil {
		return DrawResult{}, err
	}
	player.Melds = append(player.Melds, Meld{Type: MeldKong, Tiles: claimed, Concealed: true})
	e.claimsOccurred = true
	return e.kongReplacementDraw(seat, player)
}

// DeclareAddedKong adds a self-drawn fourth copy to an exposed Pong and opens
// the rob window before the Kong is completed (§5.7).
func (e *TurnEngine) DeclareAddedKong(expectedVersion uint64, seat Seat, tileID string) (*RobWindow, error) {
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
	var tile *Tile
	for index := range player.Hand {
		if player.Hand[index].ID == tileID {
			tile = &player.Hand[index]
			break
		}
	}
	if tile == nil {
		return nil, ErrTileNotInHand
	}
	meldIndex := -1
	for index, meld := range player.Melds {
		if meld.Type == MeldPong && !meld.Concealed && sameTileType(meld.Tiles[0], *tile) {
			meldIndex = index
			break
		}
	}
	if meldIndex == -1 {
		return nil, ErrClaimIllegal
	}
	e.Version++
	eligible := make([]Seat, 0, len(seats)-1)
	for _, candidate := range seats {
		if candidate != seat {
			eligible = append(eligible, candidate)
		}
	}
	e.rob = &RobWindow{
		ActionID:     fmt.Sprintf("rob-%d", e.Version),
		StateVersion: e.Version,
		Declarer:     seat,
		Tile:         *tile,
		MeldIndex:    meldIndex,
		Deadline:     e.now().UTC().Add(10 * time.Second),
		Eligible:     eligible,
		Responses:    map[Seat]RobResponse{},
	}
	e.Phase = PhaseRobWindow
	return cloneRobWindow(e.rob), nil
}

// SubmitRobResponse records a win or pass against a pending added Kong. A
// pass here never creates the §5.8 discard-Win lock, but a seat already
// locked cannot win by robbing.
func (e *TurnEngine) SubmitRobResponse(response RobResponse) error {
	if e == nil || e.Phase != PhaseRobWindow || e.rob == nil {
		return ErrTurnState
	}
	window := e.rob
	if response.StateVersion != window.StateVersion {
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
	if response.Win {
		if e.winLocks[response.Seat] || e.winValidator == nil ||
			!e.winValidator(e.Deal, response.Seat, window.Tile) {
			return ErrClaimIllegal
		}
	}
	window.Responses[response.Seat] = response
	return nil
}

// ResolveRob closes the rob window: robbing winners take the added tile with
// the declarer as payer; otherwise the Kong completes with its replacement
// draw.
func (e *TurnEngine) ResolveRob(expectedVersion uint64) (*HandResult, error) {
	if e == nil || e.Deal == nil || e.Phase != PhaseRobWindow || e.rob == nil {
		return nil, ErrTurnState
	}
	window := e.rob
	if expectedVersion != window.StateVersion {
		return nil, ErrStaleAction
	}
	if len(window.Responses) != len(window.Eligible) && e.now().UTC().Before(window.Deadline) {
		return nil, ErrClaimPending
	}

	ordered := append([]Seat(nil), window.Eligible...)
	orderSeatsByProximity(ordered, window.Declarer)
	winners := make([]HandWinner, 0)
	for _, seat := range ordered {
		response, ok := window.Responses[seat]
		if !ok || !response.Win || e.winLocks[seat] {
			continue
		}
		player, err := e.player(seat)
		if err != nil {
			return nil, err
		}
		context := ScoreContext{
			Seat:            seat,
			DiscardWin:      true,
			RobbedAddedKong: true,
			SingleWait:      e.singleWaitExcluding(player, ""),
		}
		score, err := ScoreWinningDiscard(*player, window.Tile, context)
		if err != nil {
			return nil, err
		}
		if !score.Winning {
			return nil, ErrClaimIllegal
		}
		winners = append(winners, HandWinner{Seat: seat, Context: context, Score: score})
	}

	declarer, err := e.player(window.Declarer)
	if err != nil {
		return nil, err
	}
	if len(winners) > 0 {
		// The fourth tile becomes the winners' tile; the original Pong stands
		// and the Kong is never completed or scored (§5.7).
		if _, err := removeTileIDs(declarer, []string{window.Tile.ID}); err != nil {
			return nil, err
		}
		result := &HandResult{
			Kind:          WinRob,
			Winners:       winners,
			Payer:         window.Declarer,
			WinningTileID: window.Tile.ID,
		}
		e.rob = nil
		e.finishHand(result)
		return e.Result(), nil
	}

	if _, err := removeTileIDs(declarer, []string{window.Tile.ID}); err != nil {
		return nil, err
	}
	meld := &declarer.Melds[window.MeldIndex]
	meld.Type = MeldKong
	meld.Tiles = append(meld.Tiles, window.Tile)
	meld.Added = true
	declarer.Exposed = append(declarer.Exposed, window.Tile)
	e.claimsOccurred = true
	e.rob = nil
	e.Phase = PhaseAwaitingDiscard
	if _, err := e.kongReplacementDraw(window.Declarer, declarer); err != nil {
		return e.Result(), err
	}
	return nil, nil
}

// kongReplacementDraw performs the mandatory back draw after any completed
// Kong. A boundary hit ends the hand as an exhaustive draw while the Kong
// itself stands as a completed meld (§5.2).
func (e *TurnEngine) kongReplacementDraw(seat Seat, player *PlayerState) (DrawResult, error) {
	e.Phase = PhaseReplacementChain
	replacement, err := e.Deal.Wall.DrawBack()
	if err != nil {
		e.completeExhaustiveDraw()
		return DrawResult{Seat: seat, Replacement: true, Completed: true}, ErrHandComplete
	}
	if replacement.IsFlower() {
		replacement, err = e.Deal.ReplaceFlower(seat, replacement)
		if err != nil {
			e.completeExhaustiveDraw()
			return DrawResult{Seat: seat, Replacement: true, Completed: true}, ErrHandComplete
		}
	}
	player.Hand = append(player.Hand, replacement)
	sortByID(player.Hand)
	e.lastDraw = &DrawContext{
		Seat:        seat,
		TileID:      replacement.ID,
		Replacement: true,
		LastTile:    e.Deal.Wall.DrawableRemaining() == 0,
	}
	if e.exposedFlowerCount(seat) == 8 {
		e.Version++
		e.raiseOffer(OfferEightFlowers, seat, -1)
		return DrawResult{Seat: seat, Tile: replacement, Replacement: true}, nil
	}
	e.Phase = PhaseAwaitingDiscard
	e.Version++
	return DrawResult{Seat: seat, Tile: replacement, Replacement: true}, nil
}

func (e *TurnEngine) completeEightFlowers(seat Seat) (*HandResult, error) {
	player, err := e.player(seat)
	if err != nil {
		return nil, err
	}
	context := ScoreContext{Seat: seat, EightFlowers: true}
	score, err := ScoreHand(*player, context)
	if err != nil {
		return nil, err
	}
	if !score.Winning {
		return nil, ErrClaimIllegal
	}
	result := &HandResult{
		Kind:    WinEightFlowers,
		Winners: []HandWinner{{Seat: seat, Context: context, Score: score}},
	}
	e.finishHand(result)
	return e.Result(), nil
}

func (e *TurnEngine) completeHeavenly() (*HandResult, error) {
	player, err := e.player(East)
	if err != nil {
		return nil, err
	}
	context := ScoreContext{Seat: East, HeavenlyHand: true}
	score, err := ScoreHand(*player, context)
	if err != nil {
		return nil, err
	}
	if !score.Winning {
		return nil, ErrClaimIllegal
	}
	e.heavenlyAvailable = false
	result := &HandResult{
		Kind:    WinHeavenly,
		Winners: []HandWinner{{Seat: East, Context: context, Score: score}},
	}
	e.finishHand(result)
	return e.Result(), nil
}

// continueInitialReplacement advances the seat-by-seat initial replacement,
// pausing for an Eight Flowers offer immediately after the seat that exposed
// the eighth bonus tile, and raising the Heavenly offer once all four seats
// finish (§5.9).
func (e *TurnEngine) continueInitialReplacement() error {
	if e.Phase != PhaseInitialReplacement {
		return ErrTurnState
	}
	for e.initialNext < len(e.Deal.Players) {
		index := e.initialNext
		if err := e.Deal.replaceInitialFlowersFor(index); err != nil {
			e.completeExhaustiveDraw()
			return ErrHandComplete
		}
		e.initialNext++
		seat := e.Deal.Players[index].Seat
		if e.exposedFlowerCount(seat) == 8 {
			e.Version++
			e.raiseOffer(OfferEightFlowers, seat, e.initialNext)
			return nil
		}
	}
	east, err := e.player(East)
	if err != nil {
		return err
	}
	if CanWin(east.Hand, east.Melds) {
		e.heavenlyAvailable = true
		e.Version++
		e.raiseOffer(OfferHeavenly, East, -1)
		return nil
	}
	e.Phase = PhaseAwaitingDiscard
	e.Version++
	return nil
}

func (e *TurnEngine) raiseOffer(offerType OfferType, seat Seat, resumeIndex int) {
	e.offer = &OfferState{Type: offerType, Seat: seat, StateVersion: e.Version, ResumeIndex: resumeIndex}
	e.Phase = PhaseOfferPending
}

func (e *TurnEngine) finishHand(result *HandResult) {
	e.result = result
	e.Phase = PhaseHandComplete
	e.Claim = nil
	e.rob = nil
	e.offer = nil
	e.lastDraw = nil
	e.Version++
}

func (e *TurnEngine) completeExhaustiveDraw() {
	e.result = &HandResult{Kind: KindExhaustiveDraw}
	e.Phase = PhaseExhaustiveDraw
	e.Claim = nil
	e.rob = nil
	e.offer = nil
	e.lastDraw = nil
	e.Version++
}

func (e *TurnEngine) exposedFlowerCount(seat Seat) int {
	player, err := e.player(seat)
	if err != nil {
		return 0
	}
	count := 0
	for _, tile := range player.Exposed {
		if tile.IsFlower() {
			count++
		}
	}
	return count
}

// singleWaitExcluding reports whether exactly one tile identity completed the
// hand at the moment before winning (§6.1). excludeTileID removes a just-drawn
// winning tile so the wait is computed on the pre-win hand.
func (e *TurnEngine) singleWaitExcluding(player *PlayerState, excludeTileID string) bool {
	hand := make([]Tile, 0, len(player.Hand))
	excluded := false
	for _, tile := range player.Hand {
		if !excluded && tile.ID == excludeTileID {
			excluded = true
			continue
		}
		hand = append(hand, tile)
	}
	waits, err := WinningTiles(hand, player.Melds)
	return err == nil && len(waits) == 1
}

func orderSeatsByProximity(list []Seat, from Seat) {
	for i := 1; i < len(list); i++ {
		for j := i; j > 0 && seatDistance(from, list[j]) < seatDistance(from, list[j-1]); j-- {
			list[j], list[j-1] = list[j-1], list[j]
		}
	}
}

func cloneRobWindow(window *RobWindow) *RobWindow {
	if window == nil {
		return nil
	}
	cloned := *window
	cloned.Eligible = append([]Seat(nil), window.Eligible...)
	cloned.Responses = map[Seat]RobResponse{}
	for seat, response := range window.Responses {
		cloned.Responses[seat] = response
	}
	return &cloned
}

func sortByID(tiles []Tile) {
	for i := 1; i < len(tiles); i++ {
		for j := i; j > 0 && tiles[j].ID < tiles[j-1].ID; j-- {
			tiles[j], tiles[j-1] = tiles[j-1], tiles[j]
		}
	}
}
