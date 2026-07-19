package bots

import (
	"sort"

	"github.com/gameswithout/mahjong/rulesengine"
)

// hardPolicy maximizes estimated expected table points across speed
// (proximity to winning), Tai (hand value), and risk (danger of dealing
// into an opponent's hand), using the provably-safe solver in safety.go as
// its core defense signal, plus fold logic for late-hand caution (§11.3
// Hard column).
//
// This is a heuristic — not a game-theoretically optimal solver. In
// particular: hand value for a non-tenpai hand uses a cheap structural
// proxy rather than a full lookahead search, and opponent threat is a
// simple function of exposed-meld count rather than a learned or Bayesian
// opponent model. Both are documented simplifications appropriate to an
// autonomously-scoped implementation of an XL feature; E3.F4's calibration
// suite (Hard-vs-Medium 34-42% first-place rate) is the actual bar this
// needs to clear, not a specific algorithm.
type hardPolicy struct{}

// NewHardPolicy returns the §11.3 Hard difficulty policy.
func NewHardPolicy() Policy { return hardPolicy{} }

func (hardPolicy) Difficulty() Difficulty { return Hard }

const (
	// Speed (effective-draw count) and connectivity are weighted to
	// dominate the score, matching the "deterministic one-ply efficiency
	// reference" §11.4 measures Hard's divergence against (at most 5%):
	// Hard is meant to mostly agree with pure hand efficiency, using value
	// as a tie-break and risk as an override only when a real, nonzero
	// danger signal exists (an empty-opponent-info decision has zero risk
	// by construction, so it reduces to speed+connectivity ranking).
	hardSpeedWeight        = 100.0
	hardConnectivityWeight = 10.0
	hardValueWeight        = 1.0
	hardRiskWeight         = 8.0
	hardFoldSafetyBonus    = 1000000.0
	// hardFoldMeldThreshold is how many exposed melds make an opponent
	// "visibly Ting/high-value" for fold purposes (§11.3) — a defensible
	// public-only proxy: with 3+ exposed melds, only one or two groups
	// remain concealed, so they are close to complete by construction.
	hardFoldMeldThreshold = 3
	// hardFoldWallThreshold is the "fewer than 24 drawable tiles remain"
	// condition from §11.3.
	hardFoldWallThreshold = 24
)

// shouldConsiderFolding implements §11.3's fold trigger: a visibly
// threatening opponent and a late wall. The third condition ("preserving
// expected loss is better than hand completion") is realized behaviorally
// below, not as a separate boolean here: when folding is in play, a
// provably safe discard is preferred over the raw EV-best one whenever one
// exists, rather than computing a literal expected-loss figure.
func shouldConsiderFolding(obs Observation) bool {
	if obs.DrawableRemaining >= hardFoldWallThreshold {
		return false
	}
	for _, opponent := range obs.Opponents {
		if len(opponent.Melds) >= hardFoldMeldThreshold {
			return true
		}
	}
	return false
}

// opponentThreat estimates danger from public information only (§11.2):
// more exposed melds means fewer concealed tiles remain to complete their
// hand, i.e. structurally closer to winning.
func opponentThreat(o OpponentView) float64 {
	return 1.0 + float64(len(o.Melds))*0.6
}

// discardRisk sums, over every opponent not proven safe against candidate,
// that opponent's threat weighted by how many unseen copies of candidate's
// type remain. More remaining copies is a legitimate probabilistic signal
// (more of them could plausibly be in a hidden hand or the wall) — this is
// deliberately NOT based on any opponent's own prior discards, since
// Taiwanese v1.1 explicitly does not treat those as safety evidence
// (§11.3).
func discardRisk(candidate rulesengine.Tile, obs Observation, budget map[string]int, winLocked map[rulesengine.Seat]bool) float64 {
	results := EvaluateDiscardSafety(obs, candidate, winLocked)
	risk := 0.0
	remaining := float64(budget[tileTypeKey(candidate)])
	for i, result := range results {
		if result.Safe && result.Exhaustive {
			continue
		}
		risk += opponentThreat(obs.Opponents[i]) * (1 + remaining)
	}
	return risk
}

// estimateHandValue returns a weighted-average raw-Tai estimate for
// hand+melds+bonus, weighted by how many unseen copies remain of each
// winning tile type. Returns (0, false) when the hand is not currently
// tenpai — ScoreHand requires a genuinely complete hand, so a deeper-shanten
// hand's value comes from potentialValueProxy instead.
func estimateHandValue(hand []rulesengine.Tile, melds []rulesengine.Meld, bonus []rulesengine.Tile, seat, prevailingWind rulesengine.Seat, budget map[string]int) (float64, bool) {
	waits, err := rulesengine.WinningTiles(hand, melds)
	if err != nil || len(waits) == 0 {
		return 0, false
	}
	totalWeight, totalValue := 0.0, 0.0
	for _, wait := range waits {
		weight := float64(budget[tileTypeKey(wait)])
		if weight <= 0 {
			// Not proven impossible to hold (an opponent's concealed hand
			// is not visible to us), just improbable — keep a small floor
			// rather than zeroing it out entirely.
			weight = 0.25
		}
		completed := append(append([]rulesengine.Tile(nil), hand...), wait)
		player := rulesengine.PlayerState{Seat: seat, Hand: completed, Melds: melds, Exposed: bonus}
		context := rulesengine.ScoreContext{
			Seat:           seat,
			PrevailingWind: prevailingWind,
			DiscardWin:     true,
			SingleWait:     len(waits) == 1,
		}
		score, err := rulesengine.ScoreHand(player, context)
		if err != nil || !score.Winning {
			continue
		}
		totalValue += weight * float64(score.RawTai)
		totalWeight += weight
	}
	if totalWeight == 0 {
		return 0, false
	}
	return totalValue / totalWeight, true
}

// potentialValueProxy is a cheap structural stand-in for hand value when
// not yet tenpai: concealed pongs/triplets-in-progress and suit
// concentration correlate with eventual Tai, without running a full
// lookahead search over future draws.
func potentialValueProxy(hand []rulesengine.Tile, melds []rulesengine.Meld) float64 {
	counts := map[string]int{}
	kinds := map[rulesengine.TileKind]bool{}
	honors := false
	for _, tile := range hand {
		if tile.IsFlower() {
			continue
		}
		counts[tileTypeKey(tile)]++
		if tile.IsNumbered() {
			kinds[tile.Kind] = true
		} else {
			honors = true
		}
	}
	value := 0.0
	for key, count := range counts {
		if count >= 3 {
			value += 1.5
		} else if count == 2 {
			value += 0.5
		}
		_ = key
	}
	for _, meld := range melds {
		if meld.Type == rulesengine.MeldPong || meld.Type == rulesengine.MeldKong {
			value += 1
		}
	}
	if len(kinds) <= 1 && !honors {
		value += 2 // flush potential
	} else if len(kinds) <= 1 {
		value += 1 // half-flush potential
	}
	return value
}

func (p hardPolicy) DecideDiscard(obs Observation, seed uint64) Decision {
	min, max := reactionRange(Hard)
	discardable := legalDiscards(obs.Hand)
	if len(discardable) == 0 {
		return newDecision(Hard, seed, obs, Action{}, reactionDelay(seed, min, max))
	}
	budget := unseenBudget(VisibleCounts(obs))
	winLocked := map[rulesengine.Seat]bool{} // a bot only ever sees §11.2's public boundary; it cannot know an opponent's win-lock status, so none are assumed.
	folding := shouldConsiderFolding(obs)
	dealerBonus := 0.0
	if obs.Seat == obs.Dealer {
		dealerBonus = float64(1 + 2*obs.Continuation)
	}

	type candidateScore struct {
		id    string
		score float64
	}
	scores := make([]candidateScore, 0, len(discardable))
	for _, tile := range discardable {
		remaining := withoutTile(obs.Hand, tile.ID)
		// Speed and connectivity mirror rankDiscards exactly (same
		// functions, same direction) so Hard's ranking agrees with the
		// one-ply efficiency reference at the margin; value is a smaller
		// tie-break on top of that, and risk only matters when nonzero.
		speed := float64(effectiveDrawCount(remaining, obs.Melds))
		connectivity := float64(connectivityScore(remaining, tile))
		value, tenpai := estimateHandValue(remaining, obs.Melds, obs.BonusTiles, obs.Seat, obs.PrevailingWind, budget)
		if !tenpai {
			value = potentialValueProxy(remaining, obs.Melds)
		} else {
			value += dealerBonus
		}
		risk := discardRisk(tile, obs, budget, winLocked)
		score := speed*hardSpeedWeight + connectivity*hardConnectivityWeight + value*hardValueWeight - risk*hardRiskWeight
		if folding && IsFullySafe(EvaluateDiscardSafety(obs, tile, winLocked)) {
			score += hardFoldSafetyBonus
		}
		scores = append(scores, candidateScore{id: tile.ID, score: score})
	}
	sort.SliceStable(scores, func(i, j int) bool {
		if scores[i].score != scores[j].score {
			return scores[i].score > scores[j].score
		}
		return scores[i].id < scores[j].id
	})
	return newDecision(Hard, seed, obs, Action{Kind: ActionDiscard, TileID: scores[0].id}, reactionDelay(seed, min, max))
}

func (p hardPolicy) DecideClaim(obs Observation, options ClaimOptions, seed uint64) Decision {
	if decision, won := decideWinOrPass(Hard, obs, options, seed); won {
		return decision
	}
	min, max := reactionRange(Hard)
	reaction := reactionDelay(seed, min, max)
	budget := unseenBudget(VisibleCounts(obs))
	baseline, baseTenpai := estimateHandValue(obs.Hand, obs.Melds, obs.BonusTiles, obs.Seat, obs.PrevailingWind, budget)
	if !baseTenpai {
		baseline = potentialValueProxy(obs.Hand, obs.Melds)
	}
	dealerBonus := 0.0
	if obs.Seat == obs.Dealer {
		dealerBonus = float64(1 + 2*obs.Continuation)
	}

	// Evaluates openness, value ceiling, dealer state, and opponent threat:
	// openness and value ceiling come for free from estimateHandValue on
	// the resulting (now more exposed) hand — an open meld structurally
	// forecloses Concealed-family Tai, so a claim that only marginally
	// helps speed while costing that Tai will score lower here without any
	// separate "openness penalty" needed. Opponent threat raises the bar:
	// with a visibly threatening board, Hard requires a claim to strictly
	// improve rather than merely hold.
	threatened := false
	for _, opponent := range obs.Opponents {
		if len(opponent.Melds) >= hardFoldMeldThreshold {
			threatened = true
			break
		}
	}

	betterThanBaseline := func(result claimResult) bool {
		value, tenpai := estimateHandValue(result.hand, result.melds, obs.BonusTiles, obs.Seat, obs.PrevailingWind, budget)
		if !tenpai {
			value = potentialValueProxy(result.hand, result.melds)
		} else if obs.Seat == obs.Dealer {
			value += dealerBonus
		}
		if threatened {
			return value > baseline
		}
		return value >= baseline
	}

	if options.CanKong {
		result := kongClaimResult(obs, options.Discard)
		if betterThanBaseline(result) {
			return newDecision(Hard, seed, obs, Action{Kind: ActionKong}, reaction)
		}
	}
	if options.CanPong {
		result := pongClaimResult(obs, options.Discard)
		if betterThanBaseline(result) {
			return newDecision(Hard, seed, obs, Action{Kind: ActionPong}, reaction)
		}
	}
	for _, set := range options.ChowSets {
		hand := withoutTile(withoutTile(append([]rulesengine.Tile(nil), obs.Hand...), set[0]), set[1])
		chowTiles := append(tilesByID(obs.Hand, set[0], set[1]), options.Discard)
		melds := append(append([]rulesengine.Meld(nil), obs.Melds...), rulesengine.Meld{Type: rulesengine.MeldChow, Tiles: chowTiles, Claimed: true})
		if betterThanBaseline(claimResult{hand: hand, melds: melds}) {
			return newDecision(Hard, seed, obs, Action{Kind: ActionChow, TileIDs: []string{set[0], set[1]}}, reaction)
		}
	}
	return newDecision(Hard, seed, obs, Action{Kind: ActionPass}, reaction)
}

func (p hardPolicy) DecideSelfKong(obs Observation, options []SelfKongOption, seed uint64) Decision {
	min, max := reactionRange(Hard)
	reaction := reactionDelay(seed, min, max)
	if len(options) == 0 {
		return newDecision(Hard, seed, obs, Action{Kind: ActionPass}, reaction)
	}
	winLocked := map[rulesengine.Seat]bool{}
	for _, option := range options {
		// Replacement value: a concealed Kong scores 2 Tai and a wait-safe
		// one is essentially free value, so concealed Kongs that do not
		// consume the hand's only pair are always taken (mirrors Medium's
		// verified-safe reasoning in policy.go, which this reuses).
		if !option.Added {
			if !konganksOnlyPair(obs.Hand, option.TileIDs) {
				return selfKongDecision(Hard, obs, option, seed, reaction)
			}
			continue
		}
		// Added Kong: information exposure (announces this tile type is no
		// longer needed) and robbing risk (§5.7 — the added tile can be
		// claimed by any opponent it completes) both apply. Robbing risk is
		// evaluated with the exact same provably-safe solver used for
		// discards, since a robbed added Kong is structurally identical to
		// a discard-claim.
		addedTile := tileByIDValue(obs.Hand, option.TileID)
		results := EvaluateDiscardSafety(obs, addedTile, winLocked)
		if IsFullySafe(results) {
			return selfKongDecision(Hard, obs, option, seed, reaction)
		}
		// Not proven safe: only take the robbing risk when the extra Kong
		// Tai plus replacement-draw upside plausibly outweighs it, i.e.
		// when no opponent is yet visibly threatening (§11.3's information
		// exposure/robbing risk considerations, applied conservatively).
		threatened := false
		for _, opponent := range obs.Opponents {
			if len(opponent.Melds) >= hardFoldMeldThreshold {
				threatened = true
				break
			}
		}
		if !threatened {
			return selfKongDecision(Hard, obs, option, seed, reaction)
		}
	}
	return newDecision(Hard, seed, obs, Action{Kind: ActionPass}, reaction)
}

func tileByIDValue(hand []rulesengine.Tile, id string) rulesengine.Tile {
	for _, tile := range hand {
		if tile.ID == id {
			return tile
		}
	}
	return rulesengine.Tile{}
}
