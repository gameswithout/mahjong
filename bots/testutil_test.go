package bots

import (
	"testing"
	"time"

	"github.com/gameswithout/mahjong/rulesengine"
)

func tile(id string, kind rulesengine.TileKind, rank, copyNumber uint8) rulesengine.Tile {
	return rulesengine.Tile{ID: id, Kind: kind, Rank: rank, Copy: copyNumber}
}

func pongMeld(kind rulesengine.TileKind, rank uint8, concealed bool) rulesengine.Meld {
	name := string(kind)
	tiles := []rulesengine.Tile{
		tile(kindID(name, rank, 1), kind, rank, 1),
		tile(kindID(name, rank, 2), kind, rank, 2),
		tile(kindID(name, rank, 3), kind, rank, 3),
	}
	return rulesengine.Meld{Type: rulesengine.MeldPong, Tiles: tiles, Concealed: concealed, Claimed: !concealed}
}

func kindID(name string, rank, copyNumber uint8) string {
	return name + "-" + itoaTest(int(rank)) + "-" + itoaTest(int(copyNumber))
}

func itoaTest(n int) string {
	if n == 0 {
		return "0"
	}
	digits := [4]byte{}
	position := len(digits)
	for n > 0 {
		position--
		digits[position] = byte('0' + n%10)
		n /= 10
	}
	return string(digits[position:])
}

// dealFixture builds a deterministic DealState with an otherwise-shuffled
// wall, then overwrites all four hands so tests can set up specific
// scenarios without caring about the shuffle.
func dealFixture(t *testing.T) *rulesengine.DealState {
	t.Helper()
	state, err := rulesengine.Deal(20260719, [2]uint8{2, 3})
	if err != nil {
		t.Fatalf("Deal() error = %v", err)
	}
	for index := range state.Players {
		state.Players[index].Hand = nil
		state.Players[index].Exposed = nil
		state.Players[index].Melds = nil
	}
	return state
}

func turnEngineFixture(t *testing.T, state *rulesengine.DealState) *rulesengine.TurnEngine {
	t.Helper()
	clock := time.Date(2026, 7, 19, 3, 0, 0, 0, time.UTC)
	engine, err := rulesengine.NewTurnEngine(state, func() time.Time { return clock })
	if err != nil {
		t.Fatalf("NewTurnEngine() error = %v", err)
	}
	return engine
}
