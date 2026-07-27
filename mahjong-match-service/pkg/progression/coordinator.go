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
		awardID string,
		userID string,
		runtimeID string,
		source string,
		amount int,
	) (Player, bool, error)
	// PracticeXPToday is the Practice XP already granted this UTC day, for the
	// §12.1 daily cap.
	PracticeXPToday(ctx context.Context, userID string) (int, error)
	PlayerProgression(ctx context.Context, userID string) (Player, error)
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

	outcome, complete := OutcomeFromView(view, practice)
	if !complete {
		return nil, nil
	}

	// The Practice cap is read before pricing. A repeat call re-reads it and
	// prices the same hand again, but the award ID makes the write a no-op, so
	// the recomputed figure is never applied twice.
	practiceXPToday := 0
	if outcome.Practice {
		today, err := c.repository.PracticeXPToday(ctx, userID)
		if err != nil {
			return nil, err
		}
		practiceXPToday = today
	}

	award := HandXP(outcome, practiceXPToday)
	player, applied, err := c.repository.AwardXP(
		ctx, handAwardID(runtimeID, userID), userID, runtimeID, award.Source, award.Total,
	)
	if err != nil {
		return nil, err
	}
	return &HandXPResult{Award: award, Player: player, AlreadyAwarded: !applied}, nil
}

// AwardOnboarding grants the one-time §12.1 onboarding XP. Per §10.4 it is
// paid whether the player completed or intentionally skipped the tutorial, and
// replays grant nothing further — which the award ID enforces.
func (c *Coordinator) AwardOnboarding(ctx context.Context, userID string) (*HandXPResult, error) {
	if c == nil || c.repository == nil {
		return nil, ErrNotInitialized
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, fmt.Errorf("%w: user ID is required", ErrNotInitialized)
	}
	player, applied, err := c.repository.AwardXP(
		ctx, onboardingAwardID(userID), userID, "", SourceOnboarding, OnboardingXP,
	)
	if err != nil {
		return nil, err
	}
	award := HandAward{
		Source:     SourceOnboarding,
		Total:      OnboardingXP,
		Components: []XPComponent{{Label: "Tutorial", Amount: OnboardingXP}},
	}
	if !applied {
		award.Total = 0
		award.Components = nil
	}
	return &HandXPResult{Award: award, Player: player, AlreadyAwarded: !applied}, nil
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
