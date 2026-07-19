package rulesengine

import (
	"errors"
	"fmt"
	"sort"
	"strings"
)

type MeldType string

const (
	MeldChow MeldType = "chow"
	MeldPong MeldType = "pong"
	MeldKong MeldType = "kong"
)

type Meld struct {
	Type      MeldType `json:"type"`
	Tiles     []Tile   `json:"tiles"`
	Concealed bool     `json:"concealed,omitempty"`
	Added     bool     `json:"added,omitempty"`
	Claimed   bool     `json:"claimed,omitempty"`
}

type HandShape struct {
	Pair  []Tile `json:"pair"`
	Melds []Meld `json:"melds"`
}

type HandEvaluation struct {
	Winning        bool        `json:"winning"`
	EffectiveTiles int         `json:"effective_tiles"`
	Decompositions []HandShape `json:"decompositions,omitempty"`
}

var (
	ErrInvalidHand = errors.New("invalid hand")
	ErrInvalidMeld = errors.New("invalid meld")
)

// EvaluateHand checks the Taiwanese v1.1 normal structure: five melds and a
// pair, with exposed melds supplied separately from the concealed hand. Bonus
// tiles are never legal in the concealed hand and belong in PlayerState.Exposed
// or a future bonus-specific field.
func EvaluateHand(hand []Tile, melds []Meld) (HandEvaluation, error) {
	if len(melds) > 5 {
		return HandEvaluation{}, ErrInvalidHand
	}
	_, err := validateHandBasics(hand, melds)
	if err != nil {
		return HandEvaluation{}, err
	}
	validatedMelds := make([]Meld, 0, len(melds))
	for _, meld := range melds {
		validatedMelds = append(validatedMelds, cloneMeld(meld))
	}

	requiredMelds := 5 - len(validatedMelds)
	if requiredMelds < 0 || len(hand) != requiredMelds*3+2 {
		return HandEvaluation{}, ErrInvalidHand
	}
	concealed := append([]Tile(nil), hand...)
	sortTiles(concealed)
	shapes := make([]HandShape, 0)
	seenShapes := map[string]struct{}{}
	solveHand(concealed, nil, validatedMelds, requiredMelds, &shapes, seenShapes)
	sort.Slice(shapes, func(i, j int) bool {
		return shapeKey(shapes[i]) < shapeKey(shapes[j])
	})
	return HandEvaluation{
		Winning:        len(shapes) > 0,
		EffectiveTiles: len(hand) + len(validatedMelds)*3,
		Decompositions: shapes,
	}, nil
}

func EvaluatePlayer(player PlayerState) (HandEvaluation, error) {
	return EvaluateHand(player.Hand, player.Melds)
}

// WinningTiles returns one canonical representative per tile type that would
// complete the supplied hand. Physical copies are still enforced: a fifth
// copy of the same tile type is not returned.
func WinningTiles(hand []Tile, melds []Meld) ([]Tile, error) {
	if _, err := validateHandBasics(hand, melds); err != nil {
		return nil, err
	}
	counts := tileTypeCounts(hand, melds)
	usedIDs := map[string]struct{}{}
	for _, tile := range hand {
		usedIDs[tile.ID] = struct{}{}
	}
	for _, meld := range melds {
		for _, tile := range meld.Tiles {
			usedIDs[tile.ID] = struct{}{}
		}
	}
	candidates := catalogRepresentatives()
	waits := make([]Tile, 0)
	for _, candidate := range candidates {
		if counts[tileTypeKey(candidate)] >= 4 {
			continue
		}
		for _, physical := range Catalog() {
			if sameTileType(physical, candidate) {
				if _, used := usedIDs[physical.ID]; !used {
					candidate = physical
					break
				}
			}
		}
		trial := append(append([]Tile(nil), hand...), candidate)
		evaluation, err := EvaluateHand(trial, melds)
		if err != nil {
			return nil, err
		}
		if evaluation.Winning {
			waits = append(waits, candidate)
		}
	}
	sort.Slice(waits, func(i, j int) bool { return tileTypeKey(waits[i]) < tileTypeKey(waits[j]) })
	return waits, nil
}

func WaitingTiles(hand []Tile, melds []Meld) ([]Tile, error) {
	return WinningTiles(hand, melds)
}

func validateHandBasics(hand []Tile, melds []Meld) (map[string]struct{}, error) {
	seen := map[string]struct{}{}
	for _, tile := range hand {
		if tile.ID == "" || tile.IsFlower() {
			return nil, ErrInvalidHand
		}
		if _, exists := seen[tile.ID]; exists {
			return nil, ErrInvalidHand
		}
		seen[tile.ID] = struct{}{}
	}
	for _, meld := range melds {
		if err := validateMeld(meld); err != nil {
			return nil, err
		}
		for _, tile := range meld.Tiles {
			if _, exists := seen[tile.ID]; exists {
				return nil, ErrInvalidHand
			}
			seen[tile.ID] = struct{}{}
		}
	}
	return seen, nil
}

func CanWin(hand []Tile, melds []Meld) bool {
	evaluation, err := EvaluateHand(hand, melds)
	return err == nil && evaluation.Winning
}

// DefaultWinValidator is the production validator used by TurnEngine. A
// discard completes the claimant's concealed hand; structural legality is
// decided here rather than by the browser.
func DefaultWinValidator(state *DealState, seat Seat, discard Tile) bool {
	if state == nil {
		return false
	}
	for _, player := range state.Players {
		if player.Seat != seat {
			continue
		}
		hand := append(append([]Tile(nil), player.Hand...), discard)
		return CanWin(hand, player.Melds)
	}
	return false
}

func solveHand(tiles []Tile, pair []Tile, fixedMelds []Meld, requiredMelds int, shapes *[]HandShape, seen map[string]struct{}) {
	if len(*shapes) > 256 || len(fixedMelds) > 5 {
		return
	}
	if len(tiles) == 0 {
		if pair == nil || len(fixedMelds) != 5 {
			return
		}
		shape := HandShape{Pair: append([]Tile(nil), pair...), Melds: cloneMelds(fixedMelds)}
		key := shapeKey(shape)
		if _, exists := seen[key]; !exists {
			seen[key] = struct{}{}
			*shapes = append(*shapes, shape)
		}
		return
	}
	if len(fixedMelds) > 5 || len(fixedMelds)-requiredMelds > 5 {
		return
	}
	first := tiles[0]
	count := countTileType(tiles, first)
	if pair == nil && count >= 2 {
		taken, rest := takeTileType(tiles, first, 2)
		solveHand(rest, taken, fixedMelds, requiredMelds, shapes, seen)
	}
	if count >= 3 && len(fixedMelds) < 5 {
		taken, rest := takeTileType(tiles, first, 3)
		melds := append(cloneMelds(fixedMelds), Meld{Type: MeldPong, Tiles: taken, Concealed: true})
		solveHand(rest, pair, melds, requiredMelds, shapes, seen)
	}
	if first.IsNumbered() && first.Rank <= 7 && len(fixedMelds) < 5 {
		second := tileWithType(tiles, first.Kind, first.Rank+1)
		third := tileWithType(tiles, first.Kind, first.Rank+2)
		if second != nil && third != nil {
			remaining := removeTileIDsFrom(tiles, []string{first.ID, second.ID, third.ID})
			melds := append(cloneMelds(fixedMelds), Meld{Type: MeldChow, Tiles: []Tile{first, *second, *third}, Concealed: true})
			solveHand(remaining, pair, melds, requiredMelds, shapes, seen)
		}
	}
}

func validateMeld(meld Meld) error {
	if len(meld.Tiles) == 0 || (meld.Type != MeldChow && meld.Type != MeldPong && meld.Type != MeldKong) {
		return ErrInvalidMeld
	}
	seen := map[string]struct{}{}
	for _, tile := range meld.Tiles {
		if tile.ID == "" || tile.IsFlower() {
			return ErrInvalidMeld
		}
		if _, exists := seen[tile.ID]; exists {
			return ErrInvalidMeld
		}
		seen[tile.ID] = struct{}{}
	}
	switch meld.Type {
	case MeldPong:
		if len(meld.Tiles) != 3 || !allSameType(meld.Tiles) {
			return ErrInvalidMeld
		}
	case MeldKong:
		if len(meld.Tiles) != 4 || !allSameType(meld.Tiles) {
			return ErrInvalidMeld
		}
	case MeldChow:
		if len(meld.Tiles) != 3 || !validChow(meld.Tiles) {
			return ErrInvalidMeld
		}
	}
	return nil
}

func validChow(tiles []Tile) bool {
	if len(tiles) != 3 || !tiles[0].IsNumbered() || tiles[0].Kind != tiles[1].Kind || tiles[0].Kind != tiles[2].Kind {
		return false
	}
	ranks := []int{int(tiles[0].Rank), int(tiles[1].Rank), int(tiles[2].Rank)}
	sort.Ints(ranks)
	return ranks[0] >= 1 && ranks[2] <= 9 && ranks[1] == ranks[0]+1 && ranks[2] == ranks[1]+1
}

func allSameType(tiles []Tile) bool {
	if len(tiles) == 0 {
		return false
	}
	for _, tile := range tiles[1:] {
		if !sameTileType(tiles[0], tile) {
			return false
		}
	}
	return true
}

func cloneMeld(meld Meld) Meld {
	meld.Tiles = append([]Tile(nil), meld.Tiles...)
	return meld
}

func cloneMelds(melds []Meld) []Meld {
	cloned := make([]Meld, len(melds))
	for index, meld := range melds {
		cloned[index] = cloneMeld(meld)
	}
	return cloned
}

func countTileType(tiles []Tile, target Tile) int {
	count := 0
	for _, tile := range tiles {
		if sameTileType(tile, target) {
			count++
		}
	}
	return count
}

func tileWithType(tiles []Tile, kind TileKind, rank uint8) *Tile {
	for _, tile := range tiles {
		if tile.Kind == kind && tile.Rank == rank {
			return &tile
		}
	}
	return nil
}

func takeTileType(tiles []Tile, target Tile, count int) ([]Tile, []Tile) {
	taken := make([]Tile, 0, count)
	remaining := make([]Tile, 0, len(tiles)-count)
	for _, tile := range tiles {
		if sameTileType(tile, target) && len(taken) < count {
			taken = append(taken, tile)
			continue
		}
		remaining = append(remaining, tile)
	}
	return taken, remaining
}

func removeTileIDsFrom(tiles []Tile, ids []string) []Tile {
	removed := map[string]struct{}{}
	for _, id := range ids {
		removed[id] = struct{}{}
	}
	remaining := make([]Tile, 0, len(tiles)-len(ids))
	for _, tile := range tiles {
		if _, remove := removed[tile.ID]; !remove {
			remaining = append(remaining, tile)
		}
	}
	return remaining
}

func sortTiles(tiles []Tile) {
	sort.Slice(tiles, func(i, j int) bool {
		left, right := tileTypeKey(tiles[i]), tileTypeKey(tiles[j])
		if left == right {
			return tiles[i].ID < tiles[j].ID
		}
		return left < right
	})
}

func shapeKey(shape HandShape) string {
	meldKeys := make([]string, 0, len(shape.Melds))
	for _, meld := range shape.Melds {
		tileKeys := make([]string, 0, len(meld.Tiles))
		for _, tile := range meld.Tiles {
			tileKeys = append(tileKeys, tileKeysForMeld(tile))
		}
		sort.Strings(tileKeys)
		meldKeys = append(meldKeys, fmt.Sprintf("%s:%s:%t:%t", meld.Type, strings.Join(tileKeys, ","), meld.Concealed, meld.Added))
	}
	sort.Strings(meldKeys)
	pairKeys := make([]string, 0, len(shape.Pair))
	for _, tile := range shape.Pair {
		pairKeys = append(pairKeys, tileTypeKey(tile))
	}
	sort.Strings(pairKeys)
	return fmt.Sprintf("%s|%s", strings.Join(pairKeys, ","), strings.Join(meldKeys, ";"))
}

func tileKeysForMeld(tile Tile) string {
	return tileTypeKey(tile)
}

func tileTypeCounts(hand []Tile, melds []Meld) map[string]int {
	counts := map[string]int{}
	for _, tile := range hand {
		counts[tileTypeKey(tile)]++
	}
	for _, meld := range melds {
		for _, tile := range meld.Tiles {
			counts[tileTypeKey(tile)]++
		}
	}
	return counts
}

func catalogRepresentatives() []Tile {
	representatives := make([]Tile, 0, 34)
	for _, tile := range Catalog() {
		if tile.IsFlower() || tile.Copy != 1 {
			continue
		}
		representatives = append(representatives, tile)
	}
	sortTiles(representatives)
	return representatives
}

func tileTypeKey(tile Tile) string {
	if tile.IsNumbered() {
		return fmt.Sprintf("%s-%d", tile.Kind, tile.Rank)
	}
	return tileBaseID(tile.ID)
}
