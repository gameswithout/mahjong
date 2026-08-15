package bots

import (
	"sync"

	"github.com/gameswithout/mahjong/rulesengine"
)

// This file is the persona evaluator foundation
// (docs/bot-playing-style-personas.md §3.2). The existing
// effectiveDrawCount is precise but only ever nonzero at tenpai, because
// rulesengine.WinningTiles finds no candidate earlier and
// rulesengine.EvaluateHand refuses any tile count other than an exact
// five-melds-plus-pair shape. A Speed or claim personality needs a hand
// distance that means something from the first draw, so the block search
// below works over tile-type counts instead of over complete hands.

const (
	// taiwaneseSets is how many melds a legal Taiwanese 16-tile hand needs
	// alongside its single pair (§5.3): five sets plus a pair, 17 effective
	// tiles.
	taiwaneseSets = 5
	// maxBlocks is the most blocks a hand can usefully hold — the five sets
	// plus the pair. A seventh partial cannot contribute to any legal hand,
	// so the block search stops there.
	maxBlocks = taiwaneseSets + 1
	// deficiencyBase is the distance of a hand holding no blocks at all,
	// i.e. 2 tiles still needed for each of the five sets. Every complete
	// set removes 2 and every partial removes 1, which is the standard
	// deficiency ("shanten") identity generalized from the four-set
	// variants the published algorithms target to this ruleset's five.
	deficiencyBase = 2 * taiwaneseSets
)

// blockProfile is one way to carve a hand into scoring blocks: complete
// sets, partial sets (two tiles a third would complete), and whether any of
// those partials is pair-shaped and can therefore serve as the hand's pair.
type blockProfile struct {
	sets     int
	partials int
	pair     bool
}

// tileGroup is a contiguous run of structuralTypes within which blocks can
// form. A Chow never spans a suit and honors form no Chows at all, so each
// group is decomposed independently and the results combined.
type tileGroup struct {
	start  int // inclusive index into structuralTypes
	end    int // exclusive
	suited bool
}

var (
	tileGroupsOnce sync.Once
	tileGroupsList []tileGroup
)

// structuralGroups partitions structuralTypes by tile kind. It is computed
// lazily rather than in an init: structuralTypes itself is populated by
// safety.go's init, and Go orders init functions by file name, so an init
// here would run first and see an empty slice.
func structuralGroups() []tileGroup {
	tileGroupsOnce.Do(func() {
		for index, item := range structuralTypes {
			suited := item.kind == rulesengine.Characters ||
				item.kind == rulesengine.Bamboo ||
				item.kind == rulesengine.Dots
			if last := len(tileGroupsList) - 1; last >= 0 && structuralTypes[index-1].kind == item.kind {
				tileGroupsList[last].end = index + 1
				continue
			}
			tileGroupsList = append(tileGroupsList, tileGroup{start: index, end: index + 1, suited: suited})
		}
	})
	return tileGroupsList
}

// handCensus counts a concealed hand by structural tile type. Flowers are
// excluded — they are exposed on sight (§5.4) and never participate in the
// meld structure.
func handCensus(hand []rulesengine.Tile) []int {
	counts := make([]int, len(structuralTypes))
	for _, item := range hand {
		if item.IsFlower() {
			continue
		}
		if index, ok := structuralIndex[tileTypeKey(item)]; ok {
			counts[index]++
		}
	}
	return counts
}

// enumerateBlocks records every way the tiles of one group can be carved
// into blocks. Each recursion step either leaves a type's remaining copies
// as floaters or spends them on a Pong, a pair, a Chow, or a one-away or
// gapped partial, so every sub-decomposition of a decomposition is itself
// enumerated. That property is what lets the callers below clamp an
// over-full block count without losing the true optimum: a clamped profile
// is always matched or beaten by an enumerated smaller one.
//
// allowChow is false for the honor groups, and also for the All Pongs
// pattern search, where a sequence cannot count toward the target.
func enumerateBlocks(counts []int, group tileGroup, allowChow bool, index int, current blockProfile, out map[blockProfile]struct{}) {
	if current.sets+current.partials >= maxBlocks || index >= group.end {
		out[current] = struct{}{}
		return
	}
	if counts[index] == 0 {
		enumerateBlocks(counts, group, allowChow, index+1, current, out)
		return
	}
	// Leave this type's remaining copies as floaters.
	enumerateBlocks(counts, group, allowChow, index+1, current, out)

	if counts[index] >= 3 {
		counts[index] -= 3
		enumerateBlocks(counts, group, allowChow, index, blockProfile{current.sets + 1, current.partials, current.pair}, out)
		counts[index] += 3
	}
	// Two of a kind is a partial toward a Pong and is also pair-shaped, so
	// it can always be designated the hand's pair — there is no separate
	// "not the pair" reading to enumerate.
	if counts[index] >= 2 {
		counts[index] -= 2
		enumerateBlocks(counts, group, allowChow, index, blockProfile{current.sets, current.partials + 1, true}, out)
		counts[index] += 2
	}
	if !allowChow || !group.suited {
		return
	}
	next1, next2 := chowNext1[index], chowNext2[index]
	if next1 >= 0 && next2 >= 0 && counts[next1] > 0 && counts[next2] > 0 {
		counts[index]--
		counts[next1]--
		counts[next2]--
		enumerateBlocks(counts, group, allowChow, index, blockProfile{current.sets + 1, current.partials, current.pair}, out)
		counts[index]++
		counts[next1]++
		counts[next2]++
	}
	for _, partner := range [2]int{next1, next2} {
		if partner < 0 || counts[partner] == 0 {
			continue
		}
		counts[index]--
		counts[partner]--
		enumerateBlocks(counts, group, allowChow, index, blockProfile{current.sets, current.partials + 1, current.pair}, out)
		counts[index]++
		counts[partner]++
	}
}

// groupProfiles decomposes a single group.
func groupProfiles(counts []int, group tileGroup, allowChow bool) map[blockProfile]struct{} {
	out := map[blockProfile]struct{}{}
	enumerateBlocks(counts, group, allowChow, group.start, blockProfile{}, out)
	return out
}

// allGroupProfiles decomposes every group. Callers that probe many
// hypothetical draws (liveAcceptance) recompute only the one group a drawn
// tile belongs to and reuse the rest.
func allGroupProfiles(counts []int, allowChow bool) []map[blockProfile]struct{} {
	groups := structuralGroups()
	profiles := make([]map[blockProfile]struct{}, len(groups))
	for index, group := range groups {
		profiles[index] = groupProfiles(counts, group, allowChow)
	}
	return profiles
}

// deficiencyFrom combines per-group decompositions into the best (lowest)
// distance to a legal hand. exposedSets is the seat's meld count; a Kong is
// one set like any other.
//
// Returns -1 for a hand that is already complete, 0 at tenpai, and a
// positive count of further improving draws otherwise.
func deficiencyFrom(profiles []map[blockProfile]struct{}, exposedSets int) int {
	combined := map[blockProfile]struct{}{{}: {}}
	for _, group := range profiles {
		next := make(map[blockProfile]struct{}, len(combined))
		for base := range combined {
			for add := range group {
				merged := blockProfile{
					sets:     base.sets + add.sets,
					partials: base.partials + add.partials,
					pair:     base.pair || add.pair,
				}
				if merged.sets+merged.partials > maxBlocks || merged.sets > taiwaneseSets {
					continue
				}
				next[merged] = struct{}{}
			}
		}
		combined = next
	}

	best := deficiencyBase
	for profile := range combined {
		sets := profile.sets + exposedSets
		if sets > taiwaneseSets {
			sets = taiwaneseSets
		}
		partials := profile.partials
		if sets+partials > maxBlocks {
			partials = maxBlocks - sets
		}
		value := deficiencyBase - 2*sets - partials
		// Holding a full six blocks with no pair among them means one of
		// them must be broken up again before the hand can be legal.
		if sets+partials == maxBlocks && !profile.pair {
			value++
		}
		if value < best {
			best = value
		}
	}
	return best
}

// deficiency reports how many more improving tiles the seat needs before
// hand+melds is a legal 17-tile hand: -1 if it already is, 0 at tenpai.
// Unlike effectiveDrawCount this is meaningful from the opening hand
// onward, which is what a Speed or claim persona reads.
func deficiency(hand []rulesengine.Tile, melds []rulesengine.Meld) int {
	counts := handCensus(hand)
	return deficiencyFrom(allGroupProfiles(counts, true), len(melds))
}

// liveAcceptance reports how many still-unseen physical tiles would reduce
// the hand's deficiency — the persona-facing "how many ways is this hand
// still improving" signal. budget is the per-type unseen-copy budget from
// unseenBudget/VisibleCounts, so acceptance is knowledge-aware: a tile type
// all four copies of which are already on the table counts for nothing,
// and no information outside the §11.2 boundary is consulted.
func liveAcceptance(hand []rulesengine.Tile, melds []rulesengine.Meld, budget map[string]int) int {
	counts := handCensus(hand)
	profiles := allGroupProfiles(counts, true)
	base := deficiencyFrom(profiles, len(melds))
	if base < 0 {
		return 0
	}

	groups := structuralGroups()
	probe := make([]map[blockProfile]struct{}, len(profiles))
	copy(probe, profiles)

	total := 0
	for groupIndex, group := range groups {
		for index := group.start; index < group.end; index++ {
			remaining := budget[structuralTypes[index].key]
			if remaining <= 0 || counts[index] >= 4 {
				continue
			}
			counts[index]++
			probe[groupIndex] = groupProfiles(counts, group, true)
			improved := deficiencyFrom(probe, len(melds)) < base
			counts[index]--
			if improved {
				total += remaining
			}
		}
		probe[groupIndex] = profiles[groupIndex]
	}
	return total
}

// blockShape counts what kind of unfinished blocks a hand is holding:
// pair-shaped groups (two or more of a type, the raw material of a Pong)
// and sequence-shaped ones (two same-suit tiles a third would join). A
// persona reads this to express which shapes it would rather keep, which is
// a discard preference and not only a claim preference.
//
// Tiles are counted once: a type spent on a pair is not also counted toward
// a run, so the two totals do not double-count a hand.
func blockShape(hand []rulesengine.Tile) (pairs, runs int) {
	counts := handCensus(hand)
	for index, count := range counts {
		for count >= 2 {
			pairs++
			count -= 2
			counts[index] -= 2
		}
	}
	for index, count := range counts {
		if count == 0 {
			continue
		}
		for _, partner := range [2]int{chowNext1[index], chowNext2[index]} {
			if partner < 0 || counts[index] == 0 || counts[partner] == 0 {
				continue
			}
			runs++
			counts[index]--
			counts[partner]--
		}
	}
	return pairs, runs
}

// ---- Pattern feasibility ----------------------------------------------

// patternTarget names a high-Tai family a persona can commit to. Jade
// Dragon needs an explicit target plus the thresholds below so that "Big
// Hand" means pursuing a plausible route, not blindly hoarding one suit
// (docs/bot-playing-style-personas.md §6.4).
type patternTarget string

const (
	patternNone      patternTarget = ""
	patternHalfFlush patternTarget = "half_flush"
	patternFullFlush patternTarget = "full_flush"
	patternAllPongs  patternTarget = "all_pongs"
	patternHonors    patternTarget = "honors"
)

// pursuablePatterns is the set Jade Dragon chooses among, in the order it
// prefers on an equal fit — a Full Flush outscores a Half Flush, which
// outscores the shape-only families.
var pursuablePatterns = []patternTarget{
	patternFullFlush,
	patternHalfFlush,
	patternAllPongs,
	patternHonors,
}

// dominantSuit reports the numbered suit the seat holds most of, and how
// many of its structural tiles are in it. Ties resolve by structural order
// so the answer is deterministic.
func dominantSuit(hand []rulesengine.Tile, melds []rulesengine.Meld) (rulesengine.TileKind, int) {
	counts := map[rulesengine.TileKind]int{}
	forEachStructuralTile(hand, melds, func(item rulesengine.Tile) {
		if item.IsNumbered() {
			counts[item.Kind]++
		}
	})
	best, bestCount := rulesengine.TileKind(""), 0
	for _, kind := range []rulesengine.TileKind{rulesengine.Bamboo, rulesengine.Characters, rulesengine.Dots} {
		if counts[kind] > bestCount {
			best, bestCount = kind, counts[kind]
		}
	}
	return best, bestCount
}

func forEachStructuralTile(hand []rulesengine.Tile, melds []rulesengine.Meld, visit func(rulesengine.Tile)) {
	for _, item := range hand {
		if !item.IsFlower() {
			visit(item)
		}
	}
	for _, meld := range melds {
		for _, item := range meld.Tiles {
			if !item.IsFlower() {
				visit(item)
			}
		}
	}
}

// patternFit reports what share of the seat's structural tiles already
// belong to target, in [0, 1]. It is the "how committed am I already"
// reading a persona compares against its commitment threshold.
func patternFit(hand []rulesengine.Tile, melds []rulesengine.Meld, target patternTarget) float64 {
	if target == patternNone {
		return 0
	}
	suit, _ := dominantSuit(hand, melds)
	total, matching := 0, 0
	forEachStructuralTile(hand, melds, func(item rulesengine.Tile) {
		total++
		switch target {
		case patternFullFlush:
			if item.Kind == suit {
				matching++
			}
		case patternHalfFlush:
			if item.Kind == suit || !item.IsNumbered() {
				matching++
			}
		case patternHonors:
			if !item.IsNumbered() {
				matching++
			}
		}
	})
	if total == 0 {
		return 0
	}
	if target == patternAllPongs {
		return allPongsFit(hand, melds)
	}
	return float64(matching) / float64(total)
}

// allPongsFit measures shape rather than tile identity: exposed Pongs and
// Kongs count in full, exposed Chows count against, and concealed tiles
// count to the extent they are already paired up.
func allPongsFit(hand []rulesengine.Tile, melds []rulesengine.Meld) float64 {
	total, matching := 0, 0
	for _, meld := range melds {
		total += len(meld.Tiles)
		if meld.Type != rulesengine.MeldChow {
			matching += len(meld.Tiles)
		}
	}
	counts := map[string]int{}
	for _, item := range hand {
		if item.IsFlower() {
			continue
		}
		counts[tileTypeKey(item)]++
		total++
	}
	for _, count := range counts {
		if count >= 2 {
			matching += count
		}
	}
	if total == 0 {
		return 0
	}
	return float64(matching) / float64(total)
}

// patternDeficiency is the hand's distance to a target-shaped legal hand:
// the same block search, run over only the tiles the target permits. For
// All Pongs the restriction is on block shape instead — no Chow may count.
func patternDeficiency(hand []rulesengine.Tile, melds []rulesengine.Meld, target patternTarget) int {
	if target == patternNone {
		return deficiency(hand, melds)
	}
	if target == patternAllPongs {
		counts := handCensus(hand)
		return deficiencyFrom(allGroupProfiles(counts, false), len(melds))
	}
	suit, _ := dominantSuit(hand, melds)
	counts := handCensus(hand)
	for index, item := range structuralTypes {
		if patternAdmits(target, suit, item) {
			continue
		}
		counts[index] = 0
	}
	return deficiencyFrom(allGroupProfiles(counts, true), len(melds))
}

func patternAdmits(target patternTarget, suit rulesengine.TileKind, item structuralType) bool {
	numbered := item.kind == rulesengine.Characters ||
		item.kind == rulesengine.Bamboo ||
		item.kind == rulesengine.Dots
	switch target {
	case patternFullFlush:
		return item.kind == suit
	case patternHalfFlush:
		return item.kind == suit || !numbered
	case patternHonors:
		return !numbered
	default:
		return true
	}
}

// patternFeasible reports whether target is still worth pursuing: the
// remaining distance to a target-shaped hand must be coverable by the
// personal turns the wall still allows, and at least some of the tiles it
// needs must still be unseen. This is the abandonment threshold §6.4
// requires — a committed suit that has been depleted, or a wall that has
// run too short, retires the target instead of stranding the hand.
func patternFeasible(obs Observation, target patternTarget, budget map[string]int) bool {
	if target == patternNone {
		return false
	}
	distance := patternDeficiency(obs.Hand, obs.Melds, target)
	if distance < 0 {
		return true
	}
	// The wall is drawn from by all four seats, so a seat's own remaining
	// draws are roughly a quarter of what is left.
	personalDraws := obs.DrawableRemaining / len(seatOrder)
	if distance > personalDraws {
		return false
	}
	return patternAcceptance(obs, target, budget) > 0
}

// patternAcceptance counts the unseen tiles that would move the hand closer
// to a target-shaped hand.
func patternAcceptance(obs Observation, target patternTarget, budget map[string]int) int {
	suit, _ := dominantSuit(obs.Hand, obs.Melds)
	counts := handCensus(obs.Hand)
	allowChow := target != patternAllPongs
	if target != patternAllPongs {
		for index, item := range structuralTypes {
			if !patternAdmits(target, suit, item) {
				counts[index] = 0
			}
		}
	}
	base := deficiencyFrom(allGroupProfiles(counts, allowChow), len(obs.Melds))
	if base < 0 {
		return 0
	}

	groups := structuralGroups()
	profiles := allGroupProfiles(counts, allowChow)
	probe := make([]map[blockProfile]struct{}, len(profiles))
	copy(probe, profiles)

	total := 0
	for groupIndex, group := range groups {
		for index := group.start; index < group.end; index++ {
			if !patternAdmits(target, suit, structuralTypes[index]) {
				continue
			}
			remaining := budget[structuralTypes[index].key]
			if remaining <= 0 || counts[index] >= 4 {
				continue
			}
			counts[index]++
			probe[groupIndex] = groupProfiles(counts, group, allowChow)
			improved := deficiencyFrom(probe, len(obs.Melds)) < base
			counts[index]--
			if improved {
				total += remaining
			}
		}
		probe[groupIndex] = profiles[groupIndex]
	}
	return total
}

// bestPattern picks the first pattern in the persona's preferred order that
// this hand can still plausibly reach and whose current fit clears
// commitment, or patternNone when no target is worth committing to.
// commitment is the persona's §4 evidence threshold: a higher value demands
// that more of the hand already point at the target before it is adopted.
func bestPattern(obs Observation, order []patternTarget, commitment float64, budget map[string]int) patternTarget {
	for _, target := range order {
		if patternFit(obs.Hand, obs.Melds, target) < commitment {
			continue
		}
		if patternFeasible(obs, target, budget) {
			return target
		}
	}
	return patternNone
}

// EfficientDiscards returns the tile IDs a one-ply efficiency reference
// considers the best discards for this hand: those leaving the hand closest
// to a legal shape, and among those, the ones leaving the most tiles that
// would still improve it.
//
// This is the reference a tile-efficiency statistic measures a player
// against, so it deliberately answers a narrower question than a persona
// does. It weighs no Tai, no danger, and no opponent — a discard that gives
// up a big hand or feeds the table can still be the efficient one. Calling
// it "efficiency" rather than "the best move" is the honest framing.
//
// Availability is judged from the seat's own hand and melds alone, not from
// the table. Two players who made the same choice from the same hand should
// be scored the same way, and discarding a tile whose copies an opponent
// happened to have already shown is not a different decision about hand
// shape.
//
// Returns more than one ID whenever the reference genuinely cannot separate
// the candidates, which is common early. A player matching any of them
// discarded efficiently.
func EfficientDiscards(hand []rulesengine.Tile, melds []rulesengine.Meld) map[string]bool {
	discardable := legalDiscards(hand)
	best := map[string]bool{}
	if len(discardable) == 0 {
		return best
	}

	budget := handOnlyBudget(hand, melds)
	type scored struct {
		id         string
		distance   int
		acceptance int
	}
	candidates := make([]scored, 0, len(discardable))
	minDistance := deficiencyBase + 1
	for _, item := range discardable {
		remaining := withoutTile(hand, item.ID)
		distance := deficiency(remaining, melds)
		candidates = append(candidates, scored{id: item.ID, distance: distance})
		if distance < minDistance {
			minDistance = distance
		}
	}

	// Live acceptance is only computed for the candidates still tied on
	// distance. It is by far the more expensive of the two signals, and it
	// cannot change the ordering of anything already further from a hand.
	maxAcceptance := -1
	for index, candidate := range candidates {
		if candidate.distance != minDistance {
			continue
		}
		remaining := withoutTile(hand, candidate.id)
		acceptance := liveAcceptance(remaining, melds, budget)
		candidates[index].acceptance = acceptance
		if acceptance > maxAcceptance {
			maxAcceptance = acceptance
		}
	}
	for _, candidate := range candidates {
		if candidate.distance == minDistance && candidate.acceptance == maxAcceptance {
			best[candidate.id] = true
		}
	}
	return best
}

// handOnlyBudget counts the copies of each tile type this seat cannot be
// drawing, using only what it holds. unseenBudget's table-aware version
// answers a different question — what is still out there — which is the
// right input for a bot deciding what to do and the wrong one for scoring
// how well a hand was shaped.
func handOnlyBudget(hand []rulesengine.Tile, melds []rulesengine.Meld) map[string]int {
	visible := map[string]int{}
	forEachStructuralTile(hand, melds, func(item rulesengine.Tile) {
		visible[tileTypeKey(item)]++
	})
	return unseenBudget(visible)
}
