package storage

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/progression"
)

// Read each rotation container once, never its hand rows or XP awards. The
// natural completion reason excludes time limits even when complete is true.
// There is no mode, placement, or bot filter: all completed rotations qualify.
func (p *PostgreSQLStorage) PlayerJourney(ctx context.Context, userID string) (progression.Journey, error) {
	userID = strings.TrimSpace(userID)
	if p == nil || p.pool == nil || userID == "" {
		return progression.Journey{}, progression.ErrNotInitialized
	}
	var count int64
	var first *time.Time
	err := p.pool.QueryRow(ctx, `
  SELECT COUNT(*), MIN(r.completed_at)
  FROM rotation_matches r
  WHERE r.complete AND r.state->>'completion_reason' = 'rotation_complete'
   AND EXISTS (SELECT 1 FROM match_seats s WHERE s.runtime_id = r.runtime_id AND s.user_id = $1)
 `, userID).Scan(&count, &first)
	if err != nil {
		return progression.Journey{}, fmt.Errorf("read player journey: %w", err)
	}
	if first == nil {
		return progression.JourneyFromRotations(0, time.Time{}, p.progressionNow()), nil
	}
	return progression.JourneyFromRotations(count, *first, p.progressionNow()), nil
}
