package rulesengine

import (
	"errors"
	"testing"
)

func TestEvaluateHandFindsCanonicalNormalWin(t *testing.T) {
	hand := []Tile{
		tile("characters-1-1", Characters, 1, 1), tile("characters-2-1", Characters, 2, 1), tile("characters-3-1", Characters, 3, 1),
		tile("characters-4-1", Characters, 4, 1), tile("characters-5-1", Characters, 5, 1), tile("characters-6-1", Characters, 6, 1),
		tile("characters-7-1", Characters, 7, 1), tile("characters-8-1", Characters, 8, 1), tile("characters-9-1", Characters, 9, 1),
		tile("bamboo-1-1", Bamboo, 1, 1), tile("bamboo-2-1", Bamboo, 2, 1), tile("bamboo-3-1", Bamboo, 3, 1),
		tile("bamboo-4-1", Bamboo, 4, 1), tile("bamboo-5-1", Bamboo, 5, 1), tile("bamboo-6-1", Bamboo, 6, 1),
		tile("dots-1-1", Dots, 1, 1), tile("dots-1-2", Dots, 1, 2),
	}
	evaluation, err := EvaluateHand(hand, nil)
	if err != nil {
		t.Fatalf("EvaluateHand() error = %v", err)
	}
	if !evaluation.Winning || len(evaluation.Decompositions) == 0 || evaluation.EffectiveTiles != 17 {
		t.Fatalf("evaluation = %#v", evaluation)
	}
	if len(evaluation.Decompositions[0].Melds) != 5 || len(evaluation.Decompositions[0].Pair) != 2 {
		t.Fatalf("canonical shape = %#v", evaluation.Decompositions[0])
	}
}

func TestWinningTilesReturnsUniquePhysicalRepresentatives(t *testing.T) {
	hand := []Tile{
		tile("characters-1-1", Characters, 1, 1), tile("characters-2-1", Characters, 2, 1), tile("characters-3-1", Characters, 3, 1),
		tile("characters-4-1", Characters, 4, 1), tile("characters-5-1", Characters, 5, 1), tile("characters-6-1", Characters, 6, 1),
		tile("characters-7-1", Characters, 7, 1), tile("characters-8-1", Characters, 8, 1), tile("characters-9-1", Characters, 9, 1),
		tile("bamboo-1-1", Bamboo, 1, 1), tile("bamboo-2-1", Bamboo, 2, 1), tile("bamboo-3-1", Bamboo, 3, 1),
		tile("bamboo-4-1", Bamboo, 4, 1), tile("bamboo-5-1", Bamboo, 5, 1), tile("bamboo-6-1", Bamboo, 6, 1),
		tile("dots-1-1", Dots, 1, 1),
	}
	waits, err := WinningTiles(hand, nil)
	if err != nil {
		t.Fatalf("WinningTiles() error = %v", err)
	}
	if len(waits) != 1 || waits[0].Kind != Dots || waits[0].Rank != 1 || waits[0].Copy != 2 {
		t.Fatalf("waits = %#v", waits)
	}
	alias, err := WaitingTiles(hand, nil)
	if err != nil {
		t.Fatalf("WaitingTiles() error = %v", err)
	}
	if len(alias) != 1 || alias[0].ID != waits[0].ID {
		t.Fatalf("WaitingTiles() = %#v, want %#v", alias, waits)
	}
}

func TestEvaluateHandSupportsExposedMelds(t *testing.T) {
	exposed := Meld{Type: MeldChow, Claimed: true, Tiles: []Tile{
		tile("characters-1-1", Characters, 1, 1), tile("characters-2-1", Characters, 2, 1), tile("characters-3-1", Characters, 3, 1),
	}}
	hand := []Tile{
		tile("characters-4-1", Characters, 4, 1), tile("characters-5-1", Characters, 5, 1), tile("characters-6-1", Characters, 6, 1),
		tile("characters-7-1", Characters, 7, 1), tile("characters-8-1", Characters, 8, 1), tile("characters-9-1", Characters, 9, 1),
		tile("bamboo-1-1", Bamboo, 1, 1), tile("bamboo-2-1", Bamboo, 2, 1), tile("bamboo-3-1", Bamboo, 3, 1),
		tile("bamboo-4-1", Bamboo, 4, 1), tile("bamboo-5-1", Bamboo, 5, 1), tile("bamboo-6-1", Bamboo, 6, 1),
		tile("dots-1-1", Dots, 1, 1), tile("dots-1-2", Dots, 1, 2),
	}
	evaluation, err := EvaluateHand(hand, []Meld{exposed})
	if err != nil {
		t.Fatalf("EvaluateHand() error = %v", err)
	}
	if !evaluation.Winning || len(evaluation.Decompositions) == 0 || len(evaluation.Decompositions[0].Melds) != 5 {
		t.Fatalf("evaluation = %#v", evaluation)
	}
}

func TestEvaluateHandRejectsFlowersAndDuplicatePhysicalTiles(t *testing.T) {
	if _, err := EvaluateHand([]Tile{tile("flower-spring", Flower, 0, 0)}, nil); !errors.Is(err, ErrInvalidHand) {
		t.Fatalf("Flower error = %v", err)
	}
	duplicate := []Tile{
		tile("characters-1-1", Characters, 1, 1), tile("characters-1-1", Characters, 1, 1),
	}
	if _, err := EvaluateHand(duplicate, nil); !errors.Is(err, ErrInvalidHand) {
		t.Fatalf("duplicate error = %v", err)
	}
}

func TestValidateMeld_PongAndKongRequireOneTileType(t *testing.T) {
	tests := []struct {
		name    string
		meld    Meld
		wantErr bool
	}{
		{
			name: "valid Pong",
			meld: Meld{Type: MeldPong, Tiles: []Tile{
				tile("dots-3-1", Dots, 3, 1),
				tile("dots-3-2", Dots, 3, 2),
				tile("dots-3-3", Dots, 3, 3),
			}},
		},
		{
			name: "valid Kong",
			meld: Meld{Type: MeldKong, Tiles: []Tile{
				tile("wind-east-1", Wind, 0, 1),
				tile("wind-east-2", Wind, 0, 2),
				tile("wind-east-3", Wind, 0, 3),
				tile("wind-east-4", Wind, 0, 4),
			}},
		},
		{
			name: "mixed Pong",
			meld: Meld{Type: MeldPong, Tiles: []Tile{
				tile("dots-3-1", Dots, 3, 1),
				tile("dots-3-2", Dots, 3, 2),
				tile("dots-4-1", Dots, 4, 1),
			}},
			wantErr: true,
		},
		{
			name: "mixed Kong",
			meld: Meld{Type: MeldKong, Tiles: []Tile{
				tile("wind-east-1", Wind, 0, 1),
				tile("wind-east-2", Wind, 0, 2),
				tile("wind-east-3", Wind, 0, 3),
				tile("wind-south-1", Wind, 0, 1),
			}},
			wantErr: true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateMeld(test.meld)
			if test.wantErr && !errors.Is(err, ErrInvalidMeld) {
				t.Fatalf("validateMeld() error = %v, want ErrInvalidMeld", err)
			}
			if !test.wantErr && err != nil {
				t.Fatalf("validateMeld() error = %v", err)
			}
		})
	}
}

func TestDefaultWinValidatorUsesRealStructure(t *testing.T) {
	state, err := Deal(777, [2]uint8{2, 4})
	if err != nil {
		t.Fatalf("Deal() error = %v", err)
	}
	state.Players[1].Hand = []Tile{
		tile("characters-1-1", Characters, 1, 1), tile("characters-2-1", Characters, 2, 1), tile("characters-3-1", Characters, 3, 1),
		tile("characters-4-1", Characters, 4, 1), tile("characters-5-1", Characters, 5, 1), tile("characters-6-1", Characters, 6, 1),
		tile("characters-7-1", Characters, 7, 1), tile("characters-8-1", Characters, 8, 1), tile("characters-9-1", Characters, 9, 1),
		tile("bamboo-1-1", Bamboo, 1, 1), tile("bamboo-2-1", Bamboo, 2, 1), tile("bamboo-3-1", Bamboo, 3, 1),
		tile("bamboo-4-1", Bamboo, 4, 1), tile("bamboo-5-1", Bamboo, 5, 1), tile("bamboo-6-1", Bamboo, 6, 1),
		tile("dots-1-1", Dots, 1, 1),
	}
	winning := tile("dots-1-2", Dots, 1, 2)
	if !DefaultWinValidator(state, South, winning) {
		t.Fatal("DefaultWinValidator rejected a structurally winning discard")
	}
	if DefaultWinValidator(state, South, tile("dots-9-1", Dots, 9, 1)) {
		t.Fatal("DefaultWinValidator accepted an invalid discard")
	}
	engine, err := NewTurnEngine(state, nil)
	if err != nil {
		t.Fatalf("NewTurnEngine() error = %v", err)
	}
	if engine.winValidator == nil || !engine.winValidator(state, South, winning) {
		t.Fatal("TurnEngine did not install the real default WinValidator")
	}
}
