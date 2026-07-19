// Package bots implements the AI observation contract and decision policies
// from spec §11 (AI behavior and bot policy). It never imports anything that
// could expose hidden state: an Observation's fields are exhaustively public
// or own-seat information, so there is no field a builder bug could use to
// leak an opponent's concealed hand, the unrevealed wall order, or a future
// random draw (§11.2).
package bots

import (
	"errors"

	"github.com/gameswithout/mahjong/rulesengine"
)

// RulesVersion and AIVersion are recorded on every Decision so a replay can
// reproduce it exactly from (rules version, AI version, difficulty,
// observation, seed) per §11.4.
const (
	RulesVersion = "v1.2"
	AIVersion    = "v1.0.0"
)

// Difficulty selects a bot's decision policy (§11.3). Hard is defined by a
// later feature (E3.F3) and has no policy implementation here.
type Difficulty string

const (
	Easy   Difficulty = "easy"
	Medium Difficulty = "medium"
)

var (
	ErrIncompleteState = errors.New("bots: turn engine state is incomplete")
	ErrUnknownSeat     = errors.New("bots: seat is not seated in this match")
)

// OpponentView is the public information a bot may see about one other seat
// (§11.2): a hand-tile count, exposed melds, and exposed bonus tiles. There
// is deliberately no field capable of holding an opponent's concealed hand.
type OpponentView struct {
	Seat       rulesengine.Seat
	HandCount  int
	Melds      []rulesengine.Meld
	BonusTiles []rulesengine.Tile
}

// Observation is the complete legal information boundary for one bot seat
// (§11.2): that seat's own concealed hand and melds, its own exposed bonus
// tiles, the public discard pile, redacted views of the other three seats,
// table/dealer/continuation state, and the remaining drawable count. Nothing
// else — not an opponent's hand, not wall order, not a future random value —
// has a field to be represented in, so BuildObservation cannot leak them
// regardless of how it is implemented or later modified.
type Observation struct {
	Seat              rulesengine.Seat
	Dealer            rulesengine.Seat
	PrevailingWind    rulesengine.Seat
	Continuation      int
	Hand              []rulesengine.Tile
	Melds             []rulesengine.Meld
	BonusTiles        []rulesengine.Tile
	Discards          []rulesengine.Discard
	Opponents         []OpponentView
	DrawableRemaining int
	WinLocked         bool
}

// BuildObservation copies only the permitted fields for one seat out of the
// authoritative engine state. dealer and prevailingWind are supplied by the
// caller because the turn engine itself is agnostic to dealer/continuation
// bookkeeping (that lives in the match runtime, E2).
func BuildObservation(engine *rulesengine.TurnEngine, seat, dealer, prevailingWind rulesengine.Seat, continuation int) (Observation, error) {
	if engine == nil || engine.Deal == nil || engine.Deal.Wall == nil {
		return Observation{}, ErrIncompleteState
	}
	var own *rulesengine.PlayerState
	opponents := make([]OpponentView, 0, len(engine.Deal.Players)-1)
	for index := range engine.Deal.Players {
		player := &engine.Deal.Players[index]
		if player.Seat == seat {
			own = player
			continue
		}
		opponents = append(opponents, OpponentView{
			Seat:       player.Seat,
			HandCount:  len(player.Hand),
			Melds:      cloneMelds(player.Melds),
			BonusTiles: bonusTiles(player.Exposed),
		})
	}
	if own == nil {
		return Observation{}, ErrUnknownSeat
	}
	return Observation{
		Seat:              seat,
		Dealer:            dealer,
		PrevailingWind:    prevailingWind,
		Continuation:      continuation,
		Hand:              append([]rulesengine.Tile(nil), own.Hand...),
		Melds:             cloneMelds(own.Melds),
		BonusTiles:        bonusTiles(own.Exposed),
		Discards:          engine.DiscardPile(),
		Opponents:         opponents,
		DrawableRemaining: engine.Deal.Wall.DrawableRemaining(),
		WinLocked:         engine.IsWinLocked(seat),
	}, nil
}

func cloneMelds(melds []rulesengine.Meld) []rulesengine.Meld {
	cloned := make([]rulesengine.Meld, len(melds))
	for index, meld := range melds {
		cloned[index] = meld
		cloned[index].Tiles = append([]rulesengine.Tile(nil), meld.Tiles...)
	}
	return cloned
}

func bonusTiles(exposed []rulesengine.Tile) []rulesengine.Tile {
	bonus := make([]rulesengine.Tile, 0, len(exposed))
	for _, tile := range exposed {
		if tile.IsFlower() {
			bonus = append(bonus, tile)
		}
	}
	return bonus
}
