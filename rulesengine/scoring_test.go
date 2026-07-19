package rulesengine

import "testing"

func TestScoreGoldenCases(t *testing.T) {
	tests := []struct {
		name      string
		player    PlayerState
		context   ScoreContext
		wantTai   int
		wantNames []string
	}{
		{
			name:      "all chows discard win",
			player:    PlayerState{Seat: East, Hand: simpleChowHand()},
			context:   ScoreContext{Seat: East, DiscardWin: true},
			wantTai:   4,
			wantNames: []string{"Base Win", "Concealed", "All Chows"},
		},
		{
			name:      "concealed all pongs with east wind",
			player:    PlayerState{Seat: East, Hand: allPongHand()},
			context:   ScoreContext{Seat: East, PrevailingWind: East, Zimo: true},
			wantTai:   19,
			wantNames: []string{"Base Win", "Concealed Zimo", "Five Concealed Pongs", "All Pongs", "Seat Wind Set", "Prevailing Wind Set", "Red Dragon Set"},
		},
		{
			name: "eight flowers",
			player: PlayerState{Seat: East, Exposed: []Tile{
				tile("flower-spring", Flower, 0, 0), tile("flower-summer", Flower, 0, 0),
				tile("flower-autumn", Flower, 0, 0), tile("flower-winter", Flower, 0, 0),
				tile("flower-plum", Flower, 0, 0), tile("flower-orchid", Flower, 0, 0),
				tile("flower-chrysanthemum", Flower, 0, 0), tile("flower-bamboo", Flower, 0, 0),
			}},
			context:   ScoreContext{Seat: East, EightFlowers: true},
			wantTai:   15,
			wantNames: []string{"Base Win", "Eight Flowers", "Matching Flower", "Complete Seasons", "Complete Flowers"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result, err := ScoreHand(test.player, test.context)
			if err != nil {
				t.Fatalf("ScoreHand() error = %v", err)
			}
			if !result.Winning || result.RawTai != test.wantTai {
				t.Fatalf("result = %#v, want winning/%d", result, test.wantTai)
			}
			for _, name := range test.wantNames {
				if !hasPattern(result.Patterns, name) {
					t.Fatalf("patterns = %#v, missing %q", result.Patterns, name)
				}
			}
		})
	}
}

func TestScoreChoosesHighestTaiDecompositionDeterministically(t *testing.T) {
	player := PlayerState{Seat: East, Hand: []Tile{
		tile("characters-1-1", Characters, 1, 1), tile("characters-1-2", Characters, 1, 2), tile("characters-1-3", Characters, 1, 3),
		tile("characters-2-1", Characters, 2, 1), tile("characters-2-2", Characters, 2, 2), tile("characters-2-3", Characters, 2, 3),
		tile("characters-3-1", Characters, 3, 1), tile("characters-3-2", Characters, 3, 2), tile("characters-3-3", Characters, 3, 3),
		tile("characters-4-1", Characters, 4, 1), tile("characters-5-1", Characters, 5, 1), tile("characters-6-1", Characters, 6, 1),
		tile("characters-7-1", Characters, 7, 1), tile("characters-8-1", Characters, 8, 1), tile("characters-9-1", Characters, 9, 1),
		tile("characters-9-2", Characters, 9, 2), tile("characters-9-3", Characters, 9, 3),
	}}
	first, err := ScoreHand(player, ScoreContext{Seat: East, DiscardWin: true})
	if err != nil {
		t.Fatalf("first ScoreHand() error = %v", err)
	}
	second, err := ScoreHand(player, ScoreContext{Seat: East, DiscardWin: true})
	if err != nil {
		t.Fatalf("second ScoreHand() error = %v", err)
	}
	if first.RawTai != second.RawTai || shapeKey(first.Shape) != shapeKey(second.Shape) {
		t.Fatalf("non-deterministic score: %#v vs %#v", first, second)
	}
}

func TestScoreContextEventsAndSingleWait(t *testing.T) {
	hand := simpleChowHand()
	result, err := ScoreHand(PlayerState{Seat: South, Hand: hand}, ScoreContext{
		Seat:        South,
		DiscardWin:  true,
		LastTile:    true,
		Replacement: true,
		SingleWait:  true,
	})
	if err != nil {
		t.Fatalf("ScoreHand() error = %v", err)
	}
	if !hasPattern(result.Patterns, "Single Wait") || !hasPattern(result.Patterns, "Last Tile Zimo") || !hasPattern(result.Patterns, "Win After Replacement") {
		t.Fatalf("event patterns = %#v", result.Patterns)
	}
}

func TestScoreWinningDiscard_AppendsWithoutMutatingCallerHand(t *testing.T) {
	winning := simpleChowHand()
	player := PlayerState{
		Seat: East,
		Hand: append([]Tile(nil), winning[:len(winning)-1]...),
	}
	originalLength := len(player.Hand)
	result, err := ScoreWinningDiscard(
		player,
		winning[len(winning)-1],
		ScoreContext{Seat: East},
	)
	if err != nil {
		t.Fatalf("ScoreWinningDiscard() error = %v", err)
	}
	if !result.Winning || !hasPattern(result.Patterns, "All Chows") {
		t.Fatalf("result = %#v, want winning All Chows", result)
	}
	if len(player.Hand) != originalLength {
		t.Fatalf("caller hand length = %d, want %d", len(player.Hand), originalLength)
	}
}

func simpleChowHand() []Tile {
	return []Tile{
		tile("characters-1-1", Characters, 1, 1), tile("characters-2-1", Characters, 2, 1), tile("characters-3-1", Characters, 3, 1),
		tile("characters-4-1", Characters, 4, 1), tile("characters-5-1", Characters, 5, 1), tile("characters-6-1", Characters, 6, 1),
		tile("characters-7-1", Characters, 7, 1), tile("characters-8-1", Characters, 8, 1), tile("characters-9-1", Characters, 9, 1),
		tile("bamboo-1-1", Bamboo, 1, 1), tile("bamboo-2-1", Bamboo, 2, 1), tile("bamboo-3-1", Bamboo, 3, 1),
		tile("bamboo-4-1", Bamboo, 4, 1), tile("bamboo-5-1", Bamboo, 5, 1), tile("bamboo-6-1", Bamboo, 6, 1),
		tile("dots-1-1", Dots, 1, 1), tile("dots-1-2", Dots, 1, 2),
	}
}

func allPongHand() []Tile {
	return []Tile{
		tile("characters-1-1", Characters, 1, 1), tile("characters-1-2", Characters, 1, 2), tile("characters-1-3", Characters, 1, 3),
		tile("bamboo-1-1", Bamboo, 1, 1), tile("bamboo-1-2", Bamboo, 1, 2), tile("bamboo-1-3", Bamboo, 1, 3),
		tile("dots-1-1", Dots, 1, 1), tile("dots-1-2", Dots, 1, 2), tile("dots-1-3", Dots, 1, 3),
		tile("wind-east-1", Wind, 0, 1), tile("wind-east-2", Wind, 0, 2), tile("wind-east-3", Wind, 0, 3),
		tile("dragon-red-1", Dragon, 0, 1), tile("dragon-red-2", Dragon, 0, 2), tile("dragon-red-3", Dragon, 0, 3),
		tile("dragon-green-1", Dragon, 0, 1), tile("dragon-green-2", Dragon, 0, 2),
	}
}

func hasPattern(patterns []PatternScore, name string) bool {
	for _, pattern := range patterns {
		if pattern.Name == name {
			return true
		}
	}
	return false
}
