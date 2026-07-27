package progression

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/gameswithout/mahjong/rulesengine"
)

var ErrNotInitialized = errors.New("progression is not initialized")

// Player is one account's standing: derived level, what it has unlocked, and
// what is next. Level and rewards are always derived from lifetime XP rather
// than stored, so §12.2's "recompute level from lifetime XP if the curve
// changes" needs no migration.
type Player struct {
	UserID     string
	LifetimeXP int
	Level      Level
	Earned     []LevelReward
	Next       *LevelReward
	Onboarding *OnboardingState
}

func PlayerFromXP(userID string, lifetimeXP int) Player {
	level := LevelForXP(lifetimeXP)
	return Player{
		UserID:     userID,
		LifetimeXP: lifetimeXP,
		Level:      level,
		Earned:     EarnedRewards(level.Level),
		Next:       NextReward(level.Level),
	}
}

type Repository interface {
	// AwardXP applies one award idempotently under awardID and returns the
	// player's standing afterwards. An awardID already present must move no XP
	// and report the award as already applied.
	AwardXP(
		ctx context.Context,
		userID string,
		runtimeID string,
		award HandAward,
	) (Player, HandAward, bool, error)
	RecordOnboarding(
		ctx context.Context,
		userID string,
		outcome OnboardingOutcome,
		award HandAward,
	) (Player, HandAward, OnboardingState, bool, error)
	PlayerProgression(ctx context.Context, userID string) (Player, error)
	TakenOverMajority(ctx context.Context, userID, runtimeID string) (bool, error)
}

type Coordinator struct {
	repository Repository
}

func NewCoordinator(repository Repository) *Coordinator {
	return &Coordinator{repository: repository}
}

// HandResult is what the caller needs to show a post-match XP panel: the award
// this hand earned, and the standing it produced.
type HandXPResult struct {
	Award  HandAward
	Player Player
	// AlreadyAwarded is true when this hand had already been priced — the poll
	// loop re-projecting a finished hand, not a second hand.
	AlreadyAwarded bool
}

// handAwardID is the §12.1 "server event ID" that makes an award idempotent.
// One hand pays one player once, no matter how many times it is projected.
func handAwardID(runtimeID, userID string) string {
	return fmt.Sprintf("hand:%s:%s", runtimeID, userID)
}

func onboardingAwardID(userID string) string {
	return "onboarding:" + userID
}

// RecordHand prices a completed hand and awards its XP.
//
// Safe to call on every projection of a finished match: the award ID is
// derived from (match, player), so repeats are no-ops that still return the
// current standing.
func (c *Coordinator) RecordHand(
	ctx context.Context,
	userID string,
	runtimeID string,
	view rulesengine.SeatView,
	practice bool,
) (*HandXPResult, error) {
	if c == nil || c.repository == nil {
		return nil, nil
	}
	userID = strings.TrimSpace(userID)
	runtimeID = strings.TrimSpace(runtimeID)
	if userID == "" || runtimeID == "" {
		return nil, fmt.Errorf("%w: user and match are required", ErrNotInitialized)
	}

	outcome, complete := OutcomeFromView(view, practice, false)
	if !complete {
		return nil, nil
	}
	if !practice {
		takenOverMajority, err := c.repository.TakenOverMajority(ctx, userID, runtimeID)
		if err != nil {
			return nil, err
		}
		outcome.TakenOverMajority = takenOverMajority
	}

	// Storage enforces the Practice cap while holding the player XP row lock.
	// Passing zero here prevents a stale read-then-write cap race between two
	// replicas; HandXP still owns the pure per-hand arithmetic.
	award := HandXP(outcome, 0)
	award.AwardID = handAwardID(runtimeID, userID)
	player, persisted, applied, err := c.repository.AwardXP(
		ctx, userID, runtimeID, award,
	)
	if err != nil {
		return nil, err
	}
	return &HandXPResult{Award: persisted, Player: player, AlreadyAwarded: !applied}, nil
}

type OnboardingOutcome string

const (
	OnboardingCompleted OnboardingOutcome = "completed"
	OnboardingSkipped   OnboardingOutcome = "skipped"
)

func (o OnboardingOutcome) Valid() bool {
	return o == OnboardingCompleted || o == OnboardingSkipped
}

type OnboardingState struct {
	Outcome    OnboardingOutcome
	RecordedAt string
}

// AwardOnboarding grants the one-time §12.1 onboarding XP. Per §10.4 it is
// paid whether the player completed or intentionally skipped the tutorial, and
// replays grant nothing further — which the award ID enforces.
func (c *Coordinator) AwardOnboarding(
	ctx context.Context,
	userID string,
	outcome OnboardingOutcome,
) (*HandXPResult, error) {
	if c == nil || c.repository == nil {
		return nil, ErrNotInitialized
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, fmt.Errorf("%w: user ID is required", ErrNotInitialized)
	}
	if !outcome.Valid() {
		return nil, fmt.Errorf("%w: onboarding outcome is required", ErrNotInitialized)
	}
	award := OnboardingAward()
	award.AwardID = onboardingAwardID(userID)
	player, persisted, state, applied, err := c.repository.RecordOnboarding(
		ctx, userID, outcome, award,
	)
	if err != nil {
		return nil, err
	}
	player.Onboarding = &state
	return &HandXPResult{Award: persisted, Player: player, AlreadyAwarded: !applied}, nil
}

func (c *Coordinator) Player(ctx context.Context, userID string) (Player, error) {
	if c == nil || c.repository == nil {
		return Player{}, ErrNotInitialized
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return Player{}, fmt.Errorf("%w: user ID is required", ErrNotInitialized)
	}
	return c.repository.PlayerProgression(ctx, userID)
}
