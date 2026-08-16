package progression

import (
	"context"
	"errors"
	"fmt"
	"math"
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

// DashboardStatsRepository is the authoritative read side for statistics that
// can be derived from the XP ledger. It is intentionally optional so small
// repository implementations used by rules tests do not need a database-like
// statistics surface.
type DashboardStatsRepository interface {
	PlayerDashboardStatistics(ctx context.Context, userID string) (map[string]float64, error)
}

type MatchHistoryEntry struct {
	MatchID       string
	CompletedAt   string
	Mode          string
	Result        string
	WinKind       string
	WinningTileID string
	RawTai        int
	XPAwarded     int
}

type MatchHistoryRepository interface {
	PlayerMatchHistory(ctx context.Context, userID string, limit int) ([]MatchHistoryEntry, error)
}

// DailyPracticeXPRepository supplies the authoritative UTC-day total used by
// Practice's capped mastery award. It is optional so rules-only repositories
// and older storage adapters continue to support public progression.
type DailyPracticeXPRepository interface {
	PracticeXPToday(ctx context.Context, userID string) (int, error)
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

// AchievementProgressReader is the read side of the player-facing catalog.
// Kept separate from AchievementReader so the hand-award path remains usable
// with a minimal unlock-only reader, while the production AGS reader supports
// both contracts.
type AchievementProgressReader interface {
	AchievementProgress(ctx context.Context, userID string) ([]AchievementProgress, error)
}

// AchievementProgress is AGS's current state for one configured achievement.
type AchievementProgress struct {
	Code     string
	Current  float64
	Unlocked bool
}

// PlayerAchievement merges one fixed product definition with AGS's current
// value. Unavailable launch entries have no AGS row but stay in the result.
type PlayerAchievement struct {
	Achievement Achievement
	Current     float64
	Unlocked    bool
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

func (c *Coordinator) PlayerMatchHistory(
	ctx context.Context,
	userID string,
	limit int,
) ([]MatchHistoryEntry, error) {
	if c == nil || c.repository == nil {
		return nil, ErrNotInitialized
	}
	repository, ok := c.repository.(MatchHistoryRepository)
	if !ok {
		return nil, ErrNotInitialized
	}
	return repository.PlayerMatchHistory(ctx, strings.TrimSpace(userID), limit)
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

// rotationPlacementAwardID keys the §12.1 end-of-match award to the rotation
// and the player, so the poll that repeats a finished rotation pays once.
func rotationPlacementAwardID(rotationRuntimeID, userID string) string {
	return fmt.Sprintf("rotation-placement:%s:%s", rotationRuntimeID, userID)
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
	return c.recordHand(ctx, userID, runtimeID, view, practice, false)
}

// RecordRotationHand pays the §12.1 flat award for one completed Full Rotation
// hand. runtimeID is the *hand's* runtime ID, not the rotation's, so a
// rotation pays for each of its hands rather than once for the match.
//
// Full Rotation is public and ranked, so unlike Practice it feeds statistics
// and can unlock achievements. The placement award is separate and paid once,
// by AwardRotationPlacement, when the match ends.
func (c *Coordinator) RecordRotationHand(
	ctx context.Context,
	userID string,
	handRuntimeID string,
	view rulesengine.SeatView,
) (*HandXPResult, error) {
	return c.recordHand(ctx, userID, handRuntimeID, view, false, true)
}

func (c *Coordinator) recordHand(
	ctx context.Context,
	userID string,
	runtimeID string,
	view rulesengine.SeatView,
	practice bool,
	rotation bool,
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

	practiceXPToday := 0
	if practice {
		if daily, ok := c.repository.(DailyPracticeXPRepository); ok {
			var err error
			practiceXPToday, err = daily.PracticeXPToday(ctx, userID)
			if err != nil {
				return nil, err
			}
		}
	}
	var achievements []HandAward
	// §12.1 scores the two modes differently: Quick Play prices the hand
	// itself, Full Rotation pays a flat rate and settles the rest on final
	// placement, because a hand lost early in a rotation can be the right play
	// for the match.
	award := HandXP(outcome, practiceXPToday)
	if rotation {
		award = RotationHandAward()
	}
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
			if statsErr := c.stats.RecordHandStats(ctx, userID, updates); statsErr != nil && c.onStatsError != nil {
				c.onStatsError(statsErr)
			}
		}
	}

	// The achievement sweep runs on every projection of a completed hand, not
	// only the one that wrote the statistics.
	//
	// AGS evaluates unlocks asynchronously from the stat write, so at the
	// instant the write returns the unlock has usually not happened yet. A
	// sweep bound to that single moment therefore misses its own hand and pays
	// the XP a hand late — verified live on 2026-07-30, where four players who
	// each completed their first public hand ended on 100 XP instead of 200,
	// and a earlier run paid exactly one of four purely on timing.
	//
	// Repeating the sweep is free: the award ID is derived from (achievement,
	// player), so AwardXP pays each unlock once however many times it is seen.
	// The client polls a finished hand while the result screen is up, so the
	// unlock lands within a few seconds and is visible where it belongs.
	// Practice does not advance achievements, so it must not sweep AGS unlocks.
	if c.achievements != nil && !practice {
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

	return &HandXPResult{
		Award:          persisted,
		Player:         player,
		AlreadyAwarded: !applied,
		Achievements:   achievements,
	}, nil
}

// AwardRotationPlacement pays the §12.1 end-of-match award for a completed
// Full Rotation.
//
// Safe to call on every projection of a finished rotation: the award ID is
// derived from (rotation, player), so repeats are no-ops. Positions outside
// first through fourth award nothing, which RotationPlacementAward enforces.
func (c *Coordinator) AwardRotationPlacement(
	ctx context.Context,
	userID string,
	rotationRuntimeID string,
	position int,
	ratingTie bool,
) (*HandXPResult, error) {
	if c == nil || c.repository == nil {
		return nil, nil
	}
	userID = strings.TrimSpace(userID)
	rotationRuntimeID = strings.TrimSpace(rotationRuntimeID)
	if userID == "" || rotationRuntimeID == "" {
		return nil, fmt.Errorf("%w: user and rotation are required", ErrNotInitialized)
	}
	award := RotationPlacementAward(position, ratingTie)
	if award.Total == 0 {
		return nil, nil
	}
	award.AwardID = rotationPlacementAwardID(rotationRuntimeID, userID)
	player, persisted, applied, err := c.repository.AwardXP(ctx, userID, rotationRuntimeID, award)
	if err != nil {
		return nil, err
	}
	return &HandXPResult{
		Award:          persisted,
		Player:         player,
		AlreadyAwarded: !applied,
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

// PlayerAchievements returns the complete visible §12.3 launch catalog.
//
// AGS is authoritative for current values and unlock status for the 23
// configured entries. The fixed catalog is authoritative for product order,
// display copy, goals/rewards, and entries whose tracking or game
// mode is not available yet. An untouched configured achievement may be absent
// from AGS; that is an exact zero, not a reason to hide it.
func (c *Coordinator) PlayerAchievements(
	ctx context.Context,
	userID string,
) ([]PlayerAchievement, error) {
	if c == nil {
		return nil, ErrNotInitialized
	}
	reader, ok := c.achievements.(AchievementProgressReader)
	if !ok {
		return nil, ErrNotInitialized
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, fmt.Errorf("%w: user ID is required", ErrNotInitialized)
	}

	rows, err := reader.AchievementProgress(ctx, userID)
	if err != nil {
		return nil, err
	}
	playerLevel := 0
	if c.repository != nil {
		if player, progressionErr := c.repository.PlayerProgression(ctx, userID); progressionErr == nil {
			playerLevel = player.Level.Level
		}
	}
	byCode := make(map[string]AchievementProgress, len(rows))
	for _, row := range rows {
		row.Code = strings.TrimSpace(row.Code)
		if row.Code == "" {
			continue
		}
		if math.IsNaN(row.Current) || math.IsInf(row.Current, 0) || row.Current < 0 {
			row.Current = 0
		}
		if existing, found := byCode[row.Code]; found {
			if existing.Current > row.Current {
				row.Current = existing.Current
			}
			row.Unlocked = row.Unlocked || existing.Unlocked
		}
		byCode[row.Code] = row
	}

	catalog := AchievementCatalog()
	result := make([]PlayerAchievement, 0, len(catalog))
	known := make(map[string]bool, len(catalog))
	for _, definition := range catalog {
		known[definition.Code] = true
		current := AchievementProgress{}
		if definition.Code == "max-alpha-player" {
			current.Current = float64(playerLevel)
			current.Unlocked = playerLevel >= MaxLevel
		} else if definition.Available {
			current = byCode[definition.Code]
		}
		result = append(result, PlayerAchievement{
			Achievement: definition,
			Current:     current.Current,
			Unlocked:    definition.Available && current.Unlocked,
		})
	}
	for code := range byCode {
		if !known[code] && c.onStatsError != nil {
			c.onStatsError(fmt.Errorf(
				"AGS returned unknown achievement %q for user %s; omitted from catalog",
				code,
				userID,
			))
		}
	}
	return result, nil
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
	if c == nil {
		return nil, ErrNotInitialized
	}

	values := map[string]float64{}
	ledgerAvailable := false
	var ledgerValues map[string]float64
	if repository, ok := c.repository.(DashboardStatsRepository); ok {
		var err error
		ledgerValues, err = repository.PlayerDashboardStatistics(ctx, userID)
		if err != nil {
			return nil, err
		}
		for code, value := range ledgerValues {
			values[code] = value
		}
		ledgerAvailable = true
	}

	if c.stats != nil {
		projected, err := c.stats.ReadStats(ctx, userID, DashboardStatCodes())
		if err != nil {
			if !ledgerAvailable {
				return nil, err
			}
			if c.onStatsError != nil {
				c.onStatsError(err)
			}
		} else {
			for code, value := range projected {
				values[code] = value
			}
		}
	}

	if !ledgerAvailable && c.stats == nil {
		return nil, ErrNotInitialized
	}

	// These two counters are facts already committed in xp_awards. Never let a
	// delayed or failed AGS projection overwrite the authoritative totals.
	if ledgerAvailable {
		values[StatPublicHandsCompleted] = ledgerValues[StatPublicHandsCompleted]
		values[StatPublicHandsWon] = ledgerValues[StatPublicHandsWon]
	}
	return values, nil
}
