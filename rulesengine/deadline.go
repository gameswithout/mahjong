package rulesengine

import (
	"errors"
	"fmt"
	"time"
)

// DecisionContext selects which §5.10 timing preset applies to a match. A
// match's context is decided once at creation and its DeadlineConfig is
// held for the match's lifetime — "An active match keeps the values with
// which it started" even if live configuration later changes the approved
// bounds for new matches.
type DecisionContext string

const (
	ContextTutorial            DecisionContext = "tutorial"
	ContextAIPractice          DecisionContext = "ai_practice"
	ContextPublicQuickPlay     DecisionContext = "public_quick_play"
	ContextRankedFullRotation  DecisionContext = "ranked_full_rotation"
	ContextPrivateFullRotation DecisionContext = "private_full_rotation"
)

// AnimationBudget is the standard animation budget §5.10/§9.11 bounds the
// per-action animation allowance by.
const AnimationBudget = 600 * time.Millisecond

// MaxRTTContribution is the §5.10 cap on how much of a match's largest
// eligible player's smoothed half-round-trip estimate can extend a
// deadline: "base time plus the largest eligible player's smoothed
// half-round-trip estimate, capped at 500 ms."
const MaxRTTContribution = 500 * time.Millisecond

var ErrInvalidDeadlineConfig = errors.New("invalid deadline configuration")

// DeadlineConfig captures one match's fixed §5.10 timing values.
type DeadlineConfig struct {
	// TurnSeconds is the combined draw+discard decision time for the active
	// seat. Zero means no timer (Tutorial; AI Practice without the optional
	// training timer).
	TurnSeconds int
	// InterceptSeconds is the claim/interception decision time (Chow, Pong,
	// Kong, Win, and robbing an added Kong all share this window). Zero
	// means no timer.
	InterceptSeconds int
	// AnimationAllowance is added before the timed clock starts (§5.10),
	// identical for every seat and never varying with an individual
	// player's animation-speed or Reduced Motion settings. Bounded by
	// AnimationBudget.
	AnimationAllowance time.Duration
}

// NewDeadlineConfig builds the §5.10 preset for context.
//
// bambooCourtyard only matters for ContextPublicQuickPlay: Bamboo
// Courtyard's interception window is 10s instead of the usual 7s ("The
// longer Bamboo interception window exists because claim decisions are the
// hardest beginner moment").
//
// privateChoiceSeconds only matters for ContextPrivateFullRotation, where
// the host chooses the turn time from {12, 15, 20, 30}; interception is
// then half that, rounded up.
func NewDeadlineConfig(context DecisionContext, bambooCourtyard bool, privateChoiceSeconds int) (DeadlineConfig, error) {
	cfg := DeadlineConfig{AnimationAllowance: AnimationBudget}
	switch context {
	case ContextTutorial:
		return cfg, nil // no timers
	case ContextAIPractice:
		return cfg, nil // no timer by default; an optional 30s training timer is the caller's choice (set TurnSeconds directly)
	case ContextPublicQuickPlay:
		cfg.TurnSeconds = 15
		if bambooCourtyard {
			cfg.InterceptSeconds = 10
		} else {
			cfg.InterceptSeconds = 7
		}
		return cfg, nil
	case ContextRankedFullRotation:
		cfg.TurnSeconds = 12
		cfg.InterceptSeconds = 5
		return cfg, nil
	case ContextPrivateFullRotation:
		switch privateChoiceSeconds {
		case 12, 15, 20, 30:
		default:
			return DeadlineConfig{}, fmt.Errorf("%w: private turn time must be 12, 15, 20, or 30 seconds, got %d", ErrInvalidDeadlineConfig, privateChoiceSeconds)
		}
		cfg.TurnSeconds = privateChoiceSeconds
		cfg.InterceptSeconds = (privateChoiceSeconds + 1) / 2 // half, rounded up
		return cfg, nil
	default:
		return DeadlineConfig{}, fmt.Errorf("%w: unknown context %q", ErrInvalidDeadlineConfig, context)
	}
}

// TurnDeadline computes the absolute deadline for a draw/discard decision
// dispatched at dispatchTime, given the match's current largest-eligible-
// player half-RTT estimate. Returns nil when this context has no turn
// timer.
func (cfg DeadlineConfig) TurnDeadline(dispatchTime time.Time, maxHalfRTT time.Duration) *time.Time {
	return cfg.deadline(dispatchTime, cfg.TurnSeconds, maxHalfRTT)
}

// InterceptDeadline computes the absolute deadline for a claim/interception
// decision (Chow/Pong/Kong/Win/robbing an added Kong). Returns nil when
// this context has no interception timer.
func (cfg DeadlineConfig) InterceptDeadline(dispatchTime time.Time, maxHalfRTT time.Duration) *time.Time {
	return cfg.deadline(dispatchTime, cfg.InterceptSeconds, maxHalfRTT)
}

func (cfg DeadlineConfig) deadline(dispatchTime time.Time, seconds int, maxHalfRTT time.Duration) *time.Time {
	if seconds <= 0 {
		return nil
	}
	rtt := maxHalfRTT
	if rtt > MaxRTTContribution {
		rtt = MaxRTTContribution
	}
	if rtt < 0 {
		rtt = 0
	}
	allowance := cfg.AnimationAllowance
	if allowance > AnimationBudget {
		allowance = AnimationBudget
	}
	if allowance < 0 {
		allowance = 0
	}
	deadline := dispatchTime.Add(allowance).Add(time.Duration(seconds) * time.Second).Add(rtt)
	return &deadline
}

// noDeadlineSentinel is used where the engine's existing (non-pointer)
// deadline fields need a value even when a context has no real timer (e.g.
// Tutorial): a deadline far enough in the future that it is never reached
// in a live session, so the existing "resolve once every seat responds OR
// the deadline passes" logic reduces to "wait for every seat" without a
// separate nil-deadline code path.
const noDeadlineSentinel = 24 * time.Hour

func (cfg DeadlineConfig) interceptDeadlineOrSentinel(dispatchTime time.Time, maxHalfRTT time.Duration) time.Time {
	if deadline := cfg.InterceptDeadline(dispatchTime, maxHalfRTT); deadline != nil {
		return *deadline
	}
	return dispatchTime.Add(noDeadlineSentinel)
}
