package progression

import (
	"testing"

	"github.com/gameswithout/mahjong/rulesengine"
)

func winningView(seat rulesengine.Seat, rawTai int, patterns ...string) rulesengine.SeatView {
	scored := make([]rulesengine.PatternScore, 0, len(patterns))
	for _, name := range patterns {
		scored = append(scored, rulesengine.PatternScore{Name: name, Tai: 1})
	}
	return rulesengine.SeatView{
		Seat: seat,
		HandResult: &rulesengine.HandResult{
			Kind: rulesengine.WinZimo,
			Winners: []rulesengine.HandWinner{{
				Seat:  seat,
				Score: rulesengine.ScoreResult{RawTai: rawTai, Patterns: scored},
			}},
		},
	}
}

func statValue(updates []StatUpdate, code string) (StatUpdate, bool) {
	for _, update := range updates {
		if update.StatCode == code {
			return update, true
		}
	}
	return StatUpdate{}, false
}

func TestHandStats_PracticeAwardsNothing(t *testing.T) {
	updates := HandStats(
		HandOutcome{Practice: true, Won: true, Zimo: true, RawTai: 40, Kongs: 4},
		winningView(rulesengine.East, 40, "All Pongs", "Full Flush"),
	)
	if len(updates) != 0 {
		t.Fatalf("Practice recorded achievement stats: %+v", updates)
	}
}

func TestHandStats_CompletedHandCountsEvenWhenLost(t *testing.T) {
	updates := HandStats(HandOutcome{}, rulesengine.SeatView{
		HandResult: &rulesengine.HandResult{Kind: rulesengine.KindExhaustiveDraw},
	})

	if len(updates) != 1 {
		t.Fatalf("updates = %+v, want only the completed-hand counter", updates)
	}
	completed, ok := statValue(updates, StatPublicHandsCompleted)
	if !ok || completed.Value != 1 || completed.Strategy != StatIncrement {
		t.Fatalf("completed counter = %+v (found=%v)", completed, ok)
	}
	// A lost hand is not a won hand.
	if _, won := statValue(updates, StatPublicHandsWon); won {
		t.Fatal("a lost hand incremented the win counter")
	}
}

func TestHandStats_WinCountsWinAndZimo(t *testing.T) {
	updates := HandStats(
		HandOutcome{Won: true, Zimo: true, RawTai: 6},
		winningView(rulesengine.East, 6),
	)

	for _, code := range []string{StatPublicHandsCompleted, StatPublicHandsWon, StatZimoWins} {
		update, ok := statValue(updates, code)
		if !ok || update.Value != 1 || update.Strategy != StatIncrement {
			t.Fatalf("%s = %+v (found=%v)", code, update, ok)
		}
	}
}

func TestHandStats_DiscardWinDoesNotCountZimo(t *testing.T) {
	view := winningView(rulesengine.East, 4)
	view.HandResult.Kind = rulesengine.WinDiscard

	updates := HandStats(HandOutcome{Won: true, Zimo: false, RawTai: 4}, view)

	if _, ok := statValue(updates, StatZimoWins); ok {
		t.Fatal("a discard win incremented the Zimo counter")
	}
	if _, ok := statValue(updates, StatPublicHandsWon); !ok {
		t.Fatal("a discard win did not count as a win")
	}
}

func TestHandStats_HighestRawTaiUsesMaxNotIncrement(t *testing.T) {
	// §12.3's High Value and Master Craft ask for one hand worth at least N
	// Tai. Incrementing a lifetime total would unlock them for a player who
	// never scored a big hand.
	updates := HandStats(
		HandOutcome{Won: true, RawTai: 12},
		winningView(rulesengine.East, 12),
	)

	tai, ok := statValue(updates, StatHighestRawTai)
	if !ok {
		t.Fatal("no highest-raw-tai stat emitted for a winning hand")
	}
	if tai.Strategy != StatMax {
		t.Fatalf("highest-raw-tai strategy = %q, want %q", tai.Strategy, StatMax)
	}
	if tai.Value != 12 {
		t.Fatalf("highest-raw-tai value = %v, want 12", tai.Value)
	}
}

func TestHandStats_KongsPayOnALostHand(t *testing.T) {
	// Kongs are declared during play, so they count whether or not the hand
	// was won — matching how §12.1 pays their XP.
	updates := HandStats(HandOutcome{Kongs: 3}, rulesengine.SeatView{
		HandResult: &rulesengine.HandResult{Kind: rulesengine.KindExhaustiveDraw},
	})

	kongs, ok := statValue(updates, StatKongsDeclared)
	if !ok || kongs.Value != 3 {
		t.Fatalf("kongs = %+v (found=%v), want 3", kongs, ok)
	}
}

func TestHandStats_TakenOverSeatCountsOnlyTheCompletedHand(t *testing.T) {
	// A seat played mostly by a bot was still present for the hand, but the
	// player did not earn its quality — mirroring §12.1's completion-XP-only rule.
	updates := HandStats(
		HandOutcome{Won: true, Zimo: true, RawTai: 20, Kongs: 2, TakenOverMajority: true},
		winningView(rulesengine.East, 20, "All Pongs"),
	)

	if len(updates) != 1 {
		t.Fatalf("updates = %+v, want only the completed-hand counter", updates)
	}
	if _, ok := statValue(updates, StatPublicHandsCompleted); !ok {
		t.Fatal("taken-over seat did not count the completed hand")
	}
}

func TestHandStats_PatternWins(t *testing.T) {
	updates := HandStats(
		HandOutcome{Won: true, RawTai: 16},
		winningView(rulesengine.East, 16, "All Pongs", "Full Flush", "Big Three Dragons"),
	)

	for _, code := range []string{"wins-all-pongs", "wins-full-flush", "wins-big-three-dragons"} {
		update, ok := statValue(updates, code)
		if !ok || update.Value != 1 || update.Strategy != StatIncrement {
			t.Fatalf("%s = %+v (found=%v)", code, update, ok)
		}
	}
}

func TestHandStats_UnawardedPatternsScoreNothing(t *testing.T) {
	// Most scoring patterns have no §12.3 achievement. They must be ignored
	// silently rather than inventing a stat code.
	//
	// Asserted against the pattern codes specifically rather than against an
	// allow-list of everything else a win writes: the base counters grow as
	// the dashboard does, and a test that has to be edited each time one is
	// added stops testing what it is named for.
	updates := HandStats(
		HandOutcome{Won: true, RawTai: 3},
		winningView(rulesengine.East, 3, "Base Win", "Seat Wind Set", "Single Wait"),
	)

	patternCodes := map[string]bool{}
	for _, code := range patternStatCodes {
		patternCodes[code] = true
	}
	for _, update := range updates {
		if patternCodes[update.StatCode] {
			t.Fatalf("unawarded pattern produced pattern stat %q", update.StatCode)
		}
	}
}

func TestHandStats_NeverRepeatsAStatCode(t *testing.T) {
	// The v2 bulk API processes entries concurrently and warns against
	// repeating a statCode in one request. Complete Seasons and Complete
	// Flowers both map to wins-complete-flowers, and the concealed-Pong tiers
	// all map to wins-concealed-pongs, so this is reachable in real play.
	updates := HandStats(
		HandOutcome{Won: true, RawTai: 30, Kongs: 2},
		winningView(rulesengine.East, 30,
			"Complete Seasons", "Complete Flowers",
			"Three Concealed Pongs", "Four Concealed Pongs", "Five Concealed Pongs",
		),
	)

	seen := map[string]int{}
	for _, update := range updates {
		seen[update.StatCode]++
	}
	for code, count := range seen {
		if count > 1 {
			t.Fatalf("stat %q appeared %d times in one batch: %+v", code, count, updates)
		}
	}
	if _, ok := statValue(updates, "wins-complete-flowers"); !ok {
		t.Fatal("Complete Seasons/Flowers did not produce its stat")
	}
	if _, ok := statValue(updates, "wins-concealed-pongs"); !ok {
		t.Fatal("concealed Pong tiers did not produce their stat")
	}
}

func TestHandStats_AnotherSeatsWinIsNotOurs(t *testing.T) {
	// The projection carries every winner. Only the local seat's own win may
	// move the local player's stats.
	view := winningView(rulesengine.South, 20, "All Pongs")
	view.Seat = rulesengine.East

	updates := HandStats(HandOutcome{Won: false}, view)

	if _, ok := statValue(updates, "wins-all-pongs"); ok {
		t.Fatal("another seat's winning pattern counted for this player")
	}
	if _, ok := statValue(updates, StatPublicHandsWon); ok {
		t.Fatal("another seat's win counted as this player's win")
	}
}

func TestHandStats_EveryMappedPatternHasADistinctIntent(t *testing.T) {
	// Guards the mapping table itself: every stat code it targets must be one
	// of the definitions actually configured in the namespace. A typo here is
	// a silent no-op in production, not an error.
	configured := map[string]bool{
		"wins-all-pongs": true, "wins-full-flush": true, "wins-half-flush": true,
		"wins-big-three-dragons": true, "wins-big-four-winds": true,
		"wins-all-honors": true, "wins-eight-flowers": true,
		"wins-robbing-kong": true, "wins-after-replacement": true,
		"wins-last-tile-zimo": true, "wins-concealed-zimo": true,
		"wins-concealed-pongs": true, "wins-complete-flowers": true,
	}
	for pattern, code := range patternStatCodes {
		if !configured[code] {
			t.Fatalf("pattern %q maps to unconfigured stat code %q", pattern, code)
		}
	}
}

// P2.3 dashboard statistics. These count against hands completed rather than
// hands won, so unlike every achievement stat above they have to be recorded
// for seats that lost — a deal-in only ever happens on a hand you did not win.

func TestOutcomeFromView_ReadsDealtInAndTing(t *testing.T) {
	view := rulesengine.SeatView{
		Seat:  rulesengine.South,
		Waits: []rulesengine.WaitTileView{{VisibleRemaining: 2}},
		HandResult: &rulesengine.HandResult{
			Kind:  rulesengine.WinDiscard,
			Payer: rulesengine.South,
			Winners: []rulesengine.HandWinner{{
				Seat: rulesengine.East, Score: rulesengine.ScoreResult{RawTai: 3},
			}},
		},
	}

	outcome, ok := OutcomeFromView(view, false, false)
	if !ok {
		t.Fatal("completed hand was not priced")
	}
	if !outcome.DealtIn {
		t.Error("the seat named as payer on a discard win did not register a deal-in")
	}
	if !outcome.Ting {
		t.Error("a seat holding a wait list at hand end did not register Ting")
	}
	if outcome.Won {
		t.Error("another seat's win was credited to this one")
	}
}

func TestOutcomeFromView_ZimoBlamesNobody(t *testing.T) {
	// Payer is only meaningful for a discard win. A self-drawn win must not
	// leave some seat carrying a deal-in for a tile nobody discarded.
	view := winningView(rulesengine.East, 4)
	for _, seat := range []rulesengine.Seat{rulesengine.East, rulesengine.South} {
		view.Seat = seat
		outcome, _ := OutcomeFromView(view, false, false)
		if outcome.DealtIn {
			t.Errorf("seat %s registered a deal-in on a Zimo win", seat)
		}
	}
}

func TestHandStats_RecordsDealInAndTingOnALostHand(t *testing.T) {
	updates := HandStats(
		HandOutcome{DealtIn: true, Ting: true},
		rulesengine.SeatView{Seat: rulesengine.South},
	)

	for _, code := range []string{StatPublicHandsCompleted, StatPublicHandsDealtIn, StatPublicHandsTing} {
		update, found := statValue(updates, code)
		if !found {
			t.Fatalf("%s was not recorded", code)
		}
		if update.Strategy != StatIncrement || update.Value != 1 {
			t.Errorf("%s = %s %v, want INCREMENT 1", code, update.Strategy, update.Value)
		}
	}
}

func TestHandStats_DashboardStatsHonourTheExistingExclusions(t *testing.T) {
	practice := HandStats(
		HandOutcome{Practice: true, DealtIn: true, Ting: true},
		rulesengine.SeatView{Seat: rulesengine.South},
	)
	if len(practice) != 0 {
		t.Errorf("Practice recorded %d stats, want none", len(practice))
	}

	takenOver := HandStats(
		HandOutcome{TakenOverMajority: true, DealtIn: true, Ting: true},
		rulesengine.SeatView{Seat: rulesengine.South},
	)
	for _, code := range []string{StatPublicHandsDealtIn, StatPublicHandsTing} {
		if _, found := statValue(takenOver, code); found {
			t.Errorf("a mostly-bot seat recorded %s", code)
		}
	}
	if _, found := statValue(takenOver, StatPublicHandsCompleted); !found {
		t.Error("a mostly-bot seat did not record the completed hand")
	}
}

func TestHandStats_TotalRawTaiAccumulatesAlongsideTheBest(t *testing.T) {
	updates := HandStats(
		HandOutcome{Won: true, RawTai: 12, Seat: rulesengine.South},
		winningView(rulesengine.South, 12),
	)
	total, ok := statValue(updates, StatTotalRawTai)
	if !ok || total.Strategy != StatIncrement || total.Value != 12 {
		t.Fatalf("total raw Tai = %+v (found=%v), want INCREMENT 12", total, ok)
	}
	best, ok := statValue(updates, StatHighestRawTai)
	if !ok || best.Strategy != StatMax || best.Value != 12 {
		t.Fatalf("highest raw Tai = %+v (found=%v), want MAX 12", best, ok)
	}
	// The average needs both a sum and a count; the win counter is the
	// denominator, so a win worth Tai must always write all three.
	if _, ok := statValue(updates, StatPublicHandsWon); !ok {
		t.Fatal("a win worth Tai did not record the win the average divides by")
	}
}

func TestHandStats_OpenedHandCountsTheCallRateNumerator(t *testing.T) {
	drawResult := rulesengine.SeatView{
		HandResult: &rulesengine.HandResult{Kind: rulesengine.KindExhaustiveDraw},
	}
	opened := HandStats(HandOutcome{Opened: true, Seat: rulesengine.West}, drawResult)
	if _, ok := statValue(opened, StatPublicHandsOpened); !ok {
		t.Fatal("an opened hand did not record the call-rate numerator")
	}
	closed := HandStats(HandOutcome{Seat: rulesengine.West}, drawResult)
	if _, ok := statValue(closed, StatPublicHandsOpened); ok {
		t.Fatal("a closed hand recorded a call")
	}
}

// The tenpai-at-draw rate is only meaningful against draws. Being ready when
// somebody else won is a different fact and must not inflate the denominator.
func TestHandStats_TenpaiAtDrawOnlyCountsOnADraw(t *testing.T) {
	drawn := HandStats(
		HandOutcome{Ting: true, ExhaustiveDraw: true, Seat: rulesengine.East},
		rulesengine.SeatView{HandResult: &rulesengine.HandResult{Kind: rulesengine.KindExhaustiveDraw}},
	)
	if _, ok := statValue(drawn, StatPublicHandsDrawn); !ok {
		t.Fatal("a draw did not record the tenpai-at-draw denominator")
	}
	if _, ok := statValue(drawn, StatPublicHandsTingDraw); !ok {
		t.Fatal("ready at a draw did not record the numerator")
	}

	lost := HandStats(
		HandOutcome{Ting: true, Seat: rulesengine.East},
		winningView(rulesengine.South, 3),
	)
	if _, ok := statValue(lost, StatPublicHandsDrawn); ok {
		t.Fatal("a hand somebody won counted toward the draw denominator")
	}
	if _, ok := statValue(lost, StatPublicHandsTingDraw); ok {
		t.Fatal("ready when somebody else won counted as ready at a draw")
	}
	// It still counts toward the broader "ready at the end" statistic.
	if _, ok := statValue(lost, StatPublicHandsTing); !ok {
		t.Fatal("ready at the end of a lost hand was not recorded at all")
	}
}

func TestHandStats_SeatSplitRecordsHandAndWinSeparately(t *testing.T) {
	won := HandStats(
		HandOutcome{Won: true, RawTai: 4, Seat: rulesengine.North},
		winningView(rulesengine.North, 4),
	)
	if _, ok := statValue(won, "hands-seat-north"); !ok {
		t.Fatal("the seat's hand counter was not recorded")
	}
	if _, ok := statValue(won, "hands-won-seat-north"); !ok {
		t.Fatal("the seat's win counter was not recorded")
	}
	// A seat that played and lost still needs its denominator, or the seat
	// win rate would read 100% for every seat.
	lost := HandStats(
		HandOutcome{Seat: rulesengine.North},
		rulesengine.SeatView{HandResult: &rulesengine.HandResult{Kind: rulesengine.KindExhaustiveDraw}},
	)
	if _, ok := statValue(lost, "hands-seat-north"); !ok {
		t.Fatal("a lost hand did not record the seat denominator")
	}
	if _, ok := statValue(lost, "hands-won-seat-north"); ok {
		t.Fatal("a lost hand recorded a seat win")
	}
	// Only the seat that was played is touched.
	for _, code := range []string{"hands-seat-east", "hands-seat-south", "hands-seat-west"} {
		if _, ok := statValue(won, code); ok {
			t.Fatalf("playing North also recorded %s", code)
		}
	}
}

// Every dashboard code must actually be written by a completed hand, or the
// dashboard reads a stat nothing ever sets and shows a permanent zero.
func TestDashboardStatCodesAreAllWritten(t *testing.T) {
	writable := map[string]bool{}
	for _, seat := range []rulesengine.Seat{
		rulesengine.East, rulesengine.South, rulesengine.West, rulesengine.North,
	} {
		for _, outcome := range []HandOutcome{
			{Seat: seat, Won: true, Zimo: true, RawTai: 8, Kongs: 1, Opened: true, Ting: true, ExhaustiveDraw: true},
			{Seat: seat, DealtIn: true},
		} {
			for _, update := range HandStats(outcome, winningView(seat, 8)) {
				writable[update.StatCode] = true
			}
		}
	}
	// Tile efficiency is counted by replaying a hand's events rather than by
	// HandStats, so it is excluded here and covered by its own test.
	replayed := map[string]bool{StatDiscardsMade: true, StatDiscardsEfficient: true}
	for _, code := range DashboardStatCodes() {
		if replayed[code] || writable[code] {
			continue
		}
		t.Errorf("dashboard reads %q but no completed hand ever writes it", code)
	}
}

func TestHandStats_TileEfficiencyRecordsBothCountersOrNeither(t *testing.T) {
	drawn := rulesengine.SeatView{
		HandResult: &rulesengine.HandResult{Kind: rulesengine.KindExhaustiveDraw},
	}
	counted := HandStats(
		HandOutcome{Seat: rulesengine.East, DiscardsMade: 18, DiscardsEfficient: 13},
		drawn,
	)
	made, ok := statValue(counted, StatDiscardsMade)
	if !ok || made.Value != 18 {
		t.Fatalf("discards made = %+v (found=%v), want 18", made, ok)
	}
	efficient, ok := statValue(counted, StatDiscardsEfficient)
	if !ok || efficient.Value != 13 {
		t.Fatalf("efficient discards = %+v (found=%v), want 13", efficient, ok)
	}

	// A hand whose tally was lost must contribute neither half. Writing the
	// denominator alone would drag the player's efficiency toward zero for a
	// hand they may have played perfectly.
	lost := HandStats(HandOutcome{Seat: rulesengine.East}, drawn)
	if _, ok := statValue(lost, StatDiscardsMade); ok {
		t.Fatal("a hand with no tally recorded a discard denominator")
	}
	if _, ok := statValue(lost, StatDiscardsEfficient); ok {
		t.Fatal("a hand with no tally recorded an efficiency numerator")
	}
}

// WithDiscardEfficiency is the only way these counters get set, so it is the
// place a nonsensical tally has to be refused.
func TestWithDiscardEfficiencyRejectsAnImpossibleTally(t *testing.T) {
	for _, testCase := range []struct {
		name            string
		made, efficient int
	}{
		{"more efficient than made", 3, 5},
		{"no discards", 0, 0},
		{"negative", -1, -1},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			outcome := HandOutcome{Seat: rulesengine.South}
			WithDiscardEfficiency(testCase.made, testCase.efficient)(&outcome)
			if outcome.DiscardsMade != 0 || outcome.DiscardsEfficient != 0 {
				t.Fatalf("accepted %d of %d: %+v", testCase.efficient, testCase.made, outcome)
			}
		})
	}

	outcome := HandOutcome{Seat: rulesengine.South}
	WithDiscardEfficiency(18, 18)(&outcome)
	if outcome.DiscardsMade != 18 || outcome.DiscardsEfficient != 18 {
		t.Fatalf("a perfect hand was refused: %+v", outcome)
	}
}
