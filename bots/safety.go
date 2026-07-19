package bots

import (
	"sort"

	"github.com/gameswithout/mahjong/rulesengine"
)

// structuralType is one of the 34 non-Flower catalog tile types (Bonus
// tiles never participate in the 5-melds-plus-pair structure the safety
// search reasons about).
type structuralType struct {
	key  string
	kind rulesengine.TileKind
	rank uint8
}

// structuralTypes, chowNext1, and chowNext2 are computed once. chowNext1[i]
// and chowNext2[i] are the indices of the next two consecutive same-suit
// ranks after structuralTypes[i], or -1 if none exists (honors, or too
// close to rank 9).
var (
	structuralTypes []structuralType
	structuralIndex map[string]int
	chowNext1       []int
	chowNext2       []int
)

func init() {
	seen := map[string]bool{}
	for _, item := range rulesengine.Catalog() {
		if item.IsFlower() {
			continue
		}
		key := tileTypeKey(item)
		if seen[key] {
			continue
		}
		seen[key] = true
		structuralTypes = append(structuralTypes, structuralType{key: key, kind: item.Kind, rank: item.Rank})
	}
	sort.Slice(structuralTypes, func(i, j int) bool {
		a, b := structuralTypes[i], structuralTypes[j]
		if a.kind != b.kind {
			return a.kind < b.kind
		}
		return a.rank < b.rank
	})
	structuralIndex = make(map[string]int, len(structuralTypes))
	for index, item := range structuralTypes {
		structuralIndex[item.key] = index
	}
	chowNext1 = make([]int, len(structuralTypes))
	chowNext2 = make([]int, len(structuralTypes))
	for index, item := range structuralTypes {
		chowNext1[index], chowNext2[index] = -1, -1
		if item.kind != rulesengine.Characters && item.kind != rulesengine.Bamboo && item.kind != rulesengine.Dots {
			continue
		}
		// No rank>7 shortcut here: chowNext1 (needs rank+1<=9) and
		// chowNext2 (needs rank+2<=9) have different valid ranges (e.g.
		// rank 8 has a valid chowNext1 but not chowNext2), so each is
		// independently guarded by the structuralIndex lookup failing for
		// an out-of-range rank instead.
		if next1, ok := structuralIndex[tileTypeKeyOf(item.kind, item.rank+1)]; ok {
			chowNext1[index] = next1
		}
		if next2, ok := structuralIndex[tileTypeKeyOf(item.kind, item.rank+2)]; ok {
			chowNext2[index] = next2
		}
	}
}

func tileTypeKeyOf(kind rulesengine.TileKind, rank uint8) string {
	return tileTypeKey(rulesengine.Tile{Kind: kind, Rank: rank})
}

// VisibleCounts tallies how many physical copies of each structural tile
// type are visible from this seat's own Observation: its own hand and
// melds, every seat's public discards, and every opponent's exposed melds.
// unseenBudget (4 minus this) is every remaining copy that could be in any
// opponent's hidden hand or the live wall — the safety prover cannot and
// does not try to distinguish those two, since both are unseen to this
// seat (§11.2).
func VisibleCounts(obs Observation) map[string]int {
	counts := map[string]int{}
	add := func(t rulesengine.Tile) {
		if t.IsFlower() {
			return
		}
		counts[tileTypeKey(t)]++
	}
	for _, t := range obs.Hand {
		add(t)
	}
	for _, meld := range obs.Melds {
		for _, t := range meld.Tiles {
			add(t)
		}
	}
	for _, discard := range obs.Discards {
		add(discard.Tile)
	}
	for _, opponent := range obs.Opponents {
		for _, meld := range opponent.Melds {
			for _, t := range meld.Tiles {
				add(t)
			}
		}
	}
	return counts
}

// unseenBudget converts VisibleCounts into remaining-copy budget per type.
func unseenBudget(visible map[string]int) map[string]int {
	budget := make(map[string]int, len(structuralTypes))
	for _, item := range structuralTypes {
		remaining := 4 - visible[item.key]
		if remaining < 0 {
			remaining = 0
		}
		budget[item.key] = remaining
	}
	return budget
}

// safetySearchStepCap bounds the exhaustive backtracking search so a
// pathological position cannot blow the §11.4 250ms decision budget. If the
// cap is hit before the search completes, the candidate is NOT treated as
// proven safe — an inconclusive search must never be reported as a proof
// (§11.3: "All non-proven tiles retain non-zero risk").
const safetySearchStepCap = 300000

// IsProvablySafe reports whether discarding candidate is proven safe
// against opponent: no assignment of still-unseen tiles to opponent's
// hidden hand, consistent with the rules, could complete opponent's hand
// with candidate as the winning tile (§11.3). budget is the unseen-copy
// budget from unseenBudget/VisibleCounts, NOT decremented by candidate
// itself (candidate is already counted as visible via the caller's
// Observation, since it is presently in the discarding seat's own hand).
func isProvablySafeAgainst(candidate rulesengine.Tile, opponent OpponentView, budget map[string]int) (safe bool, exhaustive bool) {
	requiredMelds := 5 - len(opponent.Melds)
	if requiredMelds < 0 || requiredMelds > 5 {
		// Structurally malformed opponent state (more than 5 melds already
		// exposed) — cannot be a legal position, so it cannot legally win.
		return true, true
	}
	typeIndex, ok := structuralIndex[tileTypeKey(candidate)]
	if !ok {
		// Bonus/Flower tiles are never a discard-Win completion tile.
		return true, true
	}

	steps := 0
	working := cloneBudget(budget)
	found := false
	inconclusive := false

	tryPlacement := func(consume func(b map[string]int) bool, meldsAfter int, pairAfter bool) {
		if found || inconclusive || meldsAfter < 0 {
			return
		}
		trial := cloneBudget(working)
		if !consume(trial) {
			return
		}
		result, ok := canCompleteFromBudget(trial, 0, meldsAfter, pairAfter, &steps)
		if !ok {
			inconclusive = true
			return
		}
		if result {
			found = true
		}
	}

	key := structuralTypes[typeIndex].key

	// Candidate as the pair.
	tryPlacement(func(b map[string]int) bool {
		if b[key] < 1 {
			return false
		}
		b[key]--
		return true
	}, requiredMelds, false)

	// Candidate as part of a Pong. Only valid if a meld is actually still
	// needed (requiredMelds>=1) — guarded by tryPlacement's meldsAfter<0
	// check when requiredMelds==0.
	tryPlacement(func(b map[string]int) bool {
		if b[key] < 2 {
			return false
		}
		b[key] -= 2
		return true
	}, requiredMelds-1, true)

	// Candidate as part of a concealed Kong (still one meld).
	tryPlacement(func(b map[string]int) bool {
		if b[key] < 3 {
			return false
		}
		b[key] -= 3
		return true
	}, requiredMelds-1, true)

	// Candidate as part of a Chow: three placements (low/mid/high run).
	for _, offset := range [][2]int{{-2, -1}, {-1, 1}, {1, 2}} {
		a, b := chowPartnerIndex(typeIndex, offset[0]), chowPartnerIndex(typeIndex, offset[1])
		if a < 0 || b < 0 {
			continue
		}
		aKey, bKey := structuralTypes[a].key, structuralTypes[b].key
		tryPlacement(func(bud map[string]int) bool {
			if bud[aKey] < 1 || bud[bKey] < 1 {
				return false
			}
			bud[aKey]--
			bud[bKey]--
			return true
		}, requiredMelds-1, true)
	}

	if inconclusive {
		return false, false
	}
	return !found, true
}

func chowPartnerIndex(typeIndex, offset int) int {
	switch offset {
	case -2:
		// two ranks below: reverse-lookup via chowNext2 of (typeIndex-2)
		if typeIndex-2 < 0 {
			return -1
		}
		if chowNext2[typeIndex-2] == typeIndex {
			return typeIndex - 2
		}
		return -1
	case -1:
		if typeIndex-1 < 0 {
			return -1
		}
		if chowNext1[typeIndex-1] == typeIndex {
			return typeIndex - 1
		}
		return -1
	case 1:
		return chowNext1[typeIndex]
	case 2:
		return chowNext2[typeIndex]
	default:
		return -1
	}
}

func cloneBudget(budget map[string]int) map[string]int {
	cloned := make(map[string]int, len(budget))
	for k, v := range budget {
		cloned[k] = v
	}
	return cloned
}

// canCompleteFromBudget is the generic backtracking search: can meldsNeeded
// additional melds (Chow/Pong/concealed-Kong) plus, if needPair, a pair, be
// formed entirely from budget? It scans structural types from typeIndex
// forward, and at each type either skips it or spends it on a Pong,
// concealed Kong, pair, or (if the next one/two ranks are available) a
// Chow starting at that type. Returns (result, exhaustive); exhaustive is
// false if the step cap was hit before a definitive answer was reached.
func canCompleteFromBudget(budget map[string]int, typeIndex, meldsNeeded int, needPair bool, steps *int) (bool, bool) {
	*steps++
	if *steps > safetySearchStepCap {
		return false, false
	}
	if meldsNeeded <= 0 && !needPair {
		return true, true
	}
	if typeIndex >= len(structuralTypes) {
		return false, true
	}
	key := structuralTypes[typeIndex].key
	available := budget[key]

	// Option: skip this type entirely.
	if ok, exhaustive := canCompleteFromBudget(budget, typeIndex+1, meldsNeeded, needPair, steps); !exhaustive {
		return false, false
	} else if ok {
		return true, true
	}

	if available >= 3 && meldsNeeded > 0 {
		trial := cloneBudget(budget)
		trial[key] -= 3
		if ok, exhaustive := canCompleteFromBudget(trial, typeIndex+1, meldsNeeded-1, needPair, steps); !exhaustive {
			return false, false
		} else if ok {
			return true, true
		}
	}
	if available >= 4 && meldsNeeded > 0 {
		trial := cloneBudget(budget)
		trial[key] -= 4
		if ok, exhaustive := canCompleteFromBudget(trial, typeIndex+1, meldsNeeded-1, needPair, steps); !exhaustive {
			return false, false
		} else if ok {
			return true, true
		}
	}
	if available >= 2 && needPair {
		trial := cloneBudget(budget)
		trial[key] -= 2
		if ok, exhaustive := canCompleteFromBudget(trial, typeIndex+1, meldsNeeded, false, steps); !exhaustive {
			return false, false
		} else if ok {
			return true, true
		}
	}
	if meldsNeeded > 0 {
		next1, next2 := chowNext1[typeIndex], chowNext2[typeIndex]
		if next1 >= 0 && next2 >= 0 && available >= 1 && budget[structuralTypes[next1].key] >= 1 && budget[structuralTypes[next2].key] >= 1 {
			trial := cloneBudget(budget)
			trial[key]--
			trial[structuralTypes[next1].key]--
			trial[structuralTypes[next2].key]--
			if ok, exhaustive := canCompleteFromBudget(trial, typeIndex+1, meldsNeeded-1, needPair, steps); !exhaustive {
				return false, false
			} else if ok {
				return true, true
			}
		}
	}
	return false, true
}

// SafetyResult is the per-opponent outcome of the provably-safe check for
// one candidate discard.
type SafetyResult struct {
	Opponent   rulesengine.Seat
	Safe       bool
	Exhaustive bool
}

// EvaluateDiscardSafety runs the provably-safe check for candidate against
// every opponent in obs, excluding any seat the caller marks win-locked
// (winLocked[seat]==true) — a locked seat cannot legally declare Win on
// this discard regardless of hand shape, so it contributes no risk (§5.8,
// §11.3: "A current temporary discard-Win lock is part of that proof").
func EvaluateDiscardSafety(obs Observation, candidate rulesengine.Tile, winLocked map[rulesengine.Seat]bool) []SafetyResult {
	visible := VisibleCounts(obs)
	budget := unseenBudget(visible)
	results := make([]SafetyResult, 0, len(obs.Opponents))
	for _, opponent := range obs.Opponents {
		if winLocked[opponent.Seat] {
			results = append(results, SafetyResult{Opponent: opponent.Seat, Safe: true, Exhaustive: true})
			continue
		}
		safe, exhaustive := isProvablySafeAgainst(candidate, opponent, budget)
		results = append(results, SafetyResult{Opponent: opponent.Seat, Safe: safe, Exhaustive: exhaustive})
	}
	return results
}

// IsFullySafe reports whether candidate is proven safe against every
// opponent in results (§11.3's "100% safe"): every result must be both Safe
// and Exhaustive (a non-exhaustive/inconclusive search never counts as
// proof, regardless of what it happened to find).
func IsFullySafe(results []SafetyResult) bool {
	for _, result := range results {
		if !result.Safe || !result.Exhaustive {
			return false
		}
	}
	return true
}
