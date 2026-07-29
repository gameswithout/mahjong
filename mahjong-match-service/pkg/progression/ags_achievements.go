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
	if r == nil || r.achievements == nil || r.namespace == "" {
		return nil, fmt.Errorf("AGS achievement reader is not initialized")
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, fmt.Errorf("AGS achievement reader requires a user ID")
	}

	var codes []string
	offset := int64(0)
	limit := achievementPageLimit
	preferUnlocked := true

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
			return codes, nil
		}
		for _, entry := range payload.Data {
			if entry == nil || entry.AchievementCode == nil || entry.Status == nil {
				continue
			}
			if *entry.Status == agsAchievementUnlocked {
				codes = append(codes, *entry.AchievementCode)
			}
		}
		if int64(len(payload.Data)) < limit {
			return codes, nil
		}
		offset += limit
	}
}
