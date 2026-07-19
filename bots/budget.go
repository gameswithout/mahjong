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

// DecideDiscard runs policy.DecideDiscard under the §11.4 decision budget,
// falling back to the Medium policy's decision if it is exceeded. Easy and
// Medium are already simple bounded heuristics with no meaningful risk of
// exceeding budget, so they run directly without the goroutine/select
// overhead.
func DecideDiscard(policy Policy, obs Observation, seed uint64) Decision {
	return decideDiscardWithBudget(policy, obs, seed, DecisionBudget)
}

func decideDiscardWithBudget(policy Policy, obs Observation, seed uint64, budget time.Duration) Decision {
	if policy.Difficulty() != Hard {
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
	if policy.Difficulty() != Hard {
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
	if policy.Difficulty() != Hard {
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
