package rulesengine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type goldenScoringFile struct {
	Version int                 `json:"version"`
	Cases   []goldenScoringCase `json:"cases"`
}

type goldenScoringCase struct {
	Name    string           `json:"name"`
	Hand    []string         `json:"hand"`
	Melds   []goldenMeld     `json:"melds"`
	Flowers []string         `json:"flowers"`
	Context ScoreContext     `json:"context"`
	Expect  goldenScoreCheck `json:"expect"`
}

type goldenMeld struct {
	Type      MeldType `json:"type"`
	Tiles     []string `json:"tiles"`
	Concealed bool     `json:"concealed"`
	Added     bool     `json:"added"`
	Claimed   bool     `json:"claimed"`
}

type goldenScoreCheck struct {
	Winning  bool           `json:"winning"`
	RawTai   int            `json:"raw_tai"`
	Patterns map[string]int `json:"patterns"`
}

type goldenSettlementFile struct {
	Version       int                      `json:"version"`
	Settlements   []goldenSettlementCase   `json:"settlements"`
	Continuations []goldenContinuationCase `json:"continuations"`
}

type goldenSettlementCase struct {
	Name          string           `json:"name"`
	Tier          string           `json:"tier"`
	Dealer        Seat             `json:"dealer"`
	Continuations int              `json:"continuations"`
	Result        goldenHandResult `json:"result"`
	Expect        struct {
		Net map[Seat]int64 `json:"net"`
	} `json:"expect"`
}

type goldenContinuationCase struct {
	Name   string           `json:"name"`
	Dealer Seat             `json:"dealer"`
	K      int              `json:"k"`
	Result goldenHandResult `json:"result"`
	Ting   bool             `json:"ting"`
	Expect struct {
		NextDealer Seat `json:"next_dealer"`
		NextK      int  `json:"next_k"`
		Retains    bool `json:"retains"`
	} `json:"expect"`
}

type goldenHandResult struct {
	Kind    WinKind `json:"kind"`
	Payer   Seat    `json:"payer"`
	Winners []struct {
		Seat   Seat `json:"seat"`
		RawTai int  `json:"raw_tai"`
	} `json:"winners"`
}

func (g goldenHandResult) toHandResult() *HandResult {
	result := &HandResult{Kind: g.Kind, Payer: g.Payer}
	for _, winner := range g.Winners {
		result.Winners = append(result.Winners, HandWinner{
			Seat:  winner.Seat,
			Score: ScoreResult{Winning: true, RawTai: winner.RawTai},
		})
	}
	return result
}

var goldenTiers = map[string]LobbyTier{
	"bamboo":    TierBambooCourtyard,
	"sparrow":   TierSparrowPavilion,
	"windcloud": TierWindAndCloudLounge,
	"dragons":   TierDragonsDen,
}

func loadGolden(t *testing.T, name string, target any) {
	t.Helper()
	encoded, err := os.ReadFile(filepath.Join("testdata", "goldens", name))
	if err != nil {
		t.Fatalf("read golden %s: %v", name, err)
	}
	if err := json.Unmarshal(encoded, target); err != nil {
		t.Fatalf("decode golden %s: %v", name, err)
	}
}

func tilesByID(t *testing.T, ids []string) []Tile {
	t.Helper()
	catalog := map[string]Tile{}
	for _, item := range Catalog() {
		catalog[item.ID] = item
	}
	tiles := make([]Tile, 0, len(ids))
	for _, id := range ids {
		item, ok := catalog[id]
		if !ok {
			t.Fatalf("unknown tile ID %q", id)
		}
		tiles = append(tiles, item)
	}
	return tiles
}

func TestGoldenScoringCases(t *testing.T) {
	var file goldenScoringFile
	loadGolden(t, "scoring.json", &file)
	if len(file.Cases) == 0 {
		t.Fatal("scoring golden file has no cases")
	}
	for _, testCase := range file.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			player := PlayerState{
				Seat:    testCase.Context.Seat,
				Hand:    tilesByID(t, testCase.Hand),
				Exposed: tilesByID(t, testCase.Flowers),
			}
			for _, meld := range testCase.Melds {
				player.Melds = append(player.Melds, Meld{
					Type:      meld.Type,
					Tiles:     tilesByID(t, meld.Tiles),
					Concealed: meld.Concealed,
					Added:     meld.Added,
					Claimed:   meld.Claimed,
				})
			}
			result, err := ScoreHand(player, testCase.Context)
			if err != nil {
				t.Fatalf("ScoreHand() error = %v", err)
			}
			if result.Winning != testCase.Expect.Winning {
				t.Fatalf("winning = %t, want %t", result.Winning, testCase.Expect.Winning)
			}
			if result.RawTai != testCase.Expect.RawTai {
				t.Fatalf("raw Tai = %d, want %d (patterns: %#v)", result.RawTai, testCase.Expect.RawTai, result.Patterns)
			}
			got := map[string]int{}
			for _, pattern := range result.Patterns {
				got[pattern.Name] += pattern.Tai
			}
			for name, tai := range testCase.Expect.Patterns {
				if got[name] != tai {
					t.Fatalf("pattern %q = %d, want %d (all: %#v)", name, got[name], tai, result.Patterns)
				}
			}
			for name, tai := range got {
				if _, expected := testCase.Expect.Patterns[name]; !expected {
					t.Fatalf("unexpected pattern %q (%d Tai); patterns: %#v", name, tai, result.Patterns)
				}
			}
		})
	}
}

func TestGoldenSettlementCases(t *testing.T) {
	var file goldenSettlementFile
	loadGolden(t, "settlement.json", &file)
	if len(file.Settlements) == 0 || len(file.Continuations) == 0 {
		t.Fatal("settlement golden file is missing cases")
	}
	for _, testCase := range file.Settlements {
		t.Run(testCase.Name, func(t *testing.T) {
			tier, ok := goldenTiers[testCase.Tier]
			if !ok {
				t.Fatalf("unknown tier %q", testCase.Tier)
			}
			settlement, err := SettleHand(SettlementInput{
				Tier:          tier,
				Dealer:        testCase.Dealer,
				Continuations: testCase.Continuations,
				Result:        testCase.Result.toHandResult(),
			})
			if err != nil {
				t.Fatalf("SettleHand() error = %v", err)
			}
			assertConservation(t, settlement, tier)
			for seat, want := range testCase.Expect.Net {
				if settlement.Net[seat] != want {
					t.Fatalf("net[%s] = %d, want %d (net: %#v)", seat, settlement.Net[seat], want, settlement.Net)
				}
			}
		})
	}
	for _, testCase := range file.Continuations {
		t.Run(testCase.Name, func(t *testing.T) {
			outcome, err := NextDealerState(testCase.Dealer, testCase.K, testCase.Result.toHandResult(), testCase.Ting)
			if err != nil {
				t.Fatalf("NextDealerState() error = %v", err)
			}
			want := ContinuationOutcome{
				NextDealer:        testCase.Expect.NextDealer,
				NextContinuations: testCase.Expect.NextK,
				DealerRetains:     testCase.Expect.Retains,
			}
			if outcome != want {
				t.Fatalf("outcome = %#v, want %#v", outcome, want)
			}
		})
	}
}
