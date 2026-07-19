package bots

import (
	"time"

	"github.com/gameswithout/mahjong/rulesengine"
)

// Policy is a pure, deterministic difficulty policy (§11.3): the same
// observation and seed always yield the same Decision (§11.4). It never
// touches anything beyond its Observation argument, so it structurally
// cannot use hidden information.
type Policy interface {
	Difficulty() Difficulty

	// DecideDiscard picks the concealed-hand tile to discard on this seat's
	// turn (the "hand building" and "defense" rows).
	DecideDiscard(obs Observation, seed uint64) Decision

	// DecideClaim decides this seat's private response to a public discard,
	// given the claim types and Chow compositions this seat is legally
	// eligible for. A legal Win is always declared regardless of difficulty
	// (§11.3); this method only exercises real policy judgment for the
	// Pong/Kong/Chow/Pass choice.
	DecideClaim(obs Observation, options ClaimOptions, seed uint64) Decision

	// DecideSelfKong decides whether to declare a legal self-turn Kong
	// (concealed, or adding a self-drawn tile to an exposed Pong).
	DecideSelfKong(obs Observation, options []SelfKongOption, seed uint64) Decision
}

// DecideOffer answers a server-initiated Eight Flowers or Heavenly Hand
// offer (§5.9). Both are wins, and §11.3 requires every difficulty to
// always declare a legal Win, so this decision is difficulty-invariant —
// unlike DecideDiscard/DecideClaim/DecideSelfKong it is not part of the
// difficulty-varying Policy interface, but it is still seeded and recorded
// like any other decision (§11.4).
func DecideOffer(difficulty Difficulty, obs Observation, seed uint64) Decision {
	min, max := reactionRange(difficulty)
	return newDecision(difficulty, seed, obs, Action{Kind: ActionAcceptOffer}, reactionDelay(seed, min, max))
}

// reactionRange returns the §11.3 reaction-time bounds for a difficulty.
func reactionRange(difficulty Difficulty) (time.Duration, time.Duration) {
	switch difficulty {
	case Easy:
		return 800 * time.Millisecond, 1800 * time.Millisecond
	case Medium:
		return 900 * time.Millisecond, 2000 * time.Millisecond
	case Hard:
		return 1000 * time.Millisecond, 2300 * time.Millisecond
	default:
		return time.Second, time.Second
	}
}

// decideWinOrPass is shared by every difficulty: §11.3 requires all
// difficulties to always declare a legal Win and otherwise Pass when a claim
// does not satisfy the difficulty's row.
func decideWinOrPass(difficulty Difficulty, obs Observation, options ClaimOptions, seed uint64) (Decision, bool) {
	min, max := reactionRange(difficulty)
	if options.CanWin {
		return newDecision(difficulty, seed, obs, Action{Kind: ActionDeclareWin}, reactionDelay(seed, min, max)), true
	}
	return Decision{}, false
}

// ---- Easy -------------------------------------------------------------

// easyPolicy favors immediately completed melds with high random variation,
// claims most immediate progress, declares most legal Kongs, and defends no
// further than discarding isolated tiles (§11.3 Easy column).
type easyPolicy struct{}

// NewEasyPolicy returns the §11.3 Easy difficulty policy.
func NewEasyPolicy() Policy { return easyPolicy{} }

func (easyPolicy) Difficulty() Difficulty { return Easy }

// easyTopSetProbability is the chance Easy still discards from the
// efficiency reference's top tier despite its "high random variation"
// (§11.3). Tuned against TestDiscardDivergenceSpotCheck so measured
// divergence from the reference lands near the middle of §11.4's 35-50%
// band; final statistical certification against the full 10,000-sim
// calibration suite is E3.F4's job, not this constant.
const easyTopSetProbability = 0.58

func (p easyPolicy) DecideDiscard(obs Observation, seed uint64) Decision {
	min, max := reactionRange(Easy)
	ranked := rankDiscards(obs.Hand, obs.Melds)
	if len(ranked) == 0 {
		return newDecision(Easy, seed, obs, Action{}, reactionDelay(seed, min, max))
	}
	rng := newSeedSequence(seed).rngForStep(0)
	top := topTierIndices(ranked)
	if rng.Float64() < easyTopSetProbability {
		choice := ranked[top[rng.Intn(len(top))]]
		return newDecision(Easy, seed, obs, Action{Kind: ActionDiscard, TileID: choice.tile.ID}, reactionDelay(seed, min, max))
	}
	// The rest of the time, bias toward the most isolated remaining tile —
	// Easy is not purely random even outside the reference's top tier.
	rest := restIndices(ranked, top)
	if len(rest) == 0 {
		rest = top
	}
	weights := make([]int, len(rest))
	total := 0
	for i, index := range rest {
		weight := len(rest) - i
		if ranked[index].connectivity == 0 {
			weight += len(rest)
		}
		weights[i] = weight
		total += weight
	}
	pick := rng.Intn(total)
	chosenIndex := rest[len(rest)-1]
	for i, index := range rest {
		if pick < weights[i] {
			chosenIndex = index
			break
		}
		pick -= weights[i]
	}
	return newDecision(Easy, seed, obs, Action{Kind: ActionDiscard, TileID: ranked[chosenIndex].tile.ID}, reactionDelay(seed, min, max))
}

func (p easyPolicy) DecideClaim(obs Observation, options ClaimOptions, seed uint64) Decision {
	if decision, won := decideWinOrPass(Easy, obs, options, seed); won {
		return decision
	}
	min, max := reactionRange(Easy)
	reaction := reactionDelay(seed, min, max)
	// Claims most immediate progress: Kong > Pong > Chow > Pass, taking
	// whichever the tightest structural commitment offers first, since Easy
	// does not weigh value or wait damage.
	switch {
	case options.CanKong:
		return newDecision(Easy, seed, obs, Action{Kind: ActionKong}, reaction)
	case options.CanPong:
		return newDecision(Easy, seed, obs, Action{Kind: ActionPong}, reaction)
	case len(options.ChowSets) > 0:
		rng := newSeedSequence(seed).rngForStep(1)
		set := options.ChowSets[rng.Intn(len(options.ChowSets))]
		return newDecision(Easy, seed, obs, Action{Kind: ActionChow, TileIDs: []string{set[0], set[1]}}, reaction)
	default:
		return newDecision(Easy, seed, obs, Action{Kind: ActionPass}, reaction)
	}
}

func (p easyPolicy) DecideSelfKong(obs Observation, options []SelfKongOption, seed uint64) Decision {
	min, max := reactionRange(Easy)
	reaction := reactionDelay(seed, min, max)
	// Declares most legal Kongs.
	if len(options) == 0 {
		return newDecision(Easy, seed, obs, Action{Kind: ActionPass}, reaction)
	}
	return selfKongDecision(Easy, obs, options[0], seed, reaction)
}

// ---- Medium -------------------------------------------------------------

// mediumPolicy minimizes distance to a legal hand and maximizes visible
// effective draws, claims when effective-draw count improves without
// materially hurting value, avoids Kongs that damage waits, and uses
// obvious visible exhaustion plus late-hand caution for defense (§11.3
// Medium column).
type mediumPolicy struct{}

// NewMediumPolicy returns the §11.3 Medium difficulty policy.
func NewMediumPolicy() Policy { return mediumPolicy{} }

func (mediumPolicy) Difficulty() Difficulty { return Medium }

// mediumTopPickProbability is the chance Medium takes the literal
// efficiency-reference optimum rather than the next-best tier. Tuned
// against TestDiscardDivergenceSpotCheck so measured divergence lands near
// the middle of §11.4's 10-20% band; the residual divergence represents
// Medium's defense/caution weighing not present in the pure one-ply
// reference (§11.3). Final statistical certification is E3.F4's job.
const mediumTopPickProbability = 0.86

func (p mediumPolicy) DecideDiscard(obs Observation, seed uint64) Decision {
	min, max := reactionRange(Medium)
	ranked := rankDiscards(obs.Hand, obs.Melds)
	if len(ranked) == 0 {
		return newDecision(Medium, seed, obs, Action{}, reactionDelay(seed, min, max))
	}
	// Late-hand caution: once the wall is nearly exhausted, prefer a tile
	// that has already appeared in the public discard pile (an opponent
	// passing on it is the "obvious visible exhaustion" signal available
	// within the §11.2 boundary) among the top-ranked candidates, rather
	// than always taking the single best hand-building pick.
	if obs.DrawableRemaining <= lateHandThreshold {
		if safer := safestAmongTop(ranked, obs.Discards); safer != "" {
			return newDecision(Medium, seed, obs, Action{Kind: ActionDiscard, TileID: safer}, reactionDelay(seed, min, max))
		}
	}
	top := topTierIndices(ranked)
	rng := newSeedSequence(seed).rngForStep(0)
	if len(top) == len(ranked) || rng.Float64() < mediumTopPickProbability {
		choice := ranked[top[rng.Intn(len(top))]]
		return newDecision(Medium, seed, obs, Action{Kind: ActionDiscard, TileID: choice.tile.ID}, reactionDelay(seed, min, max))
	}
	next := nextTierIndices(ranked, top)
	choice := ranked[next[rng.Intn(len(next))]]
	return newDecision(Medium, seed, obs, Action{Kind: ActionDiscard, TileID: choice.tile.ID}, reactionDelay(seed, min, max))
}

// lateHandThreshold is the drawable-tile count below which Medium starts
// weighing visible-exhaustion safety alongside pure hand efficiency.
const lateHandThreshold = 20

// safestAmongTop returns a discard-pile-matching tile ID from the top-ranked
// efficiency set, if one exists, so a late-hand discard is not needlessly
// risky when an equally efficient safer option is available.
func safestAmongTop(ranked []discardCandidate, discards []rulesengine.Discard) string {
	if len(ranked) == 0 {
		return ""
	}
	best := ranked[0]
	discardedTypes := map[string]bool{}
	for _, discard := range discards {
		discardedTypes[tileTypeKey(discard.Tile)] = true
	}
	for _, candidate := range ranked {
		if candidate.effective != best.effective || candidate.connectivity != best.connectivity {
			break
		}
		if discardedTypes[tileTypeKey(candidate.tile)] {
			return candidate.tile.ID
		}
	}
	return ""
}

func (p mediumPolicy) DecideClaim(obs Observation, options ClaimOptions, seed uint64) Decision {
	if decision, won := decideWinOrPass(Medium, obs, options, seed); won {
		return decision
	}
	min, max := reactionRange(Medium)
	reaction := reactionDelay(seed, min, max)

	// Claims only when the resulting hand's effective-draw count would not
	// get worse than passing. Kong is evaluated first since it is the most
	// structurally committing (§11.3: "avoids Kongs that damage waits").
	baseline := effectiveDrawCount(obs.Hand, obs.Melds)
	if options.CanKong && claimImprovesOrHolds(obs, kongClaimResult(obs, options.Discard), baseline) {
		return newDecision(Medium, seed, obs, Action{Kind: ActionKong}, reaction)
	}
	if options.CanPong && claimImprovesOrHolds(obs, pongClaimResult(obs, options.Discard), baseline) {
		return newDecision(Medium, seed, obs, Action{Kind: ActionPong}, reaction)
	}
	if bestSet, ok := bestChow(obs, options.ChowSets, baseline); ok {
		return newDecision(Medium, seed, obs, Action{Kind: ActionChow, TileIDs: []string{bestSet[0], bestSet[1]}}, reaction)
	}
	return newDecision(Medium, seed, obs, Action{Kind: ActionPass}, reaction)
}

// claimResult is the (remaining concealed tiles, resulting meld count) a
// hypothetical claim would produce, enough to re-score effective draws.
type claimResult struct {
	hand  []rulesengine.Tile
	melds []rulesengine.Meld
}

func pongClaimResult(obs Observation, discard rulesengine.Tile) claimResult {
	return exposeClaimResult(obs, discard, rulesengine.MeldPong, 2)
}

func kongClaimResult(obs Observation, discard rulesengine.Tile) claimResult {
	return exposeClaimResult(obs, discard, rulesengine.MeldKong, 3)
}

func exposeClaimResult(obs Observation, discard rulesengine.Tile, meldType rulesengine.MeldType, need int) claimResult {
	hand := append([]rulesengine.Tile(nil), obs.Hand...)
	claimed := make([]rulesengine.Tile, 0, need)
	remaining := make([]rulesengine.Tile, 0, len(hand))
	for _, tile := range hand {
		if len(claimed) < need && sameTileType(tile, discard) {
			claimed = append(claimed, tile)
			continue
		}
		remaining = append(remaining, tile)
	}
	melds := append([]rulesengine.Meld(nil), obs.Melds...)
	melds = append(melds, rulesengine.Meld{Type: meldType, Tiles: append(claimed, discard), Claimed: true})
	return claimResult{hand: remaining, melds: melds}
}

// claimImprovesOrHolds reports whether taking the claim leaves the seat at
// least as close to winning as passing would, using effective-draw count as
// the proximity signal (the "value is not materially harmed" test).
func claimImprovesOrHolds(obs Observation, result claimResult, baseline int) bool {
	if len(result.hand) == 0 {
		return true
	}
	best := 0
	for _, candidate := range rankDiscards(result.hand, result.melds) {
		if candidate.effective > best {
			best = candidate.effective
		}
	}
	return best >= baseline
}

// bestChow picks the Chow composition (if any) that does not leave the hand
// worse off than the baseline effective-draw count.
func bestChow(obs Observation, sets [][2]string, baseline int) ([2]string, bool) {
	bestSet, bestScore, found := [2]string{}, -1, false
	for _, set := range sets {
		hand := withoutTile(withoutTile(append([]rulesengine.Tile(nil), obs.Hand...), set[0]), set[1])
		melds := append([]rulesengine.Meld(nil), obs.Melds...)
		chowTiles := tilesByID(obs.Hand, set[0], set[1])
		chowTiles = append(chowTiles, discardTileFor(obs))
		melds = append(melds, rulesengine.Meld{Type: rulesengine.MeldChow, Tiles: chowTiles, Claimed: true})
		best := 0
		for _, candidate := range rankDiscards(hand, melds) {
			if candidate.effective > best {
				best = candidate.effective
			}
		}
		if best >= baseline && best > bestScore {
			bestSet, bestScore, found = set, best, true
		}
	}
	return bestSet, found
}

func tilesByID(hand []rulesengine.Tile, ids ...string) []rulesengine.Tile {
	out := make([]rulesengine.Tile, 0, len(ids))
	for _, id := range ids {
		for _, tile := range hand {
			if tile.ID == id {
				out = append(out, tile)
				break
			}
		}
	}
	return out
}

// discardTileFor is a placeholder used only to shape a hypothetical Chow
// meld for scoring; its own ID never leaks into a real Action.
func discardTileFor(obs Observation) rulesengine.Tile {
	if len(obs.Discards) > 0 {
		return obs.Discards[len(obs.Discards)-1].Tile
	}
	return rulesengine.Tile{}
}

// DecideSelfKong avoids Kongs that damage waits (§11.3). A self-drawn Kong
// changes the concealed hand's tile count in a way that breaks the
// tenpai-boundary arithmetic WinningTiles/effectiveDrawCount rely on (the
// hand momentarily holds one tile beyond the normal 17-effective-tile
// structure), so "damages waits" is judged more directly: an added Kong
// only ever removes a tile that was never part of the concealed hand's own
// meld/pair structure to begin with (its other three copies are already an
// exposed Pong, so the concealed hand cannot also be depending on them for
// a pair or run), so it is always safe. A concealed Kong is judged unsafe
// specifically when its four tiles are the hand's only pair — ankan-ing
// your only pair is the classic real-world "damaged the wait" mistake.
func (p mediumPolicy) DecideSelfKong(obs Observation, options []SelfKongOption, seed uint64) Decision {
	min, max := reactionRange(Medium)
	reaction := reactionDelay(seed, min, max)
	for _, option := range options {
		if option.Added || !konganksOnlyPair(obs.Hand, option.TileIDs) {
			return selfKongDecision(Medium, obs, option, seed, reaction)
		}
	}
	return newDecision(Medium, seed, obs, Action{Kind: ActionPass}, reaction)
}

// konganksOnlyPair reports whether removing kongTileIDs (four copies of one
// tile type) from hand would eliminate the hand's only remaining pair.
func konganksOnlyPair(hand []rulesengine.Tile, kongTileIDs []string) bool {
	if !hasPair(hand) {
		return false
	}
	remaining := append([]rulesengine.Tile(nil), hand...)
	for _, id := range kongTileIDs {
		remaining = withoutTile(remaining, id)
	}
	return !hasPair(remaining)
}

// hasPair reports whether any tile type appears at least twice in hand.
func hasPair(hand []rulesengine.Tile) bool {
	counts := map[string]int{}
	for _, tile := range hand {
		if tile.IsFlower() {
			continue
		}
		counts[tileTypeKey(tile)]++
		if counts[tileTypeKey(tile)] >= 2 {
			return true
		}
	}
	return false
}

func selfKongDecision(difficulty Difficulty, obs Observation, option SelfKongOption, seed uint64, reaction time.Duration) Decision {
	if option.Added {
		return newDecision(difficulty, seed, obs, Action{Kind: ActionAddedKong, TileID: option.TileID}, reaction)
	}
	return newDecision(difficulty, seed, obs, Action{Kind: ActionConcealedKong, TileIDs: option.TileIDs}, reaction)
}
