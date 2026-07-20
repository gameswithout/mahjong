package rulesengine

import (
	"errors"
	"fmt"
)

// SeatView is the only state shape intended for a browser seat. It contains
// that seat's concealed hand, public zones, and counts for every other hand;
// it never contains the unrevealed wall or another seat's concealed tile IDs.
type SeatView struct {
	MatchID      string         `json:"match_id"`
	Seat         Seat           `json:"seat"`
	StateVersion uint64         `json:"state_version"`
	Phase        TurnPhase      `json:"phase"`
	ActiveSeat   Seat           `json:"active_seat"`
	OwnHand      []Tile         `json:"own_hand"`
	OwnExposed   []Tile         `json:"own_exposed"`
	OwnMelds     []Meld         `json:"own_melds,omitempty"`
	Players      []PlayerView   `json:"players"`
	Wall         WallView       `json:"wall"`
	// Discards is the full public discard pile for every seat, chronological
	// by Sequence (§9.2's per-seat discard grids) — every discard is public
	// information in this ruleset, so no redaction is needed here.
	Discards    []Discard      `json:"discards,omitempty"`
	LastDiscard *Discard       `json:"last_discard,omitempty"`
	Claim       *SeatClaimView `json:"claim,omitempty"`
	WinLocked   bool           `json:"win_locked,omitempty"`
	// TurnDeadline is the active seat's §5.10 draw/discard decision
	// deadline, formatted the same way Claim.Deadline is. Only meaningful
	// while Phase is awaiting_draw or awaiting_discard — a stale value
	// while the engine is in another phase must not be treated as live
	// (mirrors TurnEngine.TurnDeadline's own doc comment).
	TurnDeadline string `json:"turn_deadline,omitempty"`
	// HandResult is set once Phase reaches hand_complete or
	// exhaustive_draw (§9.7 items 1-4: winning hand/tile, decomposition,
	// patterns, raw Tai). It is identical and safe for every seat — a
	// winning hand is legitimately revealed at showdown, and an
	// exhaustive draw's empty Winners reveals nothing. Settlement and
	// NextDealer (§9.7 items 5-7) are match-runtime concerns — dealer,
	// continuation count, and lobby tier are session state ProjectSeat has
	// no visibility into — so they are left for the runtime to attach
	// after calling ProjectSeat, not populated here.
	HandResult *HandResult          `json:"hand_result,omitempty"`
	Settlement *Settlement          `json:"settlement,omitempty"`
	NextDealer *ContinuationOutcome `json:"next_dealer,omitempty"`
	// Waits is the §9.4 Ting/wait-list assist: every tile type that would
	// complete this seat's own hand right now, each with its "Visible
	// remaining" count. Computed purely from this seat's own hand/melds
	// plus public information (§9.4: "never reads opponent hands or wall
	// order") — absent whenever the seat isn't holding a waiting-shaped
	// hand (e.g. mid-turn holding an undiscarded draw), not just when the
	// wait list is empty.
	Waits []WaitTileView `json:"waits,omitempty"`
}

// WaitTileView is one tile type in the §9.4 wait list. Tile is a concrete,
// unused physical tile of that type so the client can render it with the
// same glyph/label lookup as any other tile; VisibleRemaining is "four
// copies minus copies in the player's own hand, all discards, all exposed
// melds, and all exposed bonus/replacement information" (§9.4) and may be
// zero for a structurally legal but exhausted wait.
type WaitTileView struct {
	Tile             Tile `json:"tile"`
	VisibleRemaining int  `json:"visible_remaining"`
}

type PlayerView struct {
	Seat      Seat       `json:"seat"`
	HandCount int        `json:"hand_count"`
	Exposed   []Tile     `json:"exposed,omitempty"`
	MeldCount int        `json:"meld_count,omitempty"`
	Melds     []MeldView `json:"melds,omitempty"`
	// TakenOver reports whether this seat is currently bot-controlled at
	// all — §8.7/§11.1 disclosed AFK takeover OR a permanent AI Practice
	// bot seat (IsBot). This is public — every seat sees the same value
	// for a given player, matching the "Auto-playing"/"Bot" badge every
	// player at the table sees, not just the affected seat's own client.
	TakenOver bool `json:"taken_over,omitempty"`
	// IsBot reports whether this seat was never assigned to a human (AI
	// Practice mode), distinct from TakenOver's broader "currently
	// bot-controlled" — a client uses this to show "Bot" instead of
	// "Auto-playing (disconnected)", which would be misleading here.
	IsBot bool `json:"is_bot,omitempty"`
}

// MeldView is a redacted projection of a Meld for a seat other than its
// owner: Tiles is present for every exposed (Pong/Chow/added- or
// claimed-Kong) meld, but omitted for a concealed Kong — a concealed
// meld's tile identities remain hidden from opponents until revealed at
// showdown, matching real play (a concealed Kong shows face-down to
// everyone but its owner).
type MeldView struct {
	Type      MeldType `json:"type"`
	Tiles     []Tile   `json:"tiles,omitempty"`
	Concealed bool     `json:"concealed,omitempty"`
}

func meldView(meld Meld, owner bool) MeldView {
	view := MeldView{Type: meld.Type, Concealed: meld.Concealed}
	if owner || !meld.Concealed {
		view.Tiles = append([]Tile(nil), meld.Tiles...)
	}
	return view
}

type WallView struct {
	Remaining         int `json:"remaining"`
	DrawableRemaining int `json:"drawable_remaining"`
	ReserveRemaining  int `json:"reserve_remaining"`
}

// SeatClaimView intentionally exposes only the requesting seat's own response.
// The other players' response types and selected tile IDs stay private until
// resolution, preventing an unresolved interception from becoming a leak.
type SeatClaimView struct {
	ActionID     string         `json:"action_id"`
	StateVersion uint64         `json:"state_version"`
	Discard      Discard        `json:"discard"`
	Deadline     string         `json:"deadline"`
	Eligible     []Seat         `json:"eligible"`
	OwnResponse  *ClaimResponse `json:"own_response,omitempty"`
	// Options is the requesting seat's own legal claim responses (E8.F3:
	// "no legality computed client-side" — the browser must be told which
	// actions are legal, not infer them from its own hand). Absent
	// (zero-value) when the seat is not itself eligible for this window.
	Options ClaimOptionsView `json:"options"`
}

// ClaimOptionsView is one seat's legal responses to a pending discard, per
// the same legality the engine itself enforces in SubmitClaim.
type ClaimOptionsView struct {
	CanWin   bool        `json:"can_win,omitempty"`
	CanPong  bool        `json:"can_pong,omitempty"`
	CanKong  bool        `json:"can_kong,omitempty"`
	ChowSets [][2]string `json:"chow_sets,omitempty"`
	// WinPreview is the §9.4 "score preview before Win" assist: the same
	// ScoreResult SubmitClaim(ClaimWin) would produce for this seat, computed
	// with the identical context (DiscardWin, SingleWait) the real
	// resolution in resolveClaim uses. Only set when CanWin is true.
	WinPreview *ScoreResult `json:"win_preview,omitempty"`
}

// claimOptionsFor computes seat's legal responses to discard, reusing the
// same canPong/canKong/winValidator legality SubmitClaim itself checks —
// there is deliberately no separate/looser client-facing notion of
// legality here.
func (e *TurnEngine) claimOptionsFor(seat Seat, discard Discard) ClaimOptionsView {
	options := ClaimOptionsView{
		CanWin:  !e.winLocks[seat] && e.winValidator != nil && e.winValidator(e.Deal, seat, discard.Tile),
		CanPong: e.canPong(seat, discard.Tile, nil),
		CanKong: e.canKong(seat, discard.Tile, nil),
	}
	if options.CanWin {
		if player, err := e.player(seat); err == nil {
			context := ScoreContext{
				Seat:       seat,
				DiscardWin: true,
				SingleWait: e.singleWaitExcluding(player, ""),
			}
			if score, err := ScoreWinningDiscard(*player, discard.Tile, context); err == nil {
				options.WinPreview = &score
			}
		}
	}
	if discard.Tile.IsNumbered() && seat == nextSeat(discard.Seat) {
		player, err := e.player(seat)
		if err == nil {
			find := func(rank int) *Tile {
				if rank < 1 || rank > 9 {
					return nil
				}
				for index := range player.Hand {
					if player.Hand[index].Kind == discard.Tile.Kind && int(player.Hand[index].Rank) == rank {
						return &player.Hand[index]
					}
				}
				return nil
			}
			rank := int(discard.Tile.Rank)
			for _, pair := range [][2]int{{rank - 2, rank - 1}, {rank - 1, rank + 1}, {rank + 1, rank + 2}} {
				first, second := find(pair[0]), find(pair[1])
				if first != nil && second != nil {
					options.ChowSets = append(options.ChowSets, [2]string{first.ID, second.ID})
				}
			}
		}
	}
	return options
}

var ErrProjectionSeat = errors.New("projection seat is unknown")

func (e *TurnEngine) ProjectSeat(matchID string, seat Seat) (SeatView, error) {
	if e == nil || e.Deal == nil || e.Deal.Wall == nil {
		return SeatView{}, ErrTurnState
	}
	player, err := e.player(seat)
	if err != nil {
		return SeatView{}, fmt.Errorf("%w: %s", ErrProjectionSeat, seat)
	}
	view := SeatView{
		MatchID:      matchID,
		Seat:         seat,
		StateVersion: e.Version,
		Phase:        e.Phase,
		ActiveSeat:   e.ActiveSeat,
		OwnHand:      append([]Tile(nil), player.Hand...),
		OwnExposed:   append([]Tile(nil), player.Exposed...),
		Players:      make([]PlayerView, 0, len(e.Deal.Players)),
		Discards:     append([]Discard(nil), e.discards...),
		Wall: WallView{
			Remaining:         e.Deal.Wall.Remaining(),
			DrawableRemaining: e.Deal.Wall.DrawableRemaining(),
			ReserveRemaining:  e.Deal.Wall.ReserveRemaining(),
		},
		WinLocked: e.winLocks[seat],
		OwnMelds:  append([]Meld(nil), player.Melds...),
	}
	if waits, err := WaitingTiles(player.Hand, player.Melds); err == nil {
		for _, candidate := range waits {
			view.Waits = append(view.Waits, WaitTileView{
				Tile:             candidate,
				VisibleRemaining: e.visibleRemainingFor(candidate, player.Hand),
			})
		}
	}
	if e.TurnDeadline != nil {
		view.TurnDeadline = e.TurnDeadline.UTC().Format("2006-01-02T15:04:05.999999999Z07:00")
	}
	if e.Phase == PhaseHandComplete || e.Phase == PhaseExhaustiveDraw {
		view.HandResult = e.Result()
	}
	for _, candidate := range e.Deal.Players {
		owner := candidate.Seat == seat
		playerView := PlayerView{
			Seat:      candidate.Seat,
			HandCount: len(candidate.Hand),
			MeldCount: len(candidate.Melds),
			Exposed:   append([]Tile(nil), candidate.Exposed...),
			TakenOver: e.IsTakenOver(candidate.Seat),
			IsBot:     e.IsBotSeat(candidate.Seat),
		}
		if owner {
			// OwnExposed is the canonical copy; keep the per-player field public
			// for consumers that render all four boards from one array.
			playerView.Exposed = append([]Tile(nil), candidate.Exposed...)
		}
		for _, meld := range candidate.Melds {
			playerView.Melds = append(playerView.Melds, meldView(meld, owner))
		}
		view.Players = append(view.Players, playerView)
	}
	if e.LastDiscard != nil {
		discard := *e.LastDiscard
		view.LastDiscard = &discard
	}
	if e.Claim != nil {
		claim := e.Claim
		view.Claim = &SeatClaimView{
			ActionID:     claim.ActionID,
			StateVersion: claim.StateVersion,
			Discard:      claim.Discard,
			Deadline:     claim.Deadline.UTC().Format("2006-01-02T15:04:05.999999999Z07:00"),
			Eligible:     append([]Seat(nil), claim.Eligible...),
		}
		if response, ok := claim.Responses[seat]; ok {
			copy := response
			copy.TileIDs = append([]string(nil), response.TileIDs...)
			view.Claim.OwnResponse = &copy
		}
		if containsSeat(claim.Eligible, seat) {
			view.Claim.Options = e.claimOptionsFor(seat, claim.Discard)
		}
	}
	return view, nil
}

// visibleRemainingFor implements §9.4's Ting remaining-count formula: four
// copies minus copies visible to seat across its own hand, every public
// discard, every exposed meld at the table (concealed melds excluded — their
// tiles are not visible to opponents, and a seat's own concealed Kong
// already consumes all 4 copies of its type so it can never appear as a
// wait candidate to begin with), and every player's exposed bonus tiles.
func (e *TurnEngine) visibleRemainingFor(candidate Tile, ownHand []Tile) int {
	used := 0
	for _, tile := range ownHand {
		if sameTileType(tile, candidate) {
			used++
		}
	}
	for _, discard := range e.discards {
		if sameTileType(discard.Tile, candidate) {
			used++
		}
	}
	for _, player := range e.Deal.Players {
		for _, meld := range player.Melds {
			if meld.Concealed {
				continue
			}
			for _, tile := range meld.Tiles {
				if sameTileType(tile, candidate) {
					used++
				}
			}
		}
		for _, tile := range player.Exposed {
			if sameTileType(tile, candidate) {
				used++
			}
		}
	}
	remaining := 4 - used
	if remaining < 0 {
		return 0
	}
	return remaining
}

func (e *TurnEngine) ProjectAll(matchID string) (map[Seat]SeatView, error) {
	if e == nil {
		return nil, ErrTurnState
	}
	views := make(map[Seat]SeatView, len(seats))
	for _, seat := range seats {
		view, err := e.ProjectSeat(matchID, seat)
		if err != nil {
			return nil, err
		}
		views[seat] = view
	}
	return views, nil
}
