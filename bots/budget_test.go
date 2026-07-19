package bots

import (
	"testing"
	"time"
)

// slowPolicy wraps another Policy, sleeping before delegating, to
// deterministically exercise the §11.4 decision-budget fallback without
// depending on genuinely pathological input to make Hard slow.
type slowPolicy struct {
	inner Policy
	sleep time.Duration
}

func (s slowPolicy) Difficulty() Difficulty { return Hard }
func (s slowPolicy) DecideDiscard(obs Observation, seed uint64) Decision {
	time.Sleep(s.sleep)
	return s.inner.DecideDiscard(obs, seed)
}
func (s slowPolicy) DecideClaim(obs Observation, options ClaimOptions, seed uint64) Decision {
	time.Sleep(s.sleep)
	return s.inner.DecideClaim(obs, options, seed)
}
func (s slowPolicy) DecideSelfKong(obs Observation, options []SelfKongOption, seed uint64) Decision {
	time.Sleep(s.sleep)
	return s.inner.DecideSelfKong(obs, options, seed)
}

func TestDecisionBudgetFallsBackToMediumOnTimeout(t *testing.T) {
	obs := sampleObservation()
	slow := slowPolicy{inner: NewHardPolicy(), sleep: 50 * time.Millisecond}
	tinyBudget := 5 * time.Millisecond

	discard := decideDiscardWithBudget(slow, obs, 42, tinyBudget)
	if discard.Difficulty != Medium {
		t.Fatalf("discard fallback difficulty = %s, want Medium", discard.Difficulty)
	}
	wantDiscard := NewMediumPolicy().DecideDiscard(obs, 42)
	if discard.Action.TileID != wantDiscard.Action.TileID {
		t.Fatalf("fallback discard = %s, want Medium's own answer %s", discard.Action.TileID, wantDiscard.Action.TileID)
	}

	claimOptions := ClaimOptions{CanPong: true}
	claim := decideClaimWithBudget(slow, obs, claimOptions, 42, tinyBudget)
	if claim.Difficulty != Medium {
		t.Fatalf("claim fallback difficulty = %s, want Medium", claim.Difficulty)
	}

	kongOptions := []SelfKongOption{{Added: true, TileID: "bamboo-9-2"}}
	kong := decideSelfKongWithBudget(slow, obs, kongOptions, 42, tinyBudget)
	if kong.Difficulty != Medium {
		t.Fatalf("self-Kong fallback difficulty = %s, want Medium", kong.Difficulty)
	}
}

func TestDecisionBudgetUsesRealDecisionWhenFast(t *testing.T) {
	obs := sampleObservation()
	hard := NewHardPolicy()
	generousBudget := DecisionBudget

	discard := decideDiscardWithBudget(hard, obs, 42, generousBudget)
	if discard.Difficulty != Hard {
		t.Fatalf("difficulty = %s, want Hard when well within budget", discard.Difficulty)
	}
	want := hard.DecideDiscard(obs, 42)
	if discard.Action.TileID != want.Action.TileID {
		t.Fatalf("budget wrapper changed the decision: got %s, want %s", discard.Action.TileID, want.Action.TileID)
	}
}

func TestDecisionBudgetPassesThroughEasyAndMediumUnwrapped(t *testing.T) {
	obs := sampleObservation()
	for _, policy := range []Policy{NewEasyPolicy(), NewMediumPolicy()} {
		got := decideDiscardWithBudget(policy, obs, 42, time.Nanosecond) // budget so tiny only a pass-through survives
		if got.Difficulty != policy.Difficulty() {
			t.Fatalf("%s: wrapper altered a non-Hard policy's decision under a near-zero budget (difficulty=%s)", policy.Difficulty(), got.Difficulty)
		}
	}
}
