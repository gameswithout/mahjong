package rulesengine

import (
	"testing"
	"time"
)

func TestNewDeadlineConfigPresetsMatchSpecTable(t *testing.T) {
	cases := []struct {
		name          string
		context       DecisionContext
		bamboo        bool
		privateChoice int
		wantTurn      int
		wantIntercept int
	}{
		{"tutorial-no-timer", ContextTutorial, false, 0, 0, 0},
		{"ai-practice-no-timer-by-default", ContextAIPractice, false, 0, 0, 0},
		{"public-quick-play-bamboo", ContextPublicQuickPlay, true, 0, 15, 10},
		{"public-quick-play-other-lobby", ContextPublicQuickPlay, false, 0, 15, 7},
		{"ranked-full-rotation", ContextRankedFullRotation, false, 0, 12, 5},
		{"private-12", ContextPrivateFullRotation, false, 12, 12, 6},
		{"private-15", ContextPrivateFullRotation, false, 15, 15, 8},
		{"private-20", ContextPrivateFullRotation, false, 20, 20, 10},
		{"private-30", ContextPrivateFullRotation, false, 30, 30, 15},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			cfg, err := NewDeadlineConfig(testCase.context, testCase.bamboo, testCase.privateChoice)
			if err != nil {
				t.Fatalf("NewDeadlineConfig() error = %v", err)
			}
			if cfg.TurnSeconds != testCase.wantTurn || cfg.InterceptSeconds != testCase.wantIntercept {
				t.Fatalf("cfg = %+v, want turn=%d intercept=%d", cfg, testCase.wantTurn, testCase.wantIntercept)
			}
			if cfg.AnimationAllowance != AnimationBudget {
				t.Fatalf("AnimationAllowance = %s, want the standard %s budget", cfg.AnimationAllowance, AnimationBudget)
			}
		})
	}
}

func TestNewDeadlineConfigRejectsInvalidPrivateChoice(t *testing.T) {
	for _, invalid := range []int{0, 10, 13, 25, 31, -5} {
		if _, err := NewDeadlineConfig(ContextPrivateFullRotation, false, invalid); err == nil {
			t.Fatalf("private choice %d: want error, got nil", invalid)
		}
	}
}

func TestNewDeadlineConfigRejectsUnknownContext(t *testing.T) {
	if _, err := NewDeadlineConfig(DecisionContext("unknown"), false, 0); err == nil {
		t.Fatal("want error for unknown context")
	}
}

func TestDeadlineComputationAddsAnimationAllowanceAndCappedRTT(t *testing.T) {
	cfg, err := NewDeadlineConfig(ContextPublicQuickPlay, false, 0)
	if err != nil {
		t.Fatalf("NewDeadlineConfig() error = %v", err)
	}
	dispatch := time.Date(2026, 7, 19, 12, 0, 0, 0, time.UTC)

	// Half-RTT well under the cap: full contribution applies.
	got := cfg.TurnDeadline(dispatch, 100*time.Millisecond)
	want := dispatch.Add(AnimationBudget).Add(15 * time.Second).Add(100 * time.Millisecond)
	if got == nil || !got.Equal(want) {
		t.Fatalf("TurnDeadline() = %v, want %v", got, want)
	}

	// Half-RTT over the 500ms cap: contribution is clamped.
	got = cfg.TurnDeadline(dispatch, 900*time.Millisecond)
	want = dispatch.Add(AnimationBudget).Add(15 * time.Second).Add(MaxRTTContribution)
	if got == nil || !got.Equal(want) {
		t.Fatalf("TurnDeadline() with over-cap RTT = %v, want %v (capped)", got, want)
	}

	// Negative RTT (clock skew edge case) never subtracts time.
	got = cfg.TurnDeadline(dispatch, -50*time.Millisecond)
	want = dispatch.Add(AnimationBudget).Add(15 * time.Second)
	if got == nil || !got.Equal(want) {
		t.Fatalf("TurnDeadline() with negative RTT = %v, want %v (floored at zero)", got, want)
	}
}

func TestDeadlineNoTimerContextReturnsNil(t *testing.T) {
	cfg, err := NewDeadlineConfig(ContextTutorial, false, 0)
	if err != nil {
		t.Fatalf("NewDeadlineConfig() error = %v", err)
	}
	dispatch := time.Now()
	if deadline := cfg.TurnDeadline(dispatch, 0); deadline != nil {
		t.Fatalf("TurnDeadline() = %v, want nil for a no-timer context", deadline)
	}
	if deadline := cfg.InterceptDeadline(dispatch, 0); deadline != nil {
		t.Fatalf("InterceptDeadline() = %v, want nil for a no-timer context", deadline)
	}
}

func TestInterceptDeadlineOrSentinelIsFarInTheFutureForNoTimerContext(t *testing.T) {
	cfg, err := NewDeadlineConfig(ContextTutorial, false, 0)
	if err != nil {
		t.Fatalf("NewDeadlineConfig() error = %v", err)
	}
	dispatch := time.Now()
	deadline := cfg.interceptDeadlineOrSentinel(dispatch, 0)
	if !deadline.After(dispatch.Add(time.Hour)) {
		t.Fatalf("sentinel deadline = %v, want well beyond an hour from dispatch", deadline)
	}
}
