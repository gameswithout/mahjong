package progression

import (
	"context"
	"fmt"
	"strings"

	"github.com/AccelByte/accelbyte-go-sdk/achievement-sdk/pkg/achievementclient"
	"github.com/AccelByte/accelbyte-go-sdk/achievement-sdk/pkg/achievementclient/user_achievements"
	"github.com/AccelByte/accelbyte-go-sdk/services-api/pkg/repository"
	"github.com/AccelByte/accelbyte-go-sdk/services-api/pkg/utils/auth"
)

// AGSAchievementReader reports which achievements AGS has unlocked for a
// player. It only reads: AGS decides unlocks by evaluating the statistics
// stats.go writes, and this service never unlocks an achievement by hand.
type AGSAchievementReader struct {
	namespace    string
	achievements *achievementclient.JusticeAchievementService
	config       repository.ConfigRepository
	tokens       repository.TokenRepository
}

func NewAGSAchievementReader(
	namespace string,
	achievements *achievementclient.JusticeAchievementService,
	config repository.ConfigRepository,
	tokens repository.TokenRepository,
) *AGSAchievementReader {
	return &AGSAchievementReader{
		namespace:    strings.TrimSpace(namespace),
		achievements: achievements,
		config:       config,
		tokens:       tokens,
	}
}

// achievementPageLimit is comfortably above the configured achievement count,
// so one page covers every unlock a player can hold. Paging is still handled
// below rather than assumed away, because the set grows as §12.3's blocked
// achievements become configurable.
const achievementPageLimit int64 = 100

// UnlockedAchievementCodes returns the codes AGS considers unlocked.
func (r *AGSAchievementReader) UnlockedAchievementCodes(
	ctx context.Context,
	userID string,
) ([]string, error) {
	rows, err := r.listAchievementProgress(ctx, userID, true)
	if err != nil {
		return nil, err
	}
	codes := make([]string, 0, len(rows))
	for _, row := range rows {
		if row.Unlocked {
			codes = append(codes, row.Code)
		}
	}
	return codes, nil
}

// AchievementProgress returns every player-achievement row AGS currently
// holds. preferUnlocked is false so untouched and in-progress rows are not
// displaced by the unlocked-first optimization used by the award sweep.
func (r *AGSAchievementReader) AchievementProgress(
	ctx context.Context,
	userID string,
) ([]AchievementProgress, error) {
	return r.listAchievementProgress(ctx, userID, false)
}

func (r *AGSAchievementReader) listAchievementProgress(
	ctx context.Context,
	userID string,
	preferUnlocked bool,
) ([]AchievementProgress, error) {
	if r == nil || r.achievements == nil || r.namespace == "" {
		return nil, fmt.Errorf("AGS achievement reader is not initialized")
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, fmt.Errorf("AGS achievement reader requires a user ID")
	}

	var rows []AchievementProgress
	offset := int64(0)
	limit := achievementPageLimit

	for {
		response, err := r.achievements.UserAchievements.AdminListUserAchievementsShort(
			&user_achievements.AdminListUserAchievementsParams{
				Namespace:      r.namespace,
				UserID:         userID,
				Limit:          &limit,
				Offset:         &offset,
				PreferUnlocked: &preferUnlocked,
				Context:        ctx,
			},
			auth.AuthInfoWriter(
				auth.Session{Token: r.tokens, Config: r.config, Refresh: nil},
				[][]string{{"bearer"}},
				"",
			),
		)
		if err != nil {
			return nil, fmt.Errorf("list AGS user achievements: %w", err)
		}
		payload := response.GetPayload()
		if payload == nil || len(payload.Data) == 0 {
			return rows, nil
		}
		for _, entry := range payload.Data {
			if entry == nil || entry.AchievementCode == nil || entry.Status == nil {
				continue
			}
			current := float64(0)
			if entry.LatestValue != nil {
				current = *entry.LatestValue
			}
			rows = append(rows, AchievementProgress{
				Code:     *entry.AchievementCode,
				Current:  current,
				Unlocked: *entry.Status == agsAchievementUnlocked,
			})
		}
		if int64(len(payload.Data)) < limit {
			return rows, nil
		}
		offset += limit
	}
}
