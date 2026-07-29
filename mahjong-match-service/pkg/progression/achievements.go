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
	Code string
	Name string
	XP   int
}

// launchAchievements is every §12.3 achievement currently configured in the
// namespace. The nine that are not configured — the Full Rotation four and the
// five needing claim/Ting/deal-in tracking — are deliberately absent: an
// achievement AGS cannot unlock must not sit here implying it pays.
var launchAchievements = []Achievement{
	{Code: "first-hand", Name: "First Hand", XP: 100},
	{Code: "first-win", Name: "First Win", XP: 200},
	{Code: "self-reliant", Name: "Self Reliant", XP: 300},
	{Code: "self-reliant-ii", Name: "Self Reliant II", XP: 750},
	{Code: "kong-collector", Name: "Kong Collector", XP: 300},
	{Code: "kong-master", Name: "Kong Master", XP: 750},
	{Code: "hundred-hands", Name: "Hundred Hands", XP: 500},
	{Code: "centurion-of-the-table", Name: "Centurion of the Table", XP: 1000},
	{Code: "high-value", Name: "High Value", XP: 300},
	{Code: "master-craft", Name: "Master Craft", XP: 750},
	{Code: "all-pongs", Name: "All Pongs", XP: 500},
	{Code: "pure-hand", Name: "Pure Hand", XP: 750},
	{Code: "half-and-half", Name: "Half and Half", XP: 300},
	{Code: "dragon-caller", Name: "Dragon Caller", XP: 1000},
	{Code: "four-winds", Name: "Four Winds", XP: 1500},
	{Code: "honor-guard", Name: "Honor Guard", XP: 1000},
	{Code: "eightfold-bloom", Name: "Eightfold Bloom", XP: 1500},
	{Code: "kong-robber", Name: "Kong Robber", XP: 500},
	{Code: "replacement-artist", Name: "Replacement Artist", XP: 300},
	{Code: "last-chance", Name: "Last Chance", XP: 500},
	{Code: "quiet-strength", Name: "Quiet Strength", XP: 300},
	{Code: "three-of-a-mind", Name: "Three of a Mind", XP: 500},
	{Code: "garden-party", Name: "Garden Party", XP: 500},
}

var achievementsByCode = func() map[string]Achievement {
	index := make(map[string]Achievement, len(launchAchievements))
	for _, achievement := range launchAchievements {
		index[achievement.Code] = achievement
	}
	return index
}()

// LaunchAchievements is the configured set, for display and for tests.
func LaunchAchievements() []Achievement {
	return append([]Achievement(nil), launchAchievements...)
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
