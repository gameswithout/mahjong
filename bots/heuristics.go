package bots

import (
	"sort"
	"strconv"
	"strings"

	"github.com/gameswithout/mahjong/rulesengine"
)

// legalDiscards lists every tile a seat may legally discard: any concealed
// hand tile that is not a bonus/Flower tile (§5.4 — bonus tiles are exposed
// automatically, never discarded).
func legalDiscards(hand []rulesengine.Tile) []rulesengine.Tile {
	discardable := make([]rulesengine.Tile, 0, len(hand))
	for _, tile := range hand {
		if !tile.IsFlower() {
			discardable = append(discardable, tile)
		}
	}
	return discardable
}

// withoutTile returns hand with exactly one copy of id removed.
func withoutTile(hand []rulesengine.Tile, id string) []rulesengine.Tile {
	out := make([]rulesengine.Tile, 0, len(hand))
	removed := false
	for _, tile := range hand {
		if !removed && tile.ID == id {
			removed = true
			continue
		}
		out = append(out, tile)
	}
	return out
}

// sameTileType reports whether two tiles are the same catalog type
// (ignoring physical copy number). Wind and Dragon tiles carry no Rank —
// their sub-type (east vs. south, red vs. green) only distinguishes in the
// ID string, so honors compare by ID-minus-copy-suffix instead.
func sameTileType(a, b rulesengine.Tile) bool {
	if a.IsFlower() || b.IsFlower() || a.Kind != b.Kind {
		return false
	}
	if a.IsNumbered() {
		return a.Rank == b.Rank
	}
	return tileBaseID(a.ID) == tileBaseID(b.ID)
}

// tileBaseID strips the trailing "-<copy>" suffix from a catalog tile ID.
func tileBaseID(id string) string {
	index := strings.LastIndexByte(id, '-')
	if index == -1 {
		return id
	}
	return id[:index]
}

// connectivityScore rates how useful a candidate tile is to the rest of the
// hand: pair/triplet partners score highest, near-run neighbors score lower,
// and a fully isolated tile scores zero. This is the shared signal behind
// Easy's isolated-tile bias and part of Medium's discard ranking; it is a
// bounded heuristic, not a full shanten calculation.
func connectivityScore(hand []rulesengine.Tile, candidate rulesengine.Tile) int {
	score := 0
	for _, other := range hand {
		if other.ID == candidate.ID {
			continue
		}
		if sameTileType(other, candidate) {
			score += 3
			continue
		}
		if other.IsNumbered() && candidate.IsNumbered() && other.Kind == candidate.Kind {
			gap := int(other.Rank) - int(candidate.Rank)
			if gap < 0 {
				gap = -gap
			}
			switch gap {
			case 1:
				score += 2
			case 2:
				score++
			}
		}
	}
	return score
}

// effectiveDrawCount reports how many distinct tile types would complete
// hand+melds right now. It is only ever nonzero when the hand is already one
// tile from complete (tenpai) — WinningTiles finds no candidate otherwise —
// so it is the precise signal at tenpai and contributes nothing earlier,
// where connectivityScore carries the ranking instead.
func effectiveDrawCount(hand []rulesengine.Tile, melds []rulesengine.Meld) int {
	waits, err := rulesengine.WinningTiles(hand, melds)
	if err != nil {
		return 0
	}
	return len(waits)
}

// discardCandidate is one legal discard together with the ranking signals
// used to choose among them.
type discardCandidate struct {
	tile         rulesengine.Tile
	effective    int
	connectivity int
}

// rankDiscards scores every legal discard by (effective draws after
// discarding, connectivity of the discarded tile) and returns candidates
// sorted best-to-worst by that combined signal, with a stable tie-break on
// tile ID so ties are deterministic before any seeded pick among them.
// "Best" maximizes effective draws (more ways to complete the hand) and
// minimizes the connectivity of the tile actually given up — connectivity
// rates how useful a tile is to the rest of the hand, so the best discard
// is the least useful one, e.g. an isolated tile over the middle of an
// already-complete run.
func rankDiscards(hand []rulesengine.Tile, melds []rulesengine.Meld) []discardCandidate {
	discardable := legalDiscards(hand)
	candidates := make([]discardCandidate, 0, len(discardable))
	for _, tile := range discardable {
		remaining := withoutTile(hand, tile.ID)
		candidates = append(candidates, discardCandidate{
			tile:         tile,
			effective:    effectiveDrawCount(remaining, melds),
			connectivity: connectivityScore(remaining, tile),
		})
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].effective != candidates[j].effective {
			return candidates[i].effective > candidates[j].effective
		}
		if candidates[i].connectivity != candidates[j].connectivity {
			return candidates[i].connectivity < candidates[j].connectivity
		}
		return candidates[i].tile.ID < candidates[j].tile.ID
	})
	return candidates
}

// topTierIndices returns the ranked indices tied for the best
// (effective, connectivity) score.
func topTierIndices(ranked []discardCandidate) []int {
	if len(ranked) == 0 {
		return nil
	}
	best := ranked[0]
	indices := []int{0}
	for i := 1; i < len(ranked); i++ {
		if ranked[i].effective != best.effective || ranked[i].connectivity != best.connectivity {
			break
		}
		indices = append(indices, i)
	}
	return indices
}

// restIndices returns every ranked index not present in top.
func restIndices(ranked []discardCandidate, top []int) []int {
	inTop := make(map[int]bool, len(top))
	for _, index := range top {
		inTop[index] = true
	}
	rest := make([]int, 0, len(ranked)-len(top))
	for i := range ranked {
		if !inTop[i] {
			rest = append(rest, i)
		}
	}
	return rest
}

// nextTierIndices returns the indices tied for the best score strictly
// below the top tier, or the top tier itself if there is nothing below it.
func nextTierIndices(ranked []discardCandidate, top []int) []int {
	rest := restIndices(ranked, top)
	if len(rest) == 0 {
		return top
	}
	best := ranked[rest[0]]
	indices := []int{rest[0]}
	for _, index := range rest[1:] {
		if ranked[index].effective != best.effective || ranked[index].connectivity != best.connectivity {
			break
		}
		indices = append(indices, index)
	}
	return indices
}

// topDiscardSet returns the tile IDs tied for the best rankDiscards score —
// the "deterministic one-ply efficiency reference" top set §11.4 measures
// Easy/Medium divergence against.
func topDiscardSet(hand []rulesengine.Tile, melds []rulesengine.Meld) map[string]bool {
	ranked := rankDiscards(hand, melds)
	top := map[string]bool{}
	if len(ranked) == 0 {
		return top
	}
	best := ranked[0]
	for _, candidate := range ranked {
		if candidate.effective != best.effective || candidate.connectivity != best.connectivity {
			break
		}
		top[candidate.tile.ID] = true
	}
	return top
}

// buildClaimOptions derives the legal claim choices for a discard purely
// from the claimant's own hand (own concealed information) and the public
// discard tile — no information outside the §11.2 boundary.
func buildClaimOptions(hand []rulesengine.Tile, discard rulesengine.Tile, canWin bool) ClaimOptions {
	options := ClaimOptions{Discard: discard, CanWin: canWin}
	matchCount := 0
	for _, tile := range hand {
		if sameTileType(tile, discard) {
			matchCount++
		}
	}
	options.CanPong = matchCount >= 2
	options.CanKong = matchCount >= 3
	if discard.IsNumbered() {
		find := func(rank int) *rulesengine.Tile {
			if rank < 1 || rank > 9 {
				return nil
			}
			for index := range hand {
				if hand[index].Kind == discard.Kind && int(hand[index].Rank) == rank {
					return &hand[index]
				}
			}
			return nil
		}
		rank := int(discard.Rank)
		for _, pair := range [][2]int{{rank - 2, rank - 1}, {rank - 1, rank + 1}, {rank + 1, rank + 2}} {
			first, second := find(pair[0]), find(pair[1])
			if first != nil && second != nil {
				options.ChowSets = append(options.ChowSets, [2]string{first.ID, second.ID})
			}
		}
	}
	return options
}

// buildSelfKongOptions lists the legal self-turn Kongs available from a
// seat's own hand and melds: a concealed Kong (four matching hand tiles) or
// an added Kong (a self-drawn fourth tile completing an exposed Pong).
func buildSelfKongOptions(hand []rulesengine.Tile, melds []rulesengine.Meld) []SelfKongOption {
	var options []SelfKongOption
	byType := map[string][]string{}
	for _, tile := range hand {
		if tile.IsFlower() {
			continue
		}
		key := tileTypeKey(tile)
		byType[key] = append(byType[key], tile.ID)
	}
	for _, ids := range byType {
		if len(ids) >= 4 {
			options = append(options, SelfKongOption{TileIDs: append([]string(nil), ids[:4]...)})
		}
	}
	for _, meld := range melds {
		if meld.Type != rulesengine.MeldPong || meld.Concealed || len(meld.Tiles) == 0 {
			continue
		}
		for _, tile := range hand {
			if sameTileType(tile, meld.Tiles[0]) {
				options = append(options, SelfKongOption{Added: true, TileID: tile.ID})
				break
			}
		}
	}
	return options
}

func tileTypeKey(tile rulesengine.Tile) string {
	if tile.IsNumbered() {
		return string(tile.Kind) + "-" + strconv.Itoa(int(tile.Rank))
	}
	return tileBaseID(tile.ID)
}
