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

// StatsMirror projects §12.3 achievement statistics into AGS. Optional: the
// service runs without it, awarding XP as usual and simply not feeding
// achievements.
type StatsMirror interface {
	RecordHandStats(ctx context.Context, userID string, updates []StatUpdate) error
	// ReadStats returns the player's current values for the requested codes.
	// Codes the player has never moved are absent rather than zero.
	ReadStats(ctx context.Context, userID string, statCodes []string) (map[string]float64, error)
}

// AchievementReader reports which achievements AGS has unlocked for a player.
// AGS decides unlocks by evaluating the statistics StatsMirror writes; this
// service only reads the result and pays the §12.3 XP for it.
type AchievementReader interface {
	UnlockedAchievementCodes(ctx context.Context, userID string) ([]string, error)
}

type Coordinator struct {
	repository   Repository
	stats        StatsMirror
	achievements AchievementReader
	// onStatsError reports a failed stats projection or achievement sweep.
	// Injected so the caller owns logging and this package stays free of a
	// logger dependency.
	onStatsError func(error)
}

func NewCoordinator(repository Repository) *Coordinator {
	return &Coordinator{repository: repository}
}

// SetStatsMirror enables the §12.3 achievement statistics projection.
func (c *Coordinator) SetStatsMirror(stats StatsMirror, onError func(error)) {
	if c == nil {
		return
	}
	c.stats = stats
	c.onStatsError = onError
}

// SetAchievementReader enables §12.3 achievement XP. Without it, achievements
// still unlock in AGS — they simply pay no XP, which is the behaviour before
// this was wired.
func (c *Coordinator) SetAchievementReader(reader AchievementReader) {
	if c == nil {
		return
	}
	c.achievements = reader
}

// awardUnlockedAchievements pays the §12.3 XP for achievements AGS has
// unlocked and this player has not yet been paid for.
//
// Idempotency is the award ID, not the sweep: AGS reports every unlocked
// achievement on every call, including ones paid weeks ago, so the sweep is
// deliberately dumb and AwardXP decides what is new. Returns the awards that
// actually moved XP.
func (c *Coordinator) awardUnlockedAchievements(
	ctx context.Context,
	userID string,
) ([]HandAward, error) {
	codes, err := c.achievements.UnlockedAchievementCodes(ctx, userID)
	if err != nil {
		return nil, err
	}

	var granted []HandAward
	for _, code := range codes {
		achievement, known := AchievementByCode(code)
		if !known {
			// A code this build does not know about — an older or newer
			// config, or one added by hand. Paying zero would be
			// indistinguishable from having paid, so skip it loudly instead.
			if c.onStatsError != nil {
				c.onStatsError(fmt.Errorf(
					"AGS unlocked unknown achievement %q for user %s; no XP awarded",
					code, userID,
				))
			}
			continue
		}
		_, persisted, applied, awardErr := c.repository.AwardXP(
			ctx, userID, "", AchievementAward(achievement, userID),
		)
		if awardErr != nil {
			return granted, awardErr
		}
		if applied {
			granted = append(granted, persisted)
		}
	}
	return granted, nil
}

// HandResult is what the caller needs to show a post-match XP panel: the award
// this hand earned, and the standing it produced.
type HandXPResult struct {
	Award  HandAward
	Player Player
	// Achievements unlocked by this hand and paid for the first time. Empty on
	// a repeat projection, because their XP was already awarded.
	Achievements []HandAward
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
	var achievements []HandAward
	award := HandXP(outcome, 0)
	award.AwardID = handAwardID(runtimeID, userID)
	player, persisted, applied, err := c.repository.AwardXP(
		ctx, userID, runtimeID, award,
	)
	if err != nil {
		return nil, err
	}

	// Achievement statistics ride the XP award's idempotency rather than
	// carrying their own. AwardXP reports whether this call is the one that
	// applied the award, and only that call projects stats — without it, the
	// projection poll that repeats a finished hand would increment every
	// achievement counter forever.
	if applied && c.stats != nil {
		if updates := HandStats(outcome, view); len(updates) > 0 {
			// A failed projection must not fail the hand or undo the XP. The
			// ledger is authoritative; AGS is a downstream mirror, exactly as
			// the Jade wallet mirror is.
			if statsErr := c.stats.RecordHandStats(ctx, userID, updates); statsErr != nil {
				if c.onStatsError != nil {
					c.onStatsError(statsErr)
				}
			} else if c.achievements != nil {
				// Only sweep when the stats actually landed. AGS evaluates
				// unlocks from those values, so sweeping after a failed write
				// asks it about a state it never saw.
				unlocked, sweepErr := c.awardUnlockedAchievements(ctx, userID)
				if sweepErr != nil && c.onStatsError != nil {
					c.onStatsError(sweepErr)
				}
				if len(unlocked) > 0 {
					// Re-read so the caller sees the level the achievement XP
					// produced, not the pre-achievement standing.
					if refreshed, refreshErr := c.repository.PlayerProgression(ctx, userID); refreshErr == nil {
						player = refreshed
					}
					achievements = unlocked
				}
			}
		}
	}

	return &HandXPResult{
		Award:          persisted,
		Player:         player,
		AlreadyAwarded: !applied,
		Achievements:   achievements,
	}, nil
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

// DashboardStatCodes are the counters the §P2.3 statistics dashboard reads.
// Kept beside the achievement codes so the two cannot drift: every one of
// these is written by HandStats above.
func DashboardStatCodes() []string {
	return []string{
		StatPublicHandsCompleted,
		StatPublicHandsWon,
		StatZimoWins,
		StatPublicHandsDealtIn,
		StatPublicHandsTing,
		StatKongsDeclared,
		StatHighestRawTai,
	}
}

// PlayerStatistics returns the player's dashboard counters.
//
// Unlike the projection on the write path, this is not optional-and-ignored:
// the player asked to see their record, so a namespace running without the
// statistics mirror gets an error it can show rather than a screen of zeroes
// that looks like a player who has never won.
func (c *Coordinator) PlayerStatistics(
	ctx context.Context,
	userID string,
) (map[string]float64, error) {
	if c == nil || c.stats == nil {
		return nil, ErrNotInitialized
	}
	return c.stats.ReadStats(ctx, userID, DashboardStatCodes())
}
