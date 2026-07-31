package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/progression"
	"github.com/gameswithout/mahjong/rulesengine"
	"github.com/jackc/pgx/v5"
)

func (p *PostgreSQLStorage) progressionNow() time.Time {
	if p != nil && p.now != nil {
		return p.now()
	}
	return time.Now()
}

func validateAward(award progression.HandAward) error {
	if strings.TrimSpace(award.AwardID) == "" ||
		strings.TrimSpace(award.Source) == "" ||
		award.Total < 0 {
		return fmt.Errorf("%w: invalid XP award", progression.ErrNotInitialized)
	}
	total := 0
	for _, component := range award.Components {
		if strings.TrimSpace(component.Code) == "" || component.Amount < 0 {
			return fmt.Errorf("%w: invalid XP component", progression.ErrNotInitialized)
		}
		total += component.Amount
	}
	if total != award.Total {
		return fmt.Errorf(
			"%w: XP components total %d does not match award %d",
			progression.ErrNotInitialized,
			total,
			award.Total,
		)
	}
	return nil
}

func cloneAward(award progression.HandAward) progression.HandAward {
	award.Components = append([]progression.XPComponent(nil), award.Components...)
	return award
}

func ensureAndLockPlayerXP(
	ctx context.Context,
	tx pgx.Tx,
	userID string,
) (int64, error) {
	if _, err := tx.Exec(ctx, `
		INSERT INTO player_xp (user_id) VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING`, userID); err != nil {
		return 0, fmt.Errorf("ensure player XP row: %w", err)
	}
	var lifetime int64
	if err := tx.QueryRow(ctx, `
		SELECT lifetime_xp FROM player_xp WHERE user_id = $1 FOR UPDATE`,
		userID,
	).Scan(&lifetime); err != nil {
		return 0, fmt.Errorf("lock player XP: %w", err)
	}
	return lifetime, nil
}

func readXPAwardTx(
	ctx context.Context,
	tx pgx.Tx,
	awardID string,
) (string, progression.HandAward, bool, error) {
	var (
		userID     string
		source     string
		amount     int
		components []byte
		capped     bool
	)
	err := tx.QueryRow(ctx, `
		SELECT user_id, source, amount, components, capped_by_daily
		FROM xp_awards
		WHERE award_id = $1`, awardID,
	).Scan(&userID, &source, &amount, &components, &capped)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", progression.HandAward{}, false, nil
	}
	if err != nil {
		return "", progression.HandAward{}, false, fmt.Errorf("read XP award: %w", err)
	}
	var decoded []progression.XPComponent
	if len(components) > 0 {
		if err := json.Unmarshal(components, &decoded); err != nil {
			return "", progression.HandAward{}, false, fmt.Errorf("decode XP award components: %w", err)
		}
	}
	return userID, progression.HandAward{
		AwardID:       awardID,
		Source:        source,
		Total:         amount,
		Components:    decoded,
		CappedByDaily: capped,
	}, true, nil
}

func applyXPAwardTx(
	ctx context.Context,
	tx pgx.Tx,
	userID string,
	runtimeID string,
	day time.Time,
	lifetime int64,
	requested progression.HandAward,
) (progression.HandAward, int64, bool, error) {
	owner, existing, found, err := readXPAwardTx(ctx, tx, requested.AwardID)
	if err != nil {
		return progression.HandAward{}, lifetime, false, err
	}
	if found {
		if owner != userID {
			return progression.HandAward{}, lifetime, false, fmt.Errorf(
				"XP award %s belongs to a different player", requested.AwardID)
		}
		return existing, lifetime, false, nil
	}

	award := cloneAward(requested)

	encoded, err := json.Marshal(award.Components)
	if err != nil {
		return progression.HandAward{}, lifetime, false, fmt.Errorf(
			"encode XP award components: %w", err)
	}
	var nullableRuntime any
	if strings.TrimSpace(runtimeID) != "" {
		nullableRuntime = runtimeID
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO xp_awards (
			award_id, user_id, utc_day, source, amount, runtime_id,
			components, capped_by_daily, rules_version
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		award.AwardID,
		userID,
		day,
		award.Source,
		award.Total,
		nullableRuntime,
		encoded,
		award.CappedByDaily,
		progression.RulesVersion,
	); err != nil {
		return progression.HandAward{}, lifetime, false, fmt.Errorf("record XP award: %w", err)
	}
	if award.Total > 0 {
		if err := tx.QueryRow(ctx, `
			UPDATE player_xp
			SET lifetime_xp = lifetime_xp + $2, updated_at = NOW()
			WHERE user_id = $1
			RETURNING lifetime_xp`, userID, award.Total,
		).Scan(&lifetime); err != nil {
			return progression.HandAward{}, lifetime, false, fmt.Errorf("credit XP: %w", err)
		}
	}
	return award, lifetime, true, nil
}

func syncLevelRewardsTx(
	ctx context.Context,
	tx pgx.Tx,
	userID string,
	lifetime int64,
) error {
	level := progression.LevelForXP(int(lifetime)).Level
	for _, reward := range progression.EarnedRewards(level) {
		if _, err := tx.Exec(ctx, `
			INSERT INTO progression_reward_grants (
				user_id, reward_code, level, reward_kind, reward_name
			)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (user_id, reward_code) DO NOTHING`,
			userID, reward.Code, reward.Level, string(reward.Kind), reward.Name,
		); err != nil {
			return fmt.Errorf("grant level reward %s: %w", reward.Code, err)
		}
	}
	return nil
}

func readLevelRewardsTx(
	ctx context.Context,
	tx pgx.Tx,
	userID string,
) ([]progression.LevelReward, error) {
	rows, err := tx.Query(ctx, `
		SELECT reward_code, level, reward_kind, reward_name
		FROM progression_reward_grants
		WHERE user_id = $1
		ORDER BY level, reward_code`, userID)
	if err != nil {
		return nil, fmt.Errorf("read level rewards: %w", err)
	}
	defer rows.Close()
	var rewards []progression.LevelReward
	for rows.Next() {
		var reward progression.LevelReward
		if err := rows.Scan(&reward.Code, &reward.Level, &reward.Kind, &reward.Name); err != nil {
			return nil, fmt.Errorf("scan level reward: %w", err)
		}
		rewards = append(rewards, reward)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate level rewards: %w", err)
	}
	return rewards, nil
}

func readOnboardingTx(
	ctx context.Context,
	tx pgx.Tx,
	userID string,
) (*progression.OnboardingState, error) {
	var outcome progression.OnboardingOutcome
	var recorded time.Time
	err := tx.QueryRow(ctx, `
		SELECT outcome, updated_at
		FROM onboarding_progress
		WHERE user_id = $1`, userID,
	).Scan(&outcome, &recorded)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read onboarding progress: %w", err)
	}
	return &progression.OnboardingState{
		Outcome: outcome, RecordedAt: recorded.UTC().Format(time.RFC3339),
	}, nil
}

func playerProgressionTx(
	ctx context.Context,
	tx pgx.Tx,
	userID string,
	lifetime int64,
) (progression.Player, error) {
	player := progression.PlayerFromXP(userID, int(lifetime))
	rewards, err := readLevelRewardsTx(ctx, tx, userID)
	if err != nil {
		return progression.Player{}, err
	}
	player.Earned = rewards
	player.Onboarding, err = readOnboardingTx(ctx, tx, userID)
	if err != nil {
		return progression.Player{}, err
	}
	return player, nil
}

// AwardXP applies one XP award idempotently and returns the persisted award.
// Returning the stored record is important: a completed hand is projected on
// every poll, and the result must continue to show its original XP even after
// later hands have consumed the day's Practice allowance.
func (p *PostgreSQLStorage) AwardXP(
	ctx context.Context,
	userID string,
	runtimeID string,
	requested progression.HandAward,
) (progression.Player, progression.HandAward, bool, error) {
	if p == nil || p.pool == nil {
		return progression.Player{}, progression.HandAward{}, false, progression.ErrNotInitialized
	}
	userID = strings.TrimSpace(userID)
	if userID == "" || validateAward(requested) != nil {
		return progression.Player{}, progression.HandAward{}, false, fmt.Errorf(
			"%w: user and valid award are required", progression.ErrNotInitialized)
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return progression.Player{}, progression.HandAward{}, false, fmt.Errorf(
			"begin XP award: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	lifetime, err := ensureAndLockPlayerXP(ctx, tx, userID)
	if err != nil {
		return progression.Player{}, progression.HandAward{}, false, err
	}
	day := progression.UTCDay(p.progressionNow())
	persisted, lifetime, applied, err := applyXPAwardTx(
		ctx, tx, userID, runtimeID, day, lifetime, requested)
	if err != nil {
		return progression.Player{}, progression.HandAward{}, false, err
	}
	if err := syncLevelRewardsTx(ctx, tx, userID, lifetime); err != nil {
		return progression.Player{}, progression.HandAward{}, false, err
	}
	player, err := playerProgressionTx(ctx, tx, userID, lifetime)
	if err != nil {
		return progression.Player{}, progression.HandAward{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return progression.Player{}, progression.HandAward{}, false, fmt.Errorf(
			"commit XP award: %w", err)
	}
	return player, persisted, applied, nil
}

func (p *PostgreSQLStorage) RecordOnboarding(
	ctx context.Context,
	userID string,
	outcome progression.OnboardingOutcome,
	requested progression.HandAward,
) (progression.Player, progression.HandAward, progression.OnboardingState, bool, error) {
	if p == nil || p.pool == nil || !outcome.Valid() {
		return progression.Player{}, progression.HandAward{}, progression.OnboardingState{},
			false, progression.ErrNotInitialized
	}
	userID = strings.TrimSpace(userID)
	if userID == "" || validateAward(requested) != nil {
		return progression.Player{}, progression.HandAward{}, progression.OnboardingState{},
			false, fmt.Errorf("%w: invalid onboarding award", progression.ErrNotInitialized)
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return progression.Player{}, progression.HandAward{}, progression.OnboardingState{},
			false, fmt.Errorf("begin onboarding: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	lifetime, err := ensureAndLockPlayerXP(ctx, tx, userID)
	if err != nil {
		return progression.Player{}, progression.HandAward{}, progression.OnboardingState{},
			false, err
	}
	var storedOutcome progression.OnboardingOutcome
	var recorded time.Time
	if err := tx.QueryRow(ctx, `
		INSERT INTO onboarding_progress (user_id, outcome)
		VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE
		SET outcome = CASE
				WHEN onboarding_progress.outcome = 'completed' THEN 'completed'
				ELSE EXCLUDED.outcome
			END,
			updated_at = CASE
				WHEN onboarding_progress.outcome = 'skipped'
					AND EXCLUDED.outcome = 'completed'
				THEN NOW()
				ELSE onboarding_progress.updated_at
			END
		RETURNING outcome, updated_at`,
		userID, string(outcome),
	).Scan(&storedOutcome, &recorded); err != nil {
		return progression.Player{}, progression.HandAward{}, progression.OnboardingState{},
			false, fmt.Errorf("record onboarding progress: %w", err)
	}
	state := progression.OnboardingState{
		Outcome: storedOutcome, RecordedAt: recorded.UTC().Format(time.RFC3339),
	}
	day := progression.UTCDay(p.progressionNow())
	persisted, lifetime, applied, err := applyXPAwardTx(
		ctx, tx, userID, "", day, lifetime, requested)
	if err != nil {
		return progression.Player{}, progression.HandAward{}, progression.OnboardingState{},
			false, err
	}
	if err := syncLevelRewardsTx(ctx, tx, userID, lifetime); err != nil {
		return progression.Player{}, progression.HandAward{}, progression.OnboardingState{},
			false, err
	}
	player, err := playerProgressionTx(ctx, tx, userID, lifetime)
	if err != nil {
		return progression.Player{}, progression.HandAward{}, progression.OnboardingState{},
			false, err
	}
	player.Onboarding = &state
	if err := tx.Commit(ctx); err != nil {
		return progression.Player{}, progression.HandAward{}, progression.OnboardingState{},
			false, fmt.Errorf("commit onboarding: %w", err)
	}
	return player, persisted, state, applied, nil
}

func (p *PostgreSQLStorage) PlayerProgression(
	ctx context.Context,
	userID string,
) (progression.Player, error) {
	if p == nil || p.pool == nil {
		return progression.Player{}, progression.ErrNotInitialized
	}
	userID = strings.TrimSpace(userID)
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return progression.Player{}, fmt.Errorf("begin player XP read: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var lifetime int64
	err = tx.QueryRow(ctx, `
		SELECT lifetime_xp FROM player_xp WHERE user_id = $1 FOR UPDATE`, userID,
	).Scan(&lifetime)
	if errors.Is(err, pgx.ErrNoRows) {
		return progression.PlayerFromXP(userID, 0), nil
	}
	if err != nil {
		return progression.Player{}, fmt.Errorf("read player XP: %w", err)
	}
	if err := syncLevelRewardsTx(ctx, tx, userID, lifetime); err != nil {
		return progression.Player{}, err
	}
	player, err := playerProgressionTx(ctx, tx, userID, lifetime)
	if err != nil {
		return progression.Player{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return progression.Player{}, fmt.Errorf("commit player XP read: %w", err)
	}
	return player, nil
}

// TakenOverMajority derives the §12.1 penalty from the immutable event
// timeline. Every command result contains a TurnSnapshot, so reconnect and
// restore-control transitions survive service restarts without a second
// mutable counter.
func (p *PostgreSQLStorage) TakenOverMajority(
	ctx context.Context,
	userID string,
	runtimeID string,
) (bool, error) {
	if p == nil || p.pool == nil {
		return false, progression.ErrNotInitialized
	}
	var seat rulesengine.Seat
	if err := p.pool.QueryRow(ctx, `
		SELECT seat FROM match_seats
		WHERE runtime_id = $1 AND user_id = $2`,
		strings.TrimSpace(runtimeID), strings.TrimSpace(userID),
	).Scan(&seat); err != nil {
		return false, fmt.Errorf("read progression seat: %w", err)
	}
	events, err := p.Events(ctx, runtimeID)
	if err != nil {
		return false, err
	}
	if len(events) < 2 {
		return false, nil
	}
	return takenOverMajorityFromEvents(events, seat)
}

func takenOverMajorityFromEvents(
	events []rulesengine.MatchEvent,
	seat rulesengine.Seat,
) (bool, error) {
	if len(events) < 2 {
		return false, nil
	}
	taken, err := takenOverAfterEvent(events[0], seat)
	if err != nil {
		return false, err
	}
	previous := events[0].OccurredAt
	var total, controlled time.Duration
	for _, event := range events[1:] {
		elapsed := event.OccurredAt.Sub(previous)
		if elapsed > 0 {
			total += elapsed
			if taken {
				controlled += elapsed
			}
		}
		taken, err = takenOverAfterEvent(event, seat)
		if err != nil {
			return false, err
		}
		previous = event.OccurredAt
	}
	return total > 0 && controlled*2 > total, nil
}

func takenOverAfterEvent(event rulesengine.MatchEvent, seat rulesengine.Seat) (bool, error) {
	var snapshot rulesengine.TurnSnapshot
	switch {
	case len(event.Result) > 0:
		var result rulesengine.CommandResult
		if err := json.Unmarshal(event.Result, &result); err != nil {
			return false, fmt.Errorf("decode progression event result: %w", err)
		}
		snapshot = result.Snapshot
	case len(event.Snapshot) > 0:
		var created struct {
			Turn rulesengine.TurnSnapshot `json:"turn"`
		}
		if err := json.Unmarshal(event.Snapshot, &created); err != nil {
			return false, fmt.Errorf("decode progression event snapshot: %w", err)
		}
		snapshot = created.Turn
	default:
		return false, nil
	}
	for _, candidate := range snapshot.TakenOver {
		if candidate == seat {
			return true, nil
		}
	}
	return false, nil
}
