package progression

// §12.3 launch achievements and the XP they award.
//
// AGS owns *whether* an achievement is unlocked — it evaluates the statistics
// written by stats.go against each achievement's goal value. AGS does not, and
// cannot, award our XP: that lives in player_xp/xp_awards. So this table is the
// reward half of the contract, and AGS is consulted only for unlock detection.
//
// Keeping the XP here rather than reading customAttributes back from AGS is the
// same choice §12.2's level rewards already make: the values are specification
// content, they change through a product decision rather than at runtime, and
// reading them per hand would double the API traffic to learn something that
// never varies. The configs carry the same numbers in customAttributes so the
// two can be reconciled by eye.

// SourceAchievement is the reason code on an achievement XP award.
const SourceAchievement = "achievement"

// AGS reports user achievement status as 1 = in progress, 2 = unlocked.
const agsAchievementUnlocked int32 = 2

type Achievement struct {
	Code              string
	Name              string
	Description       string
	Goal              float64
	XP                int
	BonusReward       string
	Available         bool
	UnavailableReason string
}

const (
	trackingPendingReason = "Progress tracking for this achievement is not available yet."
	fullRotationReason    = "Full Rotation is not available yet."
)

// launchAchievementCatalog is the complete §12.3 launch set in product order.
//
// All 32 stay visible even while nine cannot be configured in AGS. Available
// means the namespace has the backing Statistic and Achievement definition
// today; unavailable entries carry the honest reason the UI shows instead of
// silently disappearing.
var launchAchievementCatalog = []Achievement{
	{
		Code: "alpha-player", Name: "Alpha Player",
		Description: "Complete an Online Play hand during Alpha.", Goal: 1, XP: 100,
		BonusReward: "Alpha tile design (placeholder)", Available: true,
	},
	{
		Code: "max-alpha-player", Name: "Max Alpha Player",
		Description: "Reach Alpha level 10.", Goal: 10, XP: 500,
		BonusReward: "Alpha Max tile design (placeholder)", Available: true,
	},
	{
		Code: "first-hand", Name: "First Hand",
		Description: "Complete your first Online Play hand.", Goal: 1, XP: 100, Available: true,
	},
	{
		Code: "first-win", Name: "First Win",
		Description: "Win your first Online Play hand.", Goal: 1, XP: 200,
		BonusReward: "First Victory title", Available: true,
	},
	{
		Code: "self-reliant", Name: "Self Reliant",
		Description: "Win by 自摸 (Zi Mo) 10 times.", Goal: 10, XP: 300, Available: true,
	},
	{
		Code: "claim-student", Name: "Claim Student",
		Description: "Complete 50 Chow or Pong claims.", Goal: 50, XP: 300,
		UnavailableReason: trackingPendingReason,
	},
	{
		Code: "kong-collector", Name: "Kong Collector",
		Description: "Complete 25 legal Kongs.", Goal: 25, XP: 300, Available: true,
	},
	{
		Code: "ready-regular", Name: "Ready Regular",
		Description: "Reach Ting in 100 completed public hands.", Goal: 100, XP: 500,
		UnavailableReason: trackingPendingReason,
	},
	{
		Code: "all-pongs", Name: "碰碰胡 (Pong Pong Hu)",
		Description: "Win with every set as a Pong or Kong.", Goal: 1, XP: 500,
		BonusReward: "Pong Specialist title", Available: true,
	},
	{
		Code: "pure-hand", Name: "清一色 (Ching Yi Se)",
		Description: "Win using only one numbered suit.", Goal: 1, XP: 750,
		BonusReward: "Pure Hand frame", Available: true,
	},
	{
		Code: "dragon-caller", Name: "大三元 (Dai Sam Yuen)",
		Description: "Win with Pongs or Kongs of all three Dragons.", Goal: 1, XP: 1000,
		BonusReward: "Dragon Caller title", Available: true,
	},
	{
		Code: "four-winds", Name: "大四喜 (Dai Sei Hei)",
		Description: "Win with Pongs or Kongs of all four Winds.", Goal: 1, XP: 1500,
		BonusReward: "Four Winds frame", Available: true,
	},
	{
		Code: "full-rotation-regular", Name: "Full Rotation Regular",
		Description: "Complete 10 public Full Rotation matches.", Goal: 10, XP: 750,
		UnavailableReason: fullRotationReason,
	},
	{
		Code: "clean-defense", Name: "Clean Defense",
		Description: "Complete a Full Rotation without dealing into a Win.", Goal: 1, XP: 1000,
		BonusReward: "Clean Defender title", UnavailableReason: fullRotationReason,
	},
	{
		Code: "high-value", Name: "High Value",
		Description: "Win a hand worth at least 5 raw Tai.", Goal: 5, XP: 300, Available: true,
	},
	{
		Code: "master-craft", Name: "Master Craft",
		Description: "Win a hand worth at least 10 raw Tai.", Goal: 10, XP: 750, Available: true,
	},
	{
		Code: "kong-robber", Name: "Kong Robber",
		Description: "Win with 搶槓胡 (Cheung Gong Hu).", Goal: 1, XP: 500, Available: true,
	},
	{
		Code: "replacement-artist", Name: "Replacement Artist",
		Description: "Win with 槓上開花 (Gong Seung Hoi Fa).", Goal: 1, XP: 300, Available: true,
	},
	{
		Code: "last-chance", Name: "Last Chance",
		Description: "Win with 海底撈月 (Hoi Dai Lau Yuet).", Goal: 1, XP: 500, Available: true,
	},
	{
		Code: "quiet-strength", Name: "Quiet Strength",
		Description: "Win with 門清自摸 (Mun Ching Zi Mo).", Goal: 1, XP: 300, Available: true,
	},
	{
		Code: "three-of-a-mind", Name: "Three of a Mind",
		Description: "Win with three or more Concealed Pongs.", Goal: 1, XP: 500, Available: true,
	},
	{
		Code: "half-and-half", Name: "Half and Half",
		Description: "Win with 混一色 (Wan Yi Se).", Goal: 1, XP: 300, Available: true,
	},
	{
		Code: "garden-party", Name: "Garden Party",
		Description: "Win with Complete Seasons or Complete Flowers.", Goal: 1, XP: 500, Available: true,
	},
	{
		Code: "honor-guard", Name: "Honor Guard",
		Description: "Win with 字一色 (Zi Yi Se).", Goal: 1, XP: 1000,
		BonusReward: "Honored title", Available: true,
	},
	{
		Code: "eightfold-bloom", Name: "Eightfold Bloom",
		Description: "Win with 八仙過海 (Baat Sin Gwo Hoi).", Goal: 1, XP: 1500,
		BonusReward: "Eightfold title", Available: true,
	},
	{
		Code: "self-reliant-ii", Name: "Self Reliant II",
		Description: "Win by 自摸 (Zi Mo) 50 times.", Goal: 50, XP: 750, Available: true,
	},
	{
		Code: "claim-scholar", Name: "Claim Scholar",
		Description: "Complete 250 Chow or Pong claims.", Goal: 250, XP: 500,
		UnavailableReason: trackingPendingReason,
	},
	{
		Code: "kong-master", Name: "Kong Master",
		Description: "Complete 100 legal Kongs.", Goal: 100, XP: 750, Available: true,
	},
	{
		Code: "ready-veteran", Name: "Ready Veteran",
		Description: "Reach Ting in 500 completed public hands.", Goal: 500, XP: 1000,
		UnavailableReason: trackingPendingReason,
	},
	{
		Code: "hundred-hands", Name: "Hundred Hands",
		Description: "Complete 100 public hands.", Goal: 100, XP: 500, Available: true,
	},
	{
		Code: "centurion-of-the-table", Name: "Centurion of the Table",
		Description: "Complete 500 public hands.", Goal: 500, XP: 1000,
		BonusReward: "Centurion title", Available: true,
	},
	{
		Code: "rotation-master", Name: "Rotation Master",
		Description: "Complete 50 public Full Rotation matches.", Goal: 50, XP: 1000,
		UnavailableReason: fullRotationReason,
	},
	{
		Code: "podium-regular", Name: "Podium Regular",
		Description: "Finish first in 10 public Full Rotation matches.", Goal: 10, XP: 750,
		UnavailableReason: fullRotationReason,
	},
	{
		Code: "stone-wall", Name: "Stone Wall",
		Description: "Reach a no-deal-in streak of 10 eligible public hands.", Goal: 10, XP: 500,
		UnavailableReason: trackingPendingReason,
	},
}

var achievementsByCode = func() map[string]Achievement {
	index := make(map[string]Achievement, len(launchAchievementCatalog))
	for _, achievement := range launchAchievementCatalog {
		if achievement.Available {
			index[achievement.Code] = achievement
		}
	}
	return index
}()

// LaunchAchievements is the configured reward set. Unavailable catalog entries
// are intentionally excluded: AGS cannot unlock them, so they must not sit in
// the XP lookup implying that they pay today.
func LaunchAchievements() []Achievement {
	achievements := make([]Achievement, 0, len(achievementsByCode))
	for _, achievement := range launchAchievementCatalog {
		if achievement.Available {
			achievements = append(achievements, achievement)
		}
	}
	return achievements
}

// AchievementCatalog returns all visible Alpha achievements, including
// entries whose required tracking or game mode is not available yet.
func AchievementCatalog() []Achievement {
	return append([]Achievement(nil), launchAchievementCatalog...)
}

// AchievementByCode looks up a reward. An unknown code returns false rather
// than a zero-XP achievement: AGS may hold codes this build does not know
// about — an older or newer config, or one added by hand in the portal — and
// silently paying zero would look identical to having paid.
func AchievementByCode(code string) (Achievement, bool) {
	achievement, known := achievementsByCode[code]
	return achievement, known
}

// achievementAwardID is the §12.1 server event ID for an achievement's XP.
// Derived from (code, user), so an achievement pays exactly once no matter how
// many times AGS reports it unlocked.
func achievementAwardID(code, userID string) string {
	return "achievement:" + code + ":" + userID
}

// AchievementAward is one unlocked achievement's XP grant.
func AchievementAward(achievement Achievement, userID string) HandAward {
	return HandAward{
		AwardID: achievementAwardID(achievement.Code, userID),
		Source:  SourceAchievement,
		Total:   achievement.XP,
		Components: []XPComponent{{
			Code:   achievement.Code,
			Label:  achievement.Name,
			Amount: achievement.XP,
		}},
	}
}
