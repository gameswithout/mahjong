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
	Players      []PlayerView   `json:"players"`
	Wall         WallView       `json:"wall"`
	LastDiscard  *Discard       `json:"last_discard,omitempty"`
	Claim        *SeatClaimView `json:"claim,omitempty"`
	WinLocked    bool           `json:"win_locked,omitempty"`
}

type PlayerView struct {
	Seat      Seat   `json:"seat"`
	HandCount int    `json:"hand_count"`
	Exposed   []Tile `json:"exposed,omitempty"`
	MeldCount int    `json:"meld_count,omitempty"`
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
		Wall: WallView{
			Remaining:         e.Deal.Wall.Remaining(),
			DrawableRemaining: e.Deal.Wall.DrawableRemaining(),
			ReserveRemaining:  e.Deal.Wall.ReserveRemaining(),
		},
		WinLocked: e.winLocks[seat],
	}
	for _, candidate := range e.Deal.Players {
		playerView := PlayerView{
			Seat:      candidate.Seat,
			HandCount: len(candidate.Hand),
			MeldCount: len(candidate.Melds),
			Exposed:   append([]Tile(nil), candidate.Exposed...),
		}
		if candidate.Seat == seat {
			// OwnExposed is the canonical copy; keep the per-player field public
			// for consumers that render all four boards from one array.
			playerView.Exposed = append([]Tile(nil), candidate.Exposed...)
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
	}
	return view, nil
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
