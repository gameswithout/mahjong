package progression

import (
	"context"
	"fmt"
	"time"
)

// Journey is independent of XP, Elo, and hand counts. Its source is committed
// full-rotation records, including bot-supported and private rotations.
type Journey struct {
	Prestige           []PrestigeStep
	CompletedRotations int64
	FirstCompletedAt   string
	Anniversaries      []Anniversary
}

type PrestigeStep struct {
	Games   int64
	Title   string
	Chapter string
}

// Product-approved draft defaults; kept on the server to avoid client drift.
func PrestigeCatalog() []PrestigeStep {
	return []PrestigeStep{
		{1, "Newcomer", "First Seat"},
		{10, "Table Regular", "Familiar Table"},
		{50, "Familiar Face", "A Place of Your Own"},
		{100, "Mahjong Veteran", "Veteran’s Room"},
		{500, "Table Elder", "Gathering Place"},
		{1000, "Mahjong Luminary", "Hall of Memories"},
		{5000, "Living Legend", "A Lifetime at the Table"},
	}
}

type Anniversary struct {
	Year         int
	EarnedAt     string
	Material     string
	CosmeticCode string
}

type JourneyRepository interface {
	PlayerJourney(context.Context, string) (Journey, error)
}

var anniversaryMaterials = map[int]string{
	5: "Wood", 10: "Tin", 15: "Crystal", 20: "Porcelain", 25: "Silver",
	30: "Pearl", 40: "Ruby", 50: "Gold", 60: "Diamond",
}

// Anniversary date policy uses UTC calendar dates. February 29 anniversaries
// fall on February 28 in non-leap years. No login or activity is required.
func JourneyFromRotations(count int64, first, now time.Time) Journey {
	journey := Journey{CompletedRotations: count, Anniversaries: []Anniversary{}, Prestige: PrestigeCatalog()}
	if count <= 0 || first.IsZero() || first.After(now) {
		journey.CompletedRotations = 0
		return journey
	}
	first, now = first.UTC(), now.UTC()
	journey.FirstCompletedAt = first.Format(time.RFC3339)
	for year := 1; year <= now.Year()-first.Year(); year++ {
		month, day := first.Month(), first.Day()
		last := time.Date(first.Year()+year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
		if day > last {
			day = last
		}
		date := time.Date(first.Year()+year, month, day, 0, 0, 0, 0, time.UTC)
		if date.After(now) {
			break
		}
		material := anniversaryMaterials[year]
		code := ""
		if material != "" {
			code = fmt.Sprintf("anniversary-%d", year)
		}
		journey.Anniversaries = append(journey.Anniversaries, Anniversary{
			Year: year, EarnedAt: date.Format("2006-01-02"), Material: material, CosmeticCode: code,
		})
	}
	return journey
}
