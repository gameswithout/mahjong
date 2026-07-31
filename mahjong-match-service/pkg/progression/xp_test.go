package progression

import "testing"

func TestHandXP_Practice(t *testing.T) {
	tests := []struct {
		name       string
		xpToday    int
		wantTotal  int
		wantCapped bool
	}{
		{name: "first Practice hand of the day", xpToday: 0, wantTotal: 25},
		{name: "later Practice hands pay the same", xpToday: 150, wantTotal: 25},
		{name: "there is no daily cap", xpToday: 10_000, wantTotal: 25},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			award := HandXP(HandOutcome{Practice: true}, test.xpToday)
			if award.Total != test.wantTotal {
				t.Fatalf("Total = %d, want %d", award.Total, test.wantTotal)
			}
			if award.CappedByDaily != test.wantCapped {
				t.Fatalf("CappedByDaily = %v, want %v", award.CappedByDaily, test.wantCapped)
			}
			if award.Source != SourcePractice {
				t.Fatalf("Source = %q", award.Source)
			}
		})
	}
}

func TestHandXP_PracticeIgnoresPlayOutcome(t *testing.T) {
	// §11.4 and §12.1: Practice pays participation XP only. A monster winning
	// hand against bots must not pay win, Zimo, Tai, or Kong bonuses.
	award := HandXP(HandOutcome{
		Practice: true,
		Won:      true,
		Zimo:     true,
		RawTai:   40,
		Kongs:    4,
	}, 0)

	if award.Total != PracticeHandXP {
		t.Fatalf("Total = %d, want the flat %d", award.Total, PracticeHandXP)
	}
}

func TestHandXP_Public(t *testing.T) {
	tests := []struct {
		name    string
		outcome HandOutcome
		want    int
	}{
		{
			name:    "completing a hand without winning",
			outcome: HandOutcome{},
			want:    100,
		},
		{
			name:    "a discard win with 3 Tai",
			outcome: HandOutcome{Won: true, RawTai: 3},
			want:    100 + 75 + 30,
		},
		{
			name:    "a Zimo win with 3 Tai",
			outcome: HandOutcome{Won: true, Zimo: true, RawTai: 3},
			want:    100 + 75 + 25 + 30,
		},
		{
			// Tai bonus caps at 100 per hand, so a huge hand does not run away.
			name:    "Tai bonus is capped at 100",
			outcome: HandOutcome{Won: true, RawTai: 45},
			want:    100 + 75 + 100,
		},
		{
			name:    "exactly at the Tai cap",
			outcome: HandOutcome{Won: true, RawTai: 10},
			want:    100 + 75 + 100,
		},
		{
			// Kongs pay whether or not the hand was won.
			name:    "Kongs pay on a lost hand",
			outcome: HandOutcome{Kongs: 2},
			want:    100 + 10,
		},
		{
			name:    "Kong bonus is capped at 20",
			outcome: HandOutcome{Kongs: 9},
			want:    100 + 20,
		},
		{
			// §12.1: takeover for more than half the hand earns completion only.
			name:    "a taken-over seat earns completion XP only",
			outcome: HandOutcome{Won: true, Zimo: true, RawTai: 10, Kongs: 4, TakenOverMajority: true},
			want:    100,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			award := HandXP(test.outcome, 0)
			if award.Total != test.want {
				t.Fatalf("Total = %d, want %d (components %+v)", award.Total, test.want, award.Components)
			}
			if award.Source != SourcePublicHand {
				t.Fatalf("Source = %q", award.Source)
			}
		})
	}
}

func TestHandXP_ComponentsSumToTotal(t *testing.T) {
	// The result screen shows the breakdown; if it does not add up to the
	// total the player is being shown arithmetic that does not work.
	outcomes := []HandOutcome{
		{},
		{Won: true, RawTai: 5},
		{Won: true, Zimo: true, RawTai: 12, Kongs: 3},
		{Kongs: 1},
		{TakenOverMajority: true, Won: true},
		{Practice: true},
	}
	for _, outcome := range outcomes {
		award := HandXP(outcome, 0)
		sum := 0
		for _, component := range award.Components {
			sum += component.Amount
		}
		if sum != award.Total {
			t.Fatalf("components %+v sum to %d, want %d", award.Components, sum, award.Total)
		}
	}
}

func TestHandXP_PublicHasNoDailyCap(t *testing.T) {
	// The Practice cap must not leak into public play: a heavy day of public
	// hands keeps paying full price.
	award := HandXP(HandOutcome{Won: true}, 10_000)
	if award.Total != 100+75 || award.CappedByDaily {
		t.Fatalf("award = %+v, want an uncapped public award", award)
	}
}

func TestXPToAdvance(t *testing.T) {
	// Each Alpha level takes more XP than the one before it.
	cases := map[int]int{1: 500, 2: 600, 3: 700, 9: 1_300}
	for level, want := range cases {
		if got := XPToAdvance(level); got != want {
			t.Fatalf("XPToAdvance(%d) = %d, want %d", level, got, want)
		}
	}
}

func TestLevelCurveContainsEveryThresholdAndReward(t *testing.T) {
	curve := LevelCurve()
	if len(curve) != MaxLevel {
		t.Fatalf("curve length = %d, want %d", len(curve), MaxLevel)
	}
	if curve[0].Level != 1 || curve[0].TotalXPRequired != 0 ||
		curve[0].XPForNextLevel != 500 {
		t.Fatalf("level 1 = %+v", curve[0])
	}
	if curve[1].Level != 2 || curve[1].TotalXPRequired != 500 ||
		len(curve[1].Rewards) != 1 || curve[1].Rewards[0].Code == "" {
		t.Fatalf("level 2 = %+v", curve[1])
	}
	last := curve[len(curve)-1]
	if last.Level != MaxLevel || last.XPForNextLevel != 0 {
		t.Fatalf("last level = %+v", last)
	}
	if len(last.Rewards) != 2 {
		t.Fatalf("level 10 rewards = %+v, want Jade and Alpha Max placeholders", last.Rewards)
	}
	for index := 1; index < len(curve); index++ {
		want := curve[index-1].TotalXPRequired + curve[index-1].XPForNextLevel
		if curve[index].TotalXPRequired != want {
			t.Fatalf(
				"level %d total = %d, want %d",
				curve[index].Level,
				curve[index].TotalXPRequired,
				want,
			)
		}
	}
}

func TestLevelForXP(t *testing.T) {
	tests := []struct {
		name       string
		xp         int
		wantLevel  int
		wantInto   int
		wantNeeded int
		wantAtCap  bool
	}{
		{name: "a new account", xp: 0, wantLevel: 1, wantInto: 0, wantNeeded: 500},
		{name: "part way through level 1", xp: 499, wantLevel: 1, wantInto: 499, wantNeeded: 500},
		{name: "exactly level 2", xp: 500, wantLevel: 2, wantInto: 0, wantNeeded: 600},
		{name: "part way through level 2", xp: 1_000, wantLevel: 2, wantInto: 500, wantNeeded: 600},
		{name: "exactly level 3", xp: 1_100, wantLevel: 3, wantInto: 0, wantNeeded: 700},
		{name: "negative XP cannot happen, and does not panic", xp: -50, wantLevel: 1, wantNeeded: 500},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := LevelForXP(test.xp)
			if got.Level != test.wantLevel || got.XPIntoLevel != test.wantInto ||
				got.XPForNextLevel != test.wantNeeded || got.AtCap != test.wantAtCap {
				t.Fatalf("LevelForXP(%d) = %+v", test.xp, got)
			}
		})
	}
}

func TestLevelForXP_CapsAtAlphaLevelTen(t *testing.T) {
	// Total XP to reach Alpha level 10 is the sum of levels 1..9.
	total := 0
	for level := 1; level < MaxLevel; level++ {
		total += XPToAdvance(level)
	}

	justBelow := LevelForXP(total - 1)
	if justBelow.Level != MaxLevel-1 || justBelow.AtCap {
		t.Fatalf("one XP short of the cap = %+v, want level %d", justBelow, MaxLevel-1)
	}

	atCap := LevelForXP(total)
	if atCap.Level != MaxLevel || !atCap.AtCap {
		t.Fatalf("at cap = %+v, want level %d", atCap, MaxLevel)
	}

	// §12.2: excess XP is retained but does not display a higher level.
	beyond := LevelForXP(total * 10)
	if beyond.Level != MaxLevel || beyond.LifetimeXP != total*10 {
		t.Fatalf("beyond cap = %+v, want level %d with lifetime XP retained", beyond, MaxLevel)
	}
}

func TestLevelForXP_IsMonotonic(t *testing.T) {
	// Level must never decrease as XP rises — the one property a player would
	// notice immediately and never forgive.
	previous := 0
	for xp := 0; xp < 200_000; xp += 137 {
		level := LevelForXP(xp).Level
		if level < previous {
			t.Fatalf("level fell from %d to %d at %d XP", previous, level, xp)
		}
		previous = level
	}
}

func TestRewards(t *testing.T) {
	if got := len(EarnedRewards(1)); got != 0 {
		t.Fatalf("level 1 earned %d rewards, want 0", got)
	}
	if got := EarnedRewards(2); len(got) != 1 || got[0].Name != "Student" {
		t.Fatalf("level 2 rewards = %+v", got)
	}
	// Alpha level 10 grants two rewards.
	if got := len(EarnedRewards(MaxLevel)); got != len(LevelRewards()) {
		t.Fatalf("level %d earned %d of %d rewards", MaxLevel, got, len(LevelRewards()))
	}

	next := NextReward(1)
	if next == nil || next.Level != 2 || next.Name != "Student" {
		t.Fatalf("NextReward(1) = %+v", next)
	}
	if got := NextReward(MaxLevel); got != nil {
		t.Fatalf("NextReward at cap = %+v, want nil", got)
	}
}

func TestEarnedRewardsNeverShrink(t *testing.T) {
	// §12.2 forbids revoking an already granted entitlement. Deriving rewards
	// from level makes that structural, so pin it.
	previous := 0
	for level := 1; level <= MaxLevel; level++ {
		count := len(EarnedRewards(level))
		if count < previous {
			t.Fatalf("rewards fell from %d to %d at level %d", previous, count, level)
		}
		previous = count
	}
}
