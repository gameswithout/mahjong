package bots

import "time"

// DecisionBudget is the §11.4 250ms server budget for AI decision
// calculation. A decision that does not complete within the budget falls
// back to the Medium policy's decision for the same inputs (§11.4:
// "timeout falls back to the Medium legal policy, then canonical
// auto-discard if needed" — the final canonical-auto-discard tier is the
// match runtime's responsibility once a command deadline is also missed,
// not this package's).
//
// In practice Hard's computation is fast (the safety solver's own
// exhaustive-search step cap already bounds it to low single-digit
// milliseconds even in a pathological worst case — see
// TestSafetyWorstCaseTiming), so this budget is a correctness backstop
// against a future regression, not a limit Hard is expected to graze in
// normal play.
const DecisionBudget = 250 * time.Millisecond

// needsBudgetGuard reports whether a policy runs under the timeout.
//
// It names the policies known to be cheap rather than the ones known to be
// expensive, so anything else — a persona, a future policy, or any wrapper
// around either — is guarded by default. Identifying the expensive ones
// instead is the fragile direction: this previously asked whether the policy
// *was* a personaPolicy, which meant wrapping one in anything at all made
// the assertion fail and silently turned the §11.4 guard off in production.
// A guard that disappears when someone adds a decorator is worse than no
// guard, because nothing looks wrong.
//
// Being wrong in the safe direction costs a goroutine and a select on a
// policy that never needed them. Being wrong in the other direction lets an
// unbounded decision stall a live table.
//
// Bare Easy and Medium are the two exceptions: simple bounded heuristics
// with no meaningful risk of exceeding budget, and the fallback tier itself,
// so guarding Medium with a fallback to Medium would be circular.
//
// The fallback in every case is the §11.4 chain's next tier, the plain
// Medium legal policy. That deliberately drops any persona: a decision the
// style could not produce in time is answered by the neutral policy rather
// than by a half-computed style.
func needsBudgetGuard(policy Policy) bool {
	switch policy.(type) {
	case easyPolicy, mediumPolicy:
		return false
	default:
		return true
	}
}

// DecideDiscard runs policy.DecideDiscard under the §11.4 decision budget,
// falling back to the Medium policy's decision if it is exceeded.
func DecideDiscard(policy Policy, obs Observation, seed uint64) Decision {
	return decideDiscardWithBudget(policy, obs, seed, DecisionBudget)
}

func decideDiscardWithBudget(policy Policy, obs Observation, seed uint64, budget time.Duration) Decision {
	if !needsBudgetGuard(policy) {
		return policy.DecideDiscard(obs, seed)
	}
	result := make(chan Decision, 1)
	go func() { result <- policy.DecideDiscard(obs, seed) }()
	select {
	case decision := <-result:
		return decision
	case <-time.After(budget):
		return NewMediumPolicy().DecideDiscard(obs, seed)
	}
}

// DecideClaim runs policy.DecideClaim under the §11.4 decision budget,
// falling back to Medium on timeout.
func DecideClaim(policy Policy, obs Observation, options ClaimOptions, seed uint64) Decision {
	return decideClaimWithBudget(policy, obs, options, seed, DecisionBudget)
}

func decideClaimWithBudget(policy Policy, obs Observation, options ClaimOptions, seed uint64, budget time.Duration) Decision {
	if !needsBudgetGuard(policy) {
		return policy.DecideClaim(obs, options, seed)
	}
	result := make(chan Decision, 1)
	go func() { result <- policy.DecideClaim(obs, options, seed) }()
	select {
	case decision := <-result:
		return decision
	case <-time.After(budget):
		return NewMediumPolicy().DecideClaim(obs, options, seed)
	}
}

// DecideSelfKong runs policy.DecideSelfKong under the §11.4 decision
// budget, falling back to Medium on timeout.
func DecideSelfKong(policy Policy, obs Observation, options []SelfKongOption, seed uint64) Decision {
	return decideSelfKongWithBudget(policy, obs, options, seed, DecisionBudget)
}

func decideSelfKongWithBudget(policy Policy, obs Observation, options []SelfKongOption, seed uint64, budget time.Duration) Decision {
	if !needsBudgetGuard(policy) {
		return policy.DecideSelfKong(obs, options, seed)
	}
	result := make(chan Decision, 1)
	go func() { result <- policy.DecideSelfKong(obs, options, seed) }()
	select {
	case decision := <-result:
		return decision
	case <-time.After(budget):
		return NewMediumPolicy().DecideSelfKong(obs, options, seed)
	}
}
