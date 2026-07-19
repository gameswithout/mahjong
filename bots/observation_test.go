package bots

import (
	"testing"

	"github.com/gameswithout/mahjong/rulesengine"
)

func TestBuildObservationRedactsOpponentHands(t *testing.T) {
	state := dealFixture(t)
	state.Players[0].Hand = []rulesengine.Tile{ // East (self)
		tile("characters-1-1", rulesengine.Characters, 1, 1),
		tile("characters-2-1", rulesengine.Characters, 2, 1),
	}
	state.Players[1].Hand = []rulesengine.Tile{ // South (opponent)
		tile("dots-9-1", rulesengine.Dots, 9, 1),
		tile("dots-9-2", rulesengine.Dots, 9, 2),
		tile("dots-9-3", rulesengine.Dots, 9, 3),
	}
	state.Players[1].Melds = []rulesengine.Meld{pongMeld(rulesengine.Bamboo, 5, false)}
	state.Players[1].Exposed = []rulesengine.Tile{
		tile("flower-spring", rulesengine.Flower, 0, 0),
		tile("bamboo-5-1", rulesengine.Bamboo, 5, 1),
	}
	engine := turnEngineFixture(t, state)

	obs, err := BuildObservation(engine, rulesengine.East, rulesengine.East, rulesengine.East, 2)
	if err != nil {
		t.Fatalf("BuildObservation() error = %v", err)
	}
	if len(obs.Hand) != 2 || obs.Hand[0].ID != "characters-1-1" {
		t.Fatalf("own hand = %#v, want East's two tiles", obs.Hand)
	}
	if obs.Dealer != rulesengine.East || obs.PrevailingWind != rulesengine.East || obs.Continuation != 2 {
		t.Fatalf("table state = dealer %s wind %s k %d", obs.Dealer, obs.PrevailingWind, obs.Continuation)
	}

	var south *OpponentView
	for index := range obs.Opponents {
		if obs.Opponents[index].Seat == rulesengine.South {
			south = &obs.Opponents[index]
		}
	}
	if south == nil {
		t.Fatal("South is missing from Opponents")
	}
	if south.HandCount != 3 {
		t.Fatalf("South hand count = %d, want 3", south.HandCount)
	}
	if len(south.Melds) != 1 || south.Melds[0].Type != rulesengine.MeldPong {
		t.Fatalf("South melds = %#v", south.Melds)
	}
	if len(south.BonusTiles) != 1 || south.BonusTiles[0].ID != "flower-spring" {
		t.Fatalf("South bonus tiles = %#v, want only the Flower", south.BonusTiles)
	}
	// The structural guarantee under test: nothing in OpponentView can hold
	// South's concealed hand tiles (dots-9-1/2/3). Grep every string field
	// reachable from the opponent view for those IDs as a belt-and-braces
	// runtime check on top of the type-level guarantee.
	for _, meld := range south.Melds {
		for _, item := range meld.Tiles {
			if item.Kind == rulesengine.Dots && item.Rank == 9 {
				t.Fatalf("South's concealed hand leaked into Melds: %#v", item)
			}
		}
	}
	for _, item := range south.BonusTiles {
		if item.Kind == rulesengine.Dots && item.Rank == 9 {
			t.Fatalf("South's concealed hand leaked into BonusTiles: %#v", item)
		}
	}
}

func TestBuildObservationUnknownSeat(t *testing.T) {
	state := dealFixture(t)
	engine := turnEngineFixture(t, state)
	if _, err := BuildObservation(engine, rulesengine.Seat("X"), rulesengine.East, rulesengine.East, 0); err != ErrUnknownSeat {
		t.Fatalf("error = %v, want ErrUnknownSeat", err)
	}
}

func TestBuildObservationIncompleteState(t *testing.T) {
	if _, err := BuildObservation(nil, rulesengine.East, rulesengine.East, rulesengine.East, 0); err != ErrIncompleteState {
		t.Fatalf("error = %v, want ErrIncompleteState", err)
	}
}
