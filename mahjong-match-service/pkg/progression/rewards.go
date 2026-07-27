package progression

// §12.2 level rewards. Level never gates a lobby — every mode unlocks after
// onboarding — so everything here is cosmetic or a title.
//
// High Contrast tiles are deliberately absent: §12.2 makes them accessibility
// content available at Level 1, not a reward to be earned.

type RewardKind string

const (
	RewardTitle       RewardKind = "title"
	RewardTableTheme  RewardKind = "table_theme"
	RewardTileSkin    RewardKind = "tile_skin"
	RewardAvatarFrame RewardKind = "avatar_frame"
)

type LevelReward struct {
	Code  string
	Level int
	Kind  RewardKind
	Name  string
}

var levelRewards = []LevelReward{
	{Code: "level-2-student-title", Level: 2, Kind: RewardTitle, Name: "Student"},
	{Code: "level-5-tea-house-theme", Level: 5, Kind: RewardTableTheme, Name: "Tea House"},
	{Code: "level-10-jade-tile-skin", Level: 10, Kind: RewardTileSkin, Name: "Jade"},
	{Code: "level-15-bamboo-frame", Level: 15, Kind: RewardAvatarFrame, Name: "Bamboo"},
	{Code: "level-20-night-market-theme", Level: 20, Kind: RewardTableTheme, Name: "Night Market"},
	{Code: "level-25-steady-hand-title", Level: 25, Kind: RewardTitle, Name: "Steady Hand"},
	{Code: "level-30-jade-ring-frame", Level: 30, Kind: RewardAvatarFrame, Name: "Jade Ring"},
	{Code: "level-35-wall-reader-title", Level: 35, Kind: RewardTitle, Name: "Wall Reader"},
	{Code: "level-40-tea-blossom-frame", Level: 40, Kind: RewardAvatarFrame, Name: "Tea Blossom"},
	{Code: "level-45-table-veteran-title", Level: 45, Kind: RewardTitle, Name: "Table Veteran"},
	{Code: "level-50-mahjong-master-title", Level: 50, Kind: RewardTitle, Name: "Mahjong Master"},
	{Code: "level-50-master-frame", Level: 50, Kind: RewardAvatarFrame, Name: "Master"},
}

type LevelStep struct {
	Level           int
	TotalXPRequired int
	XPForNextLevel  int
	Rewards         []LevelReward
}

// LevelRewards is the full curve, for the progression screen. Returned as a
// copy so a caller cannot reorder or mutate the table.
func LevelRewards() []LevelReward {
	return append([]LevelReward(nil), levelRewards...)
}

// LevelCurve returns all 50 Version 1 thresholds, including levels without a
// reward. The client can therefore explain the actual curve instead of
// presenting only the sparse cosmetic milestones.
func LevelCurve() []LevelStep {
	curve := make([]LevelStep, 0, MaxLevel)
	total := 0
	for level := StartingLevel; level <= MaxLevel; level++ {
		step := LevelStep{Level: level, TotalXPRequired: total}
		if level < MaxLevel {
			step.XPForNextLevel = XPToAdvance(level)
		}
		for _, reward := range levelRewards {
			if reward.Level == level {
				step.Rewards = append(step.Rewards, reward)
			}
		}
		curve = append(curve, step)
		if level < MaxLevel {
			total += XPToAdvance(level)
		}
	}
	return curve
}

// EarnedRewards is everything unlocked at or below the given level.
//
// §12.2: if the curve changes the server recomputes level from lifetime XP and
// grants newly earned rewards retroactively. Persistence records those grants
// monotonically, so a later curve can add eligibility but never revoke an
// already earned cosmetic.
func EarnedRewards(level int) []LevelReward {
	earned := make([]LevelReward, 0, len(levelRewards))
	for _, reward := range levelRewards {
		if reward.Level <= level {
			earned = append(earned, reward)
		}
	}
	return earned
}

// NextReward is the first reward above the given level, or nil at the cap.
// The post-match display names it, so a player can see what the next level is
// actually worth rather than only how far away it is.
func NextReward(level int) *LevelReward {
	for _, reward := range levelRewards {
		if reward.Level > level {
			next := reward
			return &next
		}
	}
	return nil
}
