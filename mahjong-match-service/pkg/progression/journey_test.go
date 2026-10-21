package progression

import (
	"testing"
	"time"
)

func TestJourneyAnniversaries(t *testing.T) {
	first := time.Date(2020, 2, 29, 18, 30, 0, 0, time.UTC)
	for _, tc := range []struct {
		name, now string
		count     int64
		years     int
	}{
		{"no completed game", "2026-03-01T00:00:00Z", 0, 0},
		{"before anniversary", "2025-02-27T23:59:59Z", 12, 4},
		{"leap anniversary uses February 28", "2025-02-28T00:00:00Z", 12, 5},
		{"leap year waits for February 29", "2024-02-28T23:59:59Z", 12, 3},
		{"leap year anniversary", "2024-02-29T00:00:00Z", 12, 4},
		{"future completion is not earned", "2019-01-01T00:00:00Z", 12, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			now, err := time.Parse(time.RFC3339, tc.now)
			if err != nil {
				t.Fatal(err)
			}
			got := JourneyFromRotations(tc.count, first, now)
			if len(got.Anniversaries) != tc.years {
				t.Fatalf("anniversaries = %d, want %d", len(got.Anniversaries), tc.years)
			}
			if tc.years == 5 {
				gift := got.Anniversaries[4]
				if gift.Material != "Wood" || gift.CosmeticCode != "anniversary-5" || gift.EarnedAt != "2025-02-28" {
					t.Fatalf("gift = %+v", gift)
				}
			}
		})
	}
}

func TestJourneyCalendarUsesUTCAndPermanentHistory(t *testing.T) {
	first := time.Date(2020, 7, 1, 23, 0, 0, 0, time.FixedZone("west", -7*3600))
	now := time.Date(2030, 7, 2, 0, 0, 0, 0, time.UTC)
	got := JourneyFromRotations(1, first, now)
	if len(got.Anniversaries) != 10 || got.FirstCompletedAt != "2020-07-02T06:00:00Z" {
		t.Fatalf("journey = %+v", got)
	}
	if got.Anniversaries[9].Material != "Tin" {
		t.Fatal("ten-year cosmetic missing")
	}
	if got.Anniversaries[0].CosmeticCode != "" {
		t.Fatal("ordinary anniversaries grant badges only")
	}
	if len(got.Prestige) != 7 || got.Prestige[6].Games != 5000 {
		t.Fatal("draft Prestige catalog missing")
	}
}

func TestJourneyAllAnniversaryMilestonesWithoutActivity(t *testing.T) {
	first := time.Date(2000, 2, 29, 12, 0, 0, 0, time.UTC)
	now := time.Date(2060, 2, 29, 12, 0, 0, 0, time.UTC)
	journey := JourneyFromRotations(1, first, now)
	if journey.CompletedRotations != 1 || len(journey.Anniversaries) != 60 {
		t.Fatalf("inactive player journey = %+v", journey)
	}
	want := map[int]string{5: "Wood", 10: "Tin", 15: "Crystal", 20: "Porcelain", 25: "Silver", 30: "Pearl", 40: "Ruby", 50: "Gold", 60: "Diamond"}
	for _, badge := range journey.Anniversaries {
		if badge.Material != want[badge.Year] {
			t.Fatalf("year %d material = %q, want %q", badge.Year, badge.Material, want[badge.Year])
		}
		if (badge.CosmeticCode != "") != (want[badge.Year] != "") {
			t.Fatalf("year %d eligibility code = %q", badge.Year, badge.CosmeticCode)
		}
	}
	// Repeated visits do not advance rotations or create duplicate badges.
	again := JourneyFromRotations(1, first, now)
	if again.CompletedRotations != journey.CompletedRotations || len(again.Anniversaries) != len(journey.Anniversaries) {
		t.Fatalf("repeat projection changed progress: %+v", again)
	}
}

func TestJourneyPrestigeDefaultsCannotBeMutatedAcrossPlayers(t *testing.T) {
	one := PrestigeCatalog()
	one[0].Games = 999
	one[0].Title = "changed"
	other := PrestigeCatalog()
	if other[0].Games != 1 || other[0].Title != "Newcomer" {
		t.Fatalf("shared mutable defaults: %+v", other)
	}
}
