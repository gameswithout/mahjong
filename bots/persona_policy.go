package bots

import (
	"sort"

	"github.com/gameswithout/mahjong/rulesengine"
)

// personaPolicy wraps a difficulty policy with a playing style
// (docs/bot-playing-style-personas.md §4). The division of labour is the
// one §2.3 argues for: the persona sets the weights, and difficulty still
// supplies the quality of the estimates — the persona scores every legal
// action, and the wrapped difficulty's own selection rule then decides how
// reliably the best-scoring one is actually taken.
//
// Nothing here overrides legality. Actions are still generated from the
// same legal action set the difficulty policies use, every legal Win is
// still declared unconditionally through decideWinOrPass, and no persona
// consults anything outside the §11.2 observation boundary.
type personaPolicy struct {
	base    Policy
	persona Persona
}

// NewPersonaPolicy returns base playing in persona's style. Unlike
// NewStyledPolicy — which nudges at most §11.4's 5% of already-tied discard
// decisions and leaves claims alone entirely — this re-scores the whole
// legal action set, including Chow, Pong, Kong and Pass.
func NewPersonaPolicy(base Policy, persona Persona) Policy {
	if persona.ID == "" {
		return base
	}
	return personaPolicy{base: base, persona: persona}
}

func (p personaPolicy) Difficulty() Difficulty { return p.base.Difficulty() }

// Scales convert each evaluator term into comparable score units. They are
// the shared frame the persona weights then multiply, so a weight of 1.0
// everywhere (River Scholar) is a sane all-round player and the specialists
// are readable as departures from it.
//
// Completion sets the frame: one step closer to a legal hand is worth 100,
// and every other term is sized as a fraction of that step. A persona can
// therefore be described in one sentence — Stone Lion pays up to about half
// a step of hand progress to avoid a dangerous discard; Jade Dragon pays
// about a full step to stay on its pattern.
const (
	personaCompletionScale = 100.0
	personaAcceptanceScale = 1.5
	personaValueScale      = 6.0
	personaRiskScale       = 1.5
	personaReserveScale    = 25.0
	personaShapeScale      = 12.0
	personaPatternScale    = 30.0
	// The claim and concealment costs are sized against one completion step
	// (100). Concealment is the cost *every* persona pays for opening its
	// hand and is deliberately the smaller of the two: at 60 the combined
	// penalty exceeded any gain a single claim could offer, so Stone Lion
	// and Silent Crane never called at all — a caricature of §6.3 and §6.6,
	// which describe personas that do claim when the resulting hand is
	// genuinely close. Raising it again to 45 put Stone Lion back to never.
	// Keeping the shared cost modest and letting claim_bias carry each
	// persona's own reluctance is both better behaved and easier to author
	// against: a persona's calling appetite lives in its own file rather
	// than in the interaction of two scales.
	personaClaimScale       = 40.0
	personaConcealmentScale = 30.0
	personaFoldScale        = 150.0
	// personaEarlyFoldRiskWeight is how much a persona must fear dealing in
	// before it folds on a visible threat alone, without waiting for §11.3's
	// late-wall condition. Only a Guard-class persona clears it (§6.3:
	// "folds earlier").
	personaEarlyFoldRiskWeight = 2.0
)

// ---- Discard ----------------------------------------------------------

func (p personaPolicy) DecideDiscard(obs Observation, seed uint64) Decision {
	min, max := reactionRange(p.Difficulty())
	discardable := legalDiscards(obs.Hand)
	if len(discardable) == 0 {
		return p.stamp(newDecision(p.Difficulty(), seed, obs, Action{}, reactionDelay(seed, min, max)))
	}

	budget := unseenBudget(VisibleCounts(obs))
	// A bot only ever sees §11.2's public boundary, so it cannot know any
	// opponent's win-lock status and assumes none.
	winLocked := map[rulesengine.Seat]bool{}
	context := p.contextScale(obs)
	target := bestPattern(obs, p.persona.Profile.patternOrder(), p.persona.Profile.Commitment, budget)
	folding := p.shouldFold(obs)

	// Safety is solved once per tile rather than once per (candidate, tile)
	// pair: the reserve term below only asks whether *some* other tile is
	// still a safe exit, which this answers in one pass.
	safe := make(map[string]bool, len(discardable))
	safeCount := 0
	for _, item := range discardable {
		if IsFullySafe(EvaluateDiscardSafety(obs, item, winLocked)) {
			safe[item.ID] = true
			safeCount++
		}
	}

	scored := make([]scoredAction, 0, len(discardable))
	for _, item := range discardable {
		remaining := withoutTile(obs.Hand, item.ID)
		profile := p.persona.Profile

		score := -float64(deficiency(remaining, obs.Melds)) * personaCompletionScale * profile.CompletionWeight
		score += float64(liveAcceptance(remaining, obs.Melds, budget)) * personaAcceptanceScale * profile.AcceptanceWeight
		score += p.handValue(obs, remaining, obs.Melds, budget) * personaValueScale * profile.TaiWeight
		score -= discardRisk(item, obs, budget, winLocked) * personaRiskScale * profile.RiskWeight * context

		// Keeping an exit: the §6.3 preference for still holding a
		// lower-risk tile after this discard, not merely for this discard
		// being safe.
		exits := safeCount
		if safe[item.ID] {
			exits--
		}
		if exits > 0 {
			score += personaReserveScale * profile.SafeReserveValue
		}

		// Shape preference. A persona that likes triplets does not only
		// claim differently, it *keeps* differently: §6.5 has Thunder Tiger
		// holding pairs and lone scoring Honors longer and breaking
		// sequence fragments sooner. Without this the Chow and Pong biases
		// would only ever surface on the comparatively rare turns where a
		// claim is legal, and the persona would be invisible for most of a
		// hand.
		pairs, runs := blockShape(remaining)
		score += (profile.PongBias*float64(pairs) + profile.ChowBias*float64(runs)) * personaShapeScale

		if target != patternNone {
			// Pattern loyalty rides on the persona's Tai weight, because
			// pursuing a pattern is what valuing Tai actually looks like in
			// a discard.
			score -= float64(patternDeficiency(remaining, obs.Melds, target)) * personaPatternScale * profile.TaiWeight
		}
		if folding && safe[item.ID] {
			score += personaFoldScale * profile.RiskWeight
		}
		scored = append(scored, scoredAction{id: item.ID, score: score, tile: item})
	}

	choice := p.pick(scored, obs, seed)
	return p.stamp(newDecision(p.Difficulty(), seed, obs, Action{Kind: ActionDiscard, TileID: choice.id}, reactionDelay(seed, min, max)))
}

// ---- Claim ------------------------------------------------------------

func (p personaPolicy) DecideClaim(obs Observation, options ClaimOptions, seed uint64) Decision {
	if decision, won := decideWinOrPass(p.Difficulty(), obs, options, seed); won {
		return p.stamp(decision)
	}
	min, max := reactionRange(p.Difficulty())
	reaction := reactionDelay(seed, min, max)
	budget := unseenBudget(VisibleCounts(obs))
	target := bestPattern(obs, p.persona.Profile.patternOrder(), p.persona.Profile.Commitment, budget)
	profile := p.persona.Profile

	// Passing is the reference: the hand exactly as it stands.
	candidates := []scoredAction{{
		id:     "pass",
		score:  p.claimScore(obs, claimResult{hand: obs.Hand, melds: obs.Melds}, budget, target, 0, false),
		action: Action{Kind: ActionPass},
	}}

	if options.CanKong {
		candidates = append(candidates, scoredAction{
			id:     "kong",
			score:  p.claimScore(obs, kongClaimResult(obs, options.Discard), budget, target, profile.ClaimBias+profile.KongBias, true),
			action: Action{Kind: ActionKong},
		})
	}
	if options.CanPong {
		candidates = append(candidates, scoredAction{
			id:     "pong",
			score:  p.claimScore(obs, pongClaimResult(obs, options.Discard), budget, target, profile.ClaimBias+profile.PongBias, true),
			action: Action{Kind: ActionPong},
		})
	}
	for _, set := range options.ChowSets {
		hand := withoutTile(withoutTile(append([]rulesengine.Tile(nil), obs.Hand...), set[0]), set[1])
		chowTiles := append(tilesByID(obs.Hand, set[0], set[1]), options.Discard)
		melds := append(append([]rulesengine.Meld(nil), obs.Melds...), rulesengine.Meld{Type: rulesengine.MeldChow, Tiles: chowTiles, Claimed: true})
		candidates = append(candidates, scoredAction{
			id:     "chow:" + set[0] + "+" + set[1],
			score:  p.claimScore(obs, claimResult{hand: hand, melds: melds}, budget, target, profile.ClaimBias+profile.ChowBias, true),
			action: Action{Kind: ActionChow, TileIDs: []string{set[0], set[1]}},
		})
	}

	// A claim is a yes/no judgement rather than a ranking among near-equals,
	// so the difficulty's mistake band does not apply: taking the
	// second-best claim would mean claiming when the persona's own
	// evaluation says to pass.
	best := bestScored(candidates)
	return p.stamp(newDecision(p.Difficulty(), seed, obs, best.action, reaction))
}

// claimScore evaluates the hand a claim would leave behind. bias is the
// persona's willingness to make this particular claim shape, and opens
// records whether the claim exposes a meld — the cost Silent Crane weighs
// most heavily and Swift Sparrow barely notices.
func (p personaPolicy) claimScore(obs Observation, result claimResult, budget map[string]int, target patternTarget, bias float64, opens bool) float64 {
	profile := p.persona.Profile
	score := -float64(deficiency(result.hand, result.melds)) * personaCompletionScale * profile.CompletionWeight
	score += float64(liveAcceptance(result.hand, result.melds, budget)) * personaAcceptanceScale * profile.AcceptanceWeight
	score += p.handValue(obs, result.hand, result.melds, budget) * personaValueScale * profile.TaiWeight
	if target != patternNone {
		score -= float64(patternDeficiency(result.hand, result.melds, target)) * personaPatternScale * profile.TaiWeight
	}
	if opens {
		score += bias * personaClaimScale
		score -= personaConcealmentScale * profile.ConcealmentValue
	}
	return score
}

// ---- Self-turn Kong ---------------------------------------------------

func (p personaPolicy) DecideSelfKong(obs Observation, options []SelfKongOption, seed uint64) Decision {
	min, max := reactionRange(p.Difficulty())
	reaction := reactionDelay(seed, min, max)
	if len(options) == 0 {
		return p.stamp(newDecision(p.Difficulty(), seed, obs, Action{Kind: ActionPass}, reaction))
	}
	profile := p.persona.Profile
	winLocked := map[rulesengine.Seat]bool{}
	threatened := maxOpponentMelds(obs) >= hardFoldMeldThreshold

	for _, option := range options {
		if !option.Added {
			// A concealed Kong does not open the hand, which is why even
			// Silent Crane takes them (§6.6). The one real cost is spending
			// the hand's only pair, and the persona's Kong appetite decides
			// whether it is paid.
			if !konganksOnlyPair(obs.Hand, option.TileIDs) || profile.KongBias > 0.5 {
				return p.stamp(selfKongDecision(p.Difficulty(), obs, option, seed, reaction))
			}
			continue
		}
		// An added Kong announces the tile type and exposes §5.7 robbing
		// risk, which the same provably-safe solver used for discards
		// measures: a robbed added Kong is structurally a discard-claim.
		added := tileByIDValue(obs.Hand, option.TileID)
		if IsFullySafe(EvaluateDiscardSafety(obs, added, winLocked)) {
			return p.stamp(selfKongDecision(p.Difficulty(), obs, option, seed, reaction))
		}
		// Not proven safe: the persona's Kong appetite decides whether the
		// extra Tai and the replacement draw are worth the exposure. A
		// visible threat raises the bar for everyone.
		appetite := profile.KongBias - profile.RiskWeight*0.5
		if threatened {
			appetite -= profile.ContextSensitivity * 0.5
		}
		if appetite > 0 {
			return p.stamp(selfKongDecision(p.Difficulty(), obs, option, seed, reaction))
		}
	}
	return p.stamp(newDecision(p.Difficulty(), seed, obs, Action{Kind: ActionPass}, reaction))
}

// ---- Shared helpers ---------------------------------------------------

// scoredAction is one candidate action with its persona score. tile is set
// only for discards, where the difficulty mistake band reads connectivity.
type scoredAction struct {
	id     string
	score  float64
	action Action
	tile   rulesengine.Tile
}

// bestScored returns the highest-scoring candidate, breaking ties on ID so
// the result is deterministic before any seeded choice (§11.4).
func bestScored(candidates []scoredAction) scoredAction {
	best := candidates[0]
	for _, candidate := range candidates[1:] {
		if candidate.score > best.score || (candidate.score == best.score && candidate.id < best.id) {
			best = candidate
		}
	}
	return best
}

// pick applies the wrapped difficulty's selection rule to the persona's own
// ranking. This is what keeps persona and difficulty orthogonal (§2.3): a
// Hard Swift Sparrow reliably plays the rush line it chose, while an Easy
// one chooses the same line and then executes it unreliably — rather than
// an Easy bot quietly reverting to a different style.
func (p personaPolicy) pick(scored []scoredAction, obs Observation, seed uint64) scoredAction {
	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		return scored[i].id < scored[j].id
	})
	if len(scored) == 1 {
		return scored[0]
	}
	rng := newSeedSequence(seed).rngForStep(0)
	switch p.Difficulty() {
	case Hard:
		return scored[0]
	case Medium:
		if rng.Float64() < mediumTopPickProbability {
			return scored[0]
		}
		return scored[1]
	default: // Easy
		if rng.Float64() < easyTopSetProbability {
			return scored[0]
		}
		// Outside its top pick Easy is still not purely random: it leans
		// toward the most isolated remaining tile, exactly as easyPolicy
		// does over the efficiency reference.
		rest := scored[1:]
		weights := make([]int, len(rest))
		total := 0
		for index, candidate := range rest {
			weight := len(rest) - index
			if connectivityScore(withoutTile(obs.Hand, candidate.id), candidate.tile) == 0 {
				weight += len(rest)
			}
			weights[index] = weight
			total += weight
		}
		pick := rng.Intn(total)
		for index, weight := range weights {
			if pick < weight {
				return rest[index]
			}
			pick -= weight
		}
		return rest[len(rest)-1]
	}
}

// handValue is the §3.2 "expected Tai" term: the precise weighted estimate
// once the hand is tenpai, and the cheap structural proxy before that.
func (p personaPolicy) handValue(obs Observation, hand []rulesengine.Tile, melds []rulesengine.Meld, budget map[string]int) float64 {
	value, tenpai := estimateHandValue(hand, melds, obs.BonusTiles, obs.Seat, obs.PrevailingWind, budget)
	if !tenpai {
		return potentialValueProxy(hand, melds)
	}
	if obs.Seat == obs.Dealer {
		value += float64(1+2*obs.Continuation) * p.persona.Profile.ContextSensitivity
	}
	return value
}

// contextScale is the §4 context_sensitivity modifier: how much a late wall
// and a visibly threatening opponent amplify the persona's risk aversion.
// It is 1.0 on a quiet early board for every persona.
func (p personaPolicy) contextScale(obs Observation) float64 {
	late := 0.0
	if obs.DrawableRemaining < hardFoldWallThreshold {
		late = float64(hardFoldWallThreshold-obs.DrawableRemaining) / float64(hardFoldWallThreshold)
	}
	threat := float64(maxOpponentMelds(obs)) / float64(taiwaneseSets)
	return 1 + p.persona.Profile.ContextSensitivity*(late+threat)
}

// shouldFold is §11.3's fold trigger plus the earlier one a Guard-class
// persona uses: Stone Lion abandons a weak hand on a visible threat without
// waiting for the wall to run down (§6.3).
func (p personaPolicy) shouldFold(obs Observation) bool {
	if maxOpponentMelds(obs) < hardFoldMeldThreshold {
		return false
	}
	if obs.DrawableRemaining < hardFoldWallThreshold {
		return true
	}
	return p.persona.Profile.RiskWeight >= personaEarlyFoldRiskWeight
}

// maxOpponentMelds is the public threat proxy shared across this file: more
// exposed melds means fewer concealed groups left to complete (§11.2 allows
// nothing better than this).
func maxOpponentMelds(obs Observation) int {
	most := 0
	for _, opponent := range obs.Opponents {
		if len(opponent.Melds) > most {
			most = len(opponent.Melds)
		}
	}
	return most
}

// stamp records which persona produced a decision, so a replay can tell a
// retuned Swift Sparrow from the one that actually played the hand (§11.4).
func (p personaPolicy) stamp(decision Decision) Decision {
	decision.Persona = p.persona.ID
	decision.PersonaVersion = PersonaVersion
	return decision
}
