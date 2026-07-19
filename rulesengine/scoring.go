package rulesengine

import (
	"sort"
	"strings"
)

type ScoreContext struct {
	Seat            Seat `json:"seat,omitempty"`
	PrevailingWind  Seat `json:"prevailing_wind,omitempty"`
	DiscardWin      bool `json:"discard_win,omitempty"`
	Zimo            bool `json:"zimo,omitempty"`
	Replacement     bool `json:"replacement,omitempty"`
	LastTile        bool `json:"last_tile,omitempty"`
	RobbedAddedKong bool `json:"robbed_added_kong,omitempty"`
	EightFlowers    bool `json:"eight_flowers,omitempty"`
	EarthlyHand     bool `json:"earthly_hand,omitempty"`
	HeavenlyHand    bool `json:"heavenly_hand,omitempty"`
	SingleWait      bool `json:"single_wait,omitempty"`
}

type PatternScore struct {
	Name string `json:"name"`
	Tai  int    `json:"tai"`
}

type ScoreResult struct {
	Winning        bool           `json:"winning"`
	RawTai         int            `json:"raw_tai"`
	Patterns       []PatternScore `json:"patterns"`
	Shape          HandShape      `json:"shape"`
	EffectiveTiles int            `json:"effective_tiles"`
}

type scoredShape struct {
	result ScoreResult
	key    string
}

// ScoreHand evaluates a completed player hand and selects the highest-Tai
// legal decomposition. Ties use the evaluator's canonical decomposition key.
func ScoreHand(player PlayerState, context ScoreContext) (ScoreResult, error) {
	if context.Seat == "" {
		context.Seat = player.Seat
	}
	if context.PrevailingWind == "" {
		context.PrevailingWind = East
	}
	flowers := bonusTiles(player.Exposed)
	if context.EightFlowers || len(flowers) == 8 {
		return scoreEightFlowers(player, context, flowers), nil
	}
	evaluation, err := EvaluatePlayer(player)
	if err != nil {
		return ScoreResult{}, err
	}
	if !evaluation.Winning {
		return ScoreResult{Winning: false, EffectiveTiles: evaluation.EffectiveTiles}, nil
	}

	choices := make([]scoredShape, 0, len(evaluation.Decompositions))
	for _, shape := range evaluation.Decompositions {
		patterns := scoreShape(player, shape, context, flowers)
		choices = append(choices, scoredShape{
			result: ScoreResult{
				Winning:        true,
				RawTai:         patternTotal(patterns),
				Patterns:       patterns,
				Shape:          shape,
				EffectiveTiles: evaluation.EffectiveTiles,
			},
			key: shapeKey(shape),
		})
	}
	sort.SliceStable(choices, func(i, j int) bool {
		if choices[i].result.RawTai != choices[j].result.RawTai {
			return choices[i].result.RawTai > choices[j].result.RawTai
		}
		return choices[i].key < choices[j].key
	})
	return choices[0].result, nil
}

func ScoreWinningDiscard(player PlayerState, tile Tile, context ScoreContext) (ScoreResult, error) {
	context.DiscardWin = true
	player.Hand = append(append([]Tile(nil), player.Hand...), tile)
	return ScoreHand(player, context)
}

func scoreEightFlowers(player PlayerState, context ScoreContext, flowers []Tile) ScoreResult {
	if len(flowers) != 8 {
		return ScoreResult{Winning: false}
	}
	patterns := []PatternScore{
		{Name: "Base Win", Tai: 1},
		{Name: "Eight Flowers", Tai: 8},
		{Name: "Matching Flower", Tai: 2},
		{Name: "Complete Seasons", Tai: 2},
		{Name: "Complete Flowers", Tai: 2},
	}
	return ScoreResult{
		Winning:  len(flowers) == 8,
		RawTai:   patternTotal(patterns),
		Patterns: patterns,
		Shape:    HandShape{},
	}
}

func scoreShape(player PlayerState, shape HandShape, context ScoreContext, flowers []Tile) []PatternScore {
	patterns := []PatternScore{{Name: "Base Win", Tai: 1}}
	allTiles := make([]Tile, 0, len(player.Hand)+len(flowers))
	allTiles = append(allTiles, player.Hand...)
	for _, meld := range shape.Melds {
		for _, tile := range meld.Tiles {
			allTiles = append(allTiles, tile)
		}
	}
	openMelds := 0
	concealedPongs := 0
	exposedKongs := 0
	concealedKongs := 0
	for _, meld := range shape.Melds {
		if !meld.Concealed {
			openMelds++
		}
		if meld.Concealed && (meld.Type == MeldPong || meld.Type == MeldKong) {
			concealedPongs++
		}
		if meld.Type == MeldKong {
			if meld.Concealed {
				concealedKongs++
			} else if meld.Added || meld.Claimed {
				exposedKongs++
			}
		}
	}
	concealedHand := openMelds == 0
	allChows := allMeldsAre(shape, MeldChow) && shape.Pair[0].IsNumbered() &&
		len(flowers) == 0 && context.DiscardWin && !context.SingleWait
	allPongs := allMeldsAre(shape, MeldPong, MeldKong)

	if context.HeavenlyHand {
		patterns = append(patterns, PatternScore{Name: "Heavenly Hand", Tai: 24})
	} else if context.EarthlyHand {
		patterns = append(patterns, PatternScore{Name: "Earthly Hand", Tai: 16})
	}
	// Heavenly Hand excludes Zimo/Concealed Zimo but may stack with Concealed
	// (§6.2), so a Heavenly hand falls through to the Concealed branch.
	zimo := context.Zimo && !context.HeavenlyHand
	if zimo && concealedHand {
		patterns = append(patterns, PatternScore{Name: "Concealed Zimo", Tai: 3})
	} else if zimo {
		patterns = append(patterns, PatternScore{Name: "Zimo", Tai: 1})
	} else if concealedHand {
		patterns = append(patterns, PatternScore{Name: "Concealed", Tai: 1})
	}

	// A hand with five open melds always wins on the pair, so Fully Exposed
	// suppresses Single Wait rather than requiring its absence (§6.1).
	fullyExposed := context.DiscardWin && openMelds == len(shape.Melds) && len(shape.Melds) == 5
	if !allChows {
		if context.SingleWait && !context.HeavenlyHand && !fullyExposed {
			patterns = append(patterns, PatternScore{Name: "Single Wait", Tai: 1})
		}
		if concealedPongs >= 5 {
			patterns = append(patterns, PatternScore{Name: "Five Concealed Pongs", Tai: 8})
		} else if concealedPongs >= 4 {
			patterns = append(patterns, PatternScore{Name: "Four Concealed Pongs", Tai: 5})
		} else if concealedPongs >= 3 {
			patterns = append(patterns, PatternScore{Name: "Three Concealed Pongs", Tai: 2})
		}
	}
	if allChows {
		patterns = append(patterns, PatternScore{Name: "All Chows", Tai: 2})
	} else if allPongs {
		patterns = append(patterns, PatternScore{Name: "All Pongs", Tai: 4})
	}
	if fullyExposed {
		patterns = append(patterns, PatternScore{Name: "Fully Exposed", Tai: 2})
	}
	if !allChows {
		patterns = append(patterns, scoreKongPatterns(exposedKongs, concealedKongs)...)
	}

	patterns = append(patterns, scoreSetPatterns(shape, context.PrevailingWind, context.Seat)...)
	patterns = append(patterns, scoreSuitPatterns(allTiles, flowers)...)
	patterns = append(patterns, scoreFlowerPatterns(flowers, context.Seat)...)

	if !allChows && len(flowers) == 0 && noHonors(allTiles) {
		patterns = append(patterns, PatternScore{Name: "No Honors or Flowers", Tai: 2})
	}
	if !context.HeavenlyHand {
		if context.Replacement {
			patterns = append(patterns, PatternScore{Name: "Win After Replacement", Tai: 1})
		}
		if context.LastTile {
			patterns = append(patterns, PatternScore{Name: "Last Tile Zimo", Tai: 1})
		}
		if context.RobbedAddedKong {
			patterns = append(patterns, PatternScore{Name: "Robbing an Added Kong", Tai: 1})
		}
	}
	return patterns
}

func scoreKongPatterns(exposed, concealed int) []PatternScore {
	patterns := make([]PatternScore, 0, exposed+concealed)
	if exposed > 0 {
		patterns = append(patterns, PatternScore{Name: "Exposed/Added Kong", Tai: exposed})
	}
	if concealed > 0 {
		patterns = append(patterns, PatternScore{Name: "Concealed Kong", Tai: concealed * 2})
	}
	return patterns
}

func scoreSetPatterns(shape HandShape, prevailing, seat Seat) []PatternScore {
	patterns := make([]PatternScore, 0)
	dragonSets := map[string]bool{}
	windSets := map[string]bool{}
	for _, meld := range shape.Melds {
		if meld.Type != MeldPong && meld.Type != MeldKong {
			continue
		}
		tile := meld.Tiles[0]
		base := tileBaseID(tile.ID)
		if tile.Kind == Dragon {
			dragonSets[base] = true
			patterns = append(patterns, PatternScore{Name: fmtDragonSetName(base), Tai: 1})
		}
		if tile.Kind == Wind {
			windSets[base] = true
			if base == "wind-"+strings.ToLower(string(seatName(seat))) {
				patterns = append(patterns, PatternScore{Name: "Seat Wind Set", Tai: 1})
			}
			if base == "wind-"+strings.ToLower(string(seatName(prevailing))) {
				patterns = append(patterns, PatternScore{Name: "Prevailing Wind Set", Tai: 1})
			}
		}
	}
	if len(dragonSets) == 3 {
		patterns = append(patterns, PatternScore{Name: "Big Three Dragons", Tai: 8})
	} else if len(dragonSets) == 2 && pairHasKind(shape.Pair, Dragon) {
		patterns = append(patterns, PatternScore{Name: "Small Three Dragons", Tai: 4})
	}
	if len(windSets) == 4 {
		patterns = append(patterns, PatternScore{Name: "Big Four Winds", Tai: 16})
	} else if len(windSets) == 3 && pairHasKind(shape.Pair, Wind) {
		patterns = append(patterns, PatternScore{Name: "Small Four Winds", Tai: 8})
	}
	return patterns
}

func scoreSuitPatterns(tiles, flowers []Tile) []PatternScore {
	kinds := map[TileKind]bool{}
	honors := false
	for _, tile := range tiles {
		if tile.IsNumbered() {
			kinds[tile.Kind] = true
		} else {
			honors = true
		}
	}
	patterns := make([]PatternScore, 0, 2)
	switch {
	case len(kinds) == 0 && honors:
		patterns = append(patterns, PatternScore{Name: "All Honors", Tai: 8})
	case len(kinds) == 1 && honors:
		patterns = append(patterns, PatternScore{Name: "Half Flush", Tai: 4})
	case len(kinds) == 1 && !honors:
		patterns = append(patterns, PatternScore{Name: "Full Flush", Tai: 8})
	}
	return patterns
}

func scoreFlowerPatterns(flowers []Tile, seat Seat) []PatternScore {
	if len(flowers) == 0 {
		return nil
	}
	patterns := make([]PatternScore, 0, 4)
	seasons, plants := map[string]bool{}, map[string]bool{}
	for _, tile := range flowers {
		// Flower IDs are single-copy ("flower-spring") and carry no copy
		// suffix, so the full ID is already the type identity.
		base := tile.ID
		if strings.HasPrefix(base, "flower-") {
			name := strings.TrimPrefix(base, "flower-")
			switch name {
			case "spring", "summer", "autumn", "winter":
				seasons[name] = true
			default:
				plants[name] = true
			}
		}
	}
	for _, name := range matchingFlowerNames(seat) {
		if seasons[name] || plants[name] {
			patterns = append(patterns, PatternScore{Name: "Matching Flower", Tai: 1})
		}
	}
	if len(seasons) == 4 {
		patterns = append(patterns, PatternScore{Name: "Complete Seasons", Tai: 2})
	}
	if len(plants) == 4 {
		patterns = append(patterns, PatternScore{Name: "Complete Flowers", Tai: 2})
	}
	return patterns
}

func bonusTiles(exposed []Tile) []Tile {
	flowers := make([]Tile, 0)
	for _, tile := range exposed {
		if tile.IsFlower() {
			flowers = append(flowers, tile)
		}
	}
	return flowers
}

func matchingFlowerNames(seat Seat) []string {
	switch seat {
	case East:
		return []string{"spring", "plum"}
	case South:
		return []string{"summer", "orchid"}
	case West:
		return []string{"autumn", "chrysanthemum"}
	case North:
		return []string{"winter", "bamboo"}
	default:
		return nil
	}
}

func seatName(seat Seat) Seat {
	switch seat {
	case East:
		return "east"
	case South:
		return "south"
	case West:
		return "west"
	case North:
		return "north"
	default:
		return ""
	}
}

func fmtDragonSetName(base string) string {
	if strings.HasPrefix(base, "dragon-") {
		name := strings.TrimPrefix(base, "dragon-")
		return strings.ToUpper(name[:1]) + name[1:] + " Dragon Set"
	}
	return "Dragon Set"
}

func pairHasKind(pair []Tile, kind TileKind) bool {
	return len(pair) == 2 && pair[0].Kind == kind && sameTileType(pair[0], pair[1])
}

func allMeldsAre(shape HandShape, kinds ...MeldType) bool {
	if len(shape.Melds) != 5 {
		return false
	}
	allowed := map[MeldType]bool{}
	for _, kind := range kinds {
		allowed[kind] = true
	}
	for _, meld := range shape.Melds {
		if !allowed[meld.Type] {
			return false
		}
	}
	return true
}

func noHonors(tiles []Tile) bool {
	for _, tile := range tiles {
		if tile.Kind == Wind || tile.Kind == Dragon || tile.IsFlower() {
			return false
		}
	}
	return true
}

func patternTotal(patterns []PatternScore) int {
	total := 0
	for _, pattern := range patterns {
		total += pattern.Tai
	}
	return total
}
