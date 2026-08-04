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
	updates := HandStats(
		HandOutcome{Won: true, RawTai: 3},
		winningView(rulesengine.East, 3, "Base Win", "Seat Wind Set", "Single Wait"),
	)

	for _, update := range updates {
		switch update.StatCode {
		case StatPublicHandsCompleted, StatPublicHandsWon, StatHighestRawTai:
		default:
			t.Fatalf("unawarded pattern produced stat %q", update.StatCode)
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
