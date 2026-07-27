package storage

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/progression"
)

// AwardXP applies one XP award idempotently.
//
// The bool reports whether this call is the one that applied it. A repeat under
// the same award ID moves no XP and returns false, which is how the projection
// poll can call this on every read of a finished hand without paying twice.
func (p *PostgreSQLStorage) AwardXP(
	ctx context.Context,
	awardID string,
	userID string,
	runtimeID string,
	source string,
	amount int,
) (progression.Player, bool, error) {
	if p == nil || p.pool == nil {
		return progression.Player{}, false, progression.ErrNotInitialized
	}
	awardID = strings.TrimSpace(awardID)
	userID = strings.TrimSpace(userID)
	if awardID == "" || userID == "" {
		return progression.Player{}, false, fmt.Errorf(
			"%w: award and user are required", progression.ErrNotInitialized)
	}
	if amount < 0 {
		// XP is never taken away (§12.2 never revokes). A negative award is a
		// programming error, not a state to persist.
		return progression.Player{}, false, fmt.Errorf(
			"%w: negative XP award %d", progression.ErrNotInitialized, amount)
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return progression.Player{}, false, fmt.Errorf("begin XP award: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		INSERT INTO player_xp (user_id) VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING`, userID); err != nil {
		return progression.Player{}, false, fmt.Errorf("ensure player XP row: %w", err)
	}
	var lifetime int64
	if err := tx.QueryRow(ctx, `
		SELECT lifetime_xp FROM player_xp WHERE user_id = $1 FOR UPDATE`,
		userID,
	).Scan(&lifetime); err != nil {
		return progression.Player{}, false, fmt.Errorf("lock player XP: %w", err)
	}

	var nullableRuntime any
	if strings.TrimSpace(runtimeID) != "" {
		nullableRuntime = runtimeID
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO xp_awards (award_id, user_id, utc_day, source, amount, runtime_id)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (award_id) DO NOTHING`,
		awardID, userID, progression.UTCDay(time.Now()), source, amount, nullableRuntime,
	)
	if err != nil {
		return progression.Player{}, false, fmt.Errorf("record XP award: %w", err)
	}
	applied := tag.RowsAffected() == 1

	if applied && amount > 0 {
		if err := tx.QueryRow(ctx, `
			UPDATE player_xp
			SET lifetime_xp = lifetime_xp + $2, updated_at = NOW()
			WHERE user_id = $1
			RETURNING lifetime_xp`, userID, amount,
		).Scan(&lifetime); err != nil {
			return progression.Player{}, false, fmt.Errorf("credit XP: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return progression.Player{}, false, fmt.Errorf("commit XP award: %w", err)
	}
	return progression.PlayerFromXP(userID, int(lifetime)), applied, nil
}

// PracticeXPToday backs the §12.1 200-per-UTC-day Practice cap.
func (p *PostgreSQLStorage) PracticeXPToday(
	ctx context.Context,
	userID string,
) (int, error) {
	if p == nil || p.pool == nil {
		return 0, progression.ErrNotInitialized
	}
	var total int64
	if err := p.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0)
		FROM xp_awards
		WHERE user_id = $1 AND utc_day = $2 AND source = $3`,
		strings.TrimSpace(userID), progression.UTCDay(time.Now()), progression.SourcePractice,
	).Scan(&total); err != nil {
		return 0, fmt.Errorf("read today's Practice XP: %w", err)
	}
	return int(total), nil
}

func (p *PostgreSQLStorage) PlayerProgression(
	ctx context.Context,
	userID string,
) (progression.Player, error) {
	if p == nil || p.pool == nil {
		return progression.Player{}, progression.ErrNotInitialized
	}
	userID = strings.TrimSpace(userID)
	var lifetime int64
	// A player who has never earned XP has no row yet; that is level 1, not an
	// error, so the lobby can render a new account without a write.
	if err := p.pool.QueryRow(ctx, `
		SELECT COALESCE((SELECT lifetime_xp FROM player_xp WHERE user_id = $1), 0)`,
		userID,
	).Scan(&lifetime); err != nil {
		return progression.Player{}, fmt.Errorf("read player XP: %w", err)
	}
	return progression.PlayerFromXP(userID, int(lifetime)), nil
}
