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

// TestPersonaPolicyIsGuardedRegardlessOfDifficulty covers the gap a persona
// opens in the §11.4 budget: a persona over Medium reports Medium but runs
// the full evaluator, so waving it through on "not Hard" would leave the
// most expensive policy in the package entirely untimed.
func TestPersonaPolicyIsGuardedRegardlessOfDifficulty(t *testing.T) {
	obs := personaObservation(t)
	persona := personaFixture(t, "jade-dragon")
	for _, base := range []Policy{NewEasyPolicy(), NewMediumPolicy(), NewHardPolicy()} {
		policy := NewPersonaPolicy(base, persona)
		if !needsBudgetGuard(policy) {
			t.Fatalf("persona over %s is not budget-guarded", base.Difficulty())
		}
		// A budget no real computation can meet forces the fallback tier,
		// which is the neutral Medium policy — not a half-computed style.
		discard := decideDiscardWithBudget(policy, obs, 42, time.Nanosecond)
		if discard.Persona != "" {
			t.Errorf("persona over %s: timed-out decision kept persona %q, want the neutral fallback", base.Difficulty(), discard.Persona)
		}
		if discard.Difficulty != Medium {
			t.Errorf("persona over %s: fallback difficulty = %s, want Medium", base.Difficulty(), discard.Difficulty)
		}
	}
}

// TestPersonaDecisionsFitTheBudget measures the real cost on a full mid-hand
// position. The evaluator adds a generalized deficiency search and a
// live-acceptance sweep per candidate, so §11.4's 250ms budget needs to be
// shown to hold rather than assumed.
func TestPersonaDecisionsFitTheBudget(t *testing.T) {
	obs := personaObservation(t)
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	for _, id := range roster.IDs() {
		persona, _ := roster.ByID(id)
		policy := NewPersonaPolicy(NewHardPolicy(), persona)
		start := time.Now()
		policy.DecideDiscard(obs, 1)
		if elapsed := time.Since(start); elapsed > DecisionBudget {
			t.Errorf("%s discard took %s, over the %s budget", id, elapsed, DecisionBudget)
		}
	}
}

// TestBudgetGuardSurvivesWrapping is the regression for how the guard used
// to be selected. It asked whether the policy *was* a personaPolicy, so
// wrapping one in anything — a decorator, an instrumented policy, a future
// styled wrapper — made the assertion fail and silently ran the most
// expensive policy in the package with no timeout at all. Naming the cheap
// policies instead means an unrecognised policy is guarded rather than
// waved through.
func TestBudgetGuardSurvivesWrapping(t *testing.T) {
	persona := personaFixture(t, "jade-dragon")
	wrapped := passthroughPolicy{inner: NewPersonaPolicy(NewMediumPolicy(), persona)}

	if !needsBudgetGuard(wrapped) {
		t.Fatal("a wrapped persona policy is not budget-guarded; the guard must not depend on the concrete type surviving decoration")
	}
	if !needsBudgetGuard(NewHardPolicy()) {
		t.Fatal("Hard is not budget-guarded")
	}
	// The two cheap policies stay unwrapped, including because Medium is the
	// fallback tier and guarding it would be circular.
	if needsBudgetGuard(NewEasyPolicy()) || needsBudgetGuard(NewMediumPolicy()) {
		t.Fatal("bare Easy/Medium should run without the goroutine/select overhead")
	}
}

// passthroughPolicy adds nothing but a layer of indirection — which is
// exactly what used to defeat the guard.
type passthroughPolicy struct{ inner Policy }

func (p passthroughPolicy) Difficulty() Difficulty { return p.inner.Difficulty() }
func (p passthroughPolicy) DecideDiscard(obs Observation, seed uint64) Decision {
	return p.inner.DecideDiscard(obs, seed)
}
func (p passthroughPolicy) DecideClaim(obs Observation, options ClaimOptions, seed uint64) Decision {
	return p.inner.DecideClaim(obs, options, seed)
}
func (p passthroughPolicy) DecideSelfKong(obs Observation, options []SelfKongOption, seed uint64) Decision {
	return p.inner.DecideSelfKong(obs, options, seed)
}
