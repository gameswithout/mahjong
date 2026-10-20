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
