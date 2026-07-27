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
	Level int
	Kind  RewardKind
	Name  string
}

var levelRewards = []LevelReward{
	{Level: 2, Kind: RewardTitle, Name: "Student"},
	{Level: 5, Kind: RewardTableTheme, Name: "Tea House"},
	{Level: 10, Kind: RewardTileSkin, Name: "Jade"},
	{Level: 15, Kind: RewardAvatarFrame, Name: "Bamboo"},
	{Level: 20, Kind: RewardTableTheme, Name: "Night Market"},
	{Level: 25, Kind: RewardTitle, Name: "Steady Hand"},
	{Level: 30, Kind: RewardAvatarFrame, Name: "Jade Ring"},
	{Level: 35, Kind: RewardTitle, Name: "Wall Reader"},
	{Level: 40, Kind: RewardAvatarFrame, Name: "Tea Blossom"},
	{Level: 45, Kind: RewardTitle, Name: "Table Veteran"},
	{Level: 50, Kind: RewardTitle, Name: "Mahjong Master"},
	{Level: 50, Kind: RewardAvatarFrame, Name: "Master"},
}

// LevelRewards is the full curve, for the progression screen. Returned as a
// copy so a caller cannot reorder or mutate the table.
func LevelRewards() []LevelReward {
	return append([]LevelReward(nil), levelRewards...)
}

// EarnedRewards is everything unlocked at or below the given level.
//
// §12.2: if the curve changes the server recomputes level from lifetime XP and
// grants newly earned rewards retroactively, never revoking one already
// granted. Deriving entitlement from level on every read — rather than
// recording a grant at the moment of level-up — is what makes that property
// hold without a migration.
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
