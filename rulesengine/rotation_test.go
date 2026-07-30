package rulesengine

import (
	"testing"
	"time"
)

var rotationStart = time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)

func discardWin(winner, payer Seat, rawTai int) *HandResult {
	return &HandResult{
		Kind:  WinDiscard,
		Payer: payer,
		Winners: []HandWinner{{
			Seat:  winner,
			Score: ScoreResult{Winning: true, RawTai: rawTai},
		}},
	}
}

func zimoWin(winner Seat, rawTai int) *HandResult {
	return &HandResult{
		Kind: WinZimo,
		Winners: []HandWinner{{
			Seat:  winner,
			Score: ScoreResult{Winning: true, RawTai: rawTai},
		}},
	}
}

// nonDealerWinner picks a seat that is not currently dealing, so §5.11 rotates
// the dealership. Driving the rotation with a fixed winner does not work: the
// winner becomes the next dealer, then wins as dealer and retains.
func nonDealerWinner(dealer Seat) (winner, payer Seat) {
	order := []Seat{East, South, West, North}
	for index, seat := range order {
		if seat != dealer {
			return seat, order[(index+1)%len(order)]
		}
	}
	return South, West
}

func exhaustiveDraw() *HandResult {
	return &HandResult{Kind: KindExhaustiveDraw}
}

func TestRotationStartsWithEastDealingAndEveryoneOnZero(t *testing.T) {
	state := NewRotationState(rotationStart)

	if state.Dealer != East {
		t.Fatalf("opening dealer = %s, want East", state.Dealer)
	}
	if state.SeatsDealt() != 0 || state.HandsPlayed != 0 || state.Complete {
		t.Fatalf("fresh state = %+v", state)
	}
	for _, seat := range seats {
		if state.Tallies[seat].TablePoints != 0 {
			t.Fatalf("%s did not start on zero table points", seat)
		}
	}
}

func TestTablePointsAreUncappedAndUnmultiplied(t *testing.T) {
	// §8.4: same payer and multiple-winner rules as Jade, but no cap and no
	// stake multiplier. A hand that Bamboo would cap at 300 Jade must move its
	// full raw value in table points.
	state := NewRotationState(rotationStart)

	outcome, err := state.ApplyHand(discardWin(South, West, 45), false, rotationStart)
	if err != nil {
		t.Fatalf("ApplyHand() error = %v", err)
	}

	// 45 raw Tai, no dealer involvement, at one point per Tai.
	if got := outcome.State.Tallies[South].TablePoints; got != 45 {
		t.Fatalf("winner table points = %d, want 45", got)
	}
	if got := outcome.State.Tallies[West].TablePoints; got != -45 {
		t.Fatalf("payer table points = %d, want -45", got)
	}
	for _, transfer := range outcome.Settlement.Transfers {
		if transfer.Capped {
			t.Fatal("a table-point transfer was capped; §8.4 has no cap")
		}
	}
}

func TestTablePointsMayGoNegative(t *testing.T) {
	// §8.4 says so explicitly. Table points are not an account currency, so
	// nothing may clamp them at zero the way Jade is clamped.
	state := NewRotationState(rotationStart)

	// North pays every hand and never wins, so its total can only fall. The
	// exact figure is left to the settlement rules — the dealer Tai that
	// applies once the winner inherits the dealership is genuinely part of it.
	for hand := 0; hand < 3; hand++ {
		outcome, err := state.ApplyHand(discardWin(South, North, 10), false, rotationStart)
		if err != nil {
			t.Fatalf("hand %d: %v", hand, err)
		}
		state = outcome.State
	}

	if got := state.Tallies[North].TablePoints; got >= 0 {
		t.Fatalf("North table points = %d, want a negative total", got)
	}
	if got := state.Tallies[North].TablePoints; got > -30 {
		t.Fatalf("North table points = %d, want at least the 30 raw Tai it paid", got)
	}
}

func TestTablePointsSumToZeroEveryHand(t *testing.T) {
	// Conservation is the invariant worth pinning: table points are transfers,
	// so no hand may create or destroy them.
	state := NewRotationState(rotationStart)
	results := []*HandResult{
		discardWin(South, West, 7),
		zimoWin(East, 12),
		exhaustiveDraw(),
		discardWin(North, East, 3),
	}

	for index, result := range results {
		outcome, err := state.ApplyHand(result, false, rotationStart)
		if err != nil {
			t.Fatalf("hand %d: %v", index, err)
		}
		state = outcome.State

		total := int64(0)
		for _, tally := range state.Tallies {
			total += tally.TablePoints
		}
		if total != 0 {
			t.Fatalf("after hand %d the table totals %d, want 0", index, total)
		}
	}
}

func TestDealerRotatesAndTheRoundEndsWhenEverySeatHasDealt(t *testing.T) {
	state := NewRotationState(rotationStart)
	dealers := []Seat{}

	for hand := 0; hand < SeatCount; hand++ {
		dealers = append(dealers, state.Dealer)
		// The winner must not be the dealer, or §5.11 retains the dealership
		// and the rotation never advances.
		winner, payer := nonDealerWinner(state.Dealer)
		outcome, err := state.ApplyHand(discardWin(winner, payer, 2), false, rotationStart)
		if err != nil {
			t.Fatalf("hand %d: %v", hand, err)
		}
		state = outcome.State
		if hand < SeatCount-1 && state.Complete {
			t.Fatalf("match ended after %d hands, before every seat dealt", hand+1)
		}
	}

	if got := len(dealers); got != SeatCount {
		t.Fatalf("dealt %d hands", got)
	}
	if !state.Complete {
		t.Fatal("match did not end once every seat had dealt")
	}
	if state.CompletionReason != RotationCompletedRound {
		t.Fatalf("completion reason = %q, want the normal round ending", state.CompletionReason)
	}
}

func TestADealerContinuationDoesNotAdvanceTheRotation(t *testing.T) {
	// §5.11: a dealer win retains the dealership. That is a continuation, not
	// a second seat's turn, so the round must not count it as progress.
	state := NewRotationState(rotationStart)

	outcome, err := state.ApplyHand(zimoWin(East, 5), false, rotationStart)
	if err != nil {
		t.Fatalf("ApplyHand() error = %v", err)
	}
	state = outcome.State

	if state.Dealer != East {
		t.Fatalf("dealer = %s after a dealer win, want East retained", state.Dealer)
	}
	if state.Continuations == 0 {
		t.Fatal("a dealer win did not increment continuations")
	}
	if state.SeatsDealt() != 1 {
		t.Fatalf("seats dealt = %d, want just East", state.SeatsDealt())
	}
	if state.Complete {
		t.Fatal("match ended on a continuation")
	}
}

func TestTheMatchDoesNotEndWhileTheDealerRetains(t *testing.T) {
	// The base rotation is complete only when the dealership is genuinely
	// passing on. A fourth seat that keeps winning is still mid-turn.
	state := NewRotationState(rotationStart)
	for hand := 0; hand < 3; hand++ {
		winner, payer := nonDealerWinner(state.Dealer)
		outcome, err := state.ApplyHand(discardWin(winner, payer, 1), false, rotationStart)
		if err != nil {
			t.Fatalf("setup hand %d: %v", hand, err)
		}
		state = outcome.State
	}
	if state.Dealer != North || state.SeatsDealt() != 3 {
		t.Fatalf("expected North to be dealing with three seats dealt, got %s / %d", state.Dealer, state.SeatsDealt())
	}

	// North deals and wins: every seat has now dealt, but North retains.
	outcome, err := state.ApplyHand(zimoWin(North, 4), false, rotationStart)
	if err != nil {
		t.Fatalf("ApplyHand() error = %v", err)
	}
	if outcome.State.Complete {
		t.Fatal("match ended while the last dealer was still retaining")
	}
	if outcome.State.SeatsDealt() != SeatCount {
		t.Fatalf("seats dealt = %d, want all four", outcome.State.SeatsDealt())
	}

	// Once North finally loses the dealership, the round closes.
	final, err := outcome.State.ApplyHand(discardWin(East, South, 2), false, rotationStart)
	if err != nil {
		t.Fatalf("ApplyHand() error = %v", err)
	}
	if !final.State.Complete || final.State.CompletionReason != RotationCompletedRound {
		t.Fatalf("match did not close after the last dealership passed: %+v", final.State)
	}
}

func TestTheSixtyMinuteLimitEndsTheMatchAfterTheCurrentHand(t *testing.T) {
	// §8.4: at 60 minutes the current hand finishes and the match ends, even
	// with the rotation incomplete.
	state := NewRotationState(rotationStart)

	justInside := rotationStart.Add(MatchTimeLimit - time.Second)
	outcome, err := state.ApplyHand(discardWin(South, West, 3), false, justInside)
	if err != nil {
		t.Fatalf("ApplyHand() error = %v", err)
	}
	if outcome.State.Complete {
		t.Fatal("match ended one second before the limit")
	}

	atLimit := rotationStart.Add(MatchTimeLimit)
	outcome, err = outcome.State.ApplyHand(discardWin(South, West, 3), false, atLimit)
	if err != nil {
		t.Fatalf("ApplyHand() error = %v", err)
	}
	if !outcome.State.Complete {
		t.Fatal("match did not end at the 60-minute limit")
	}
	if outcome.State.CompletionReason != RotationCompletedTimeLimit {
		t.Fatalf("completion reason = %q, want the time limit", outcome.State.CompletionReason)
	}
	// The distinction matters: §8.4 makes the share of matches ending this way
	// a mandatory telemetry metric, which is impossible if it is recorded as
	// an ordinary ending.
	if outcome.State.SeatsDealt() >= SeatCount {
		t.Fatal("this case is only meaningful with the rotation incomplete")
	}
}

func TestACompletedMatchRefusesFurtherHands(t *testing.T) {
	state := NewRotationState(rotationStart)
	for hand := 0; hand < SeatCount; hand++ {
		winner, payer := nonDealerWinner(state.Dealer)
		outcome, err := state.ApplyHand(discardWin(winner, payer, 1), false, rotationStart)
		if err != nil {
			t.Fatalf("setup hand %d: %v", hand, err)
		}
		state = outcome.State
	}
	if !state.Complete {
		t.Fatal("setup did not complete the match")
	}

	if _, err := state.ApplyHand(discardWin(South, West, 1), false, rotationStart); err == nil {
		t.Fatal("a completed match accepted another hand")
	}
}

func TestApplyHandDoesNotMutateTheReceiver(t *testing.T) {
	// The state is a value so a replay of the same events lands in the same
	// place. A shared tally map would break that silently.
	state := NewRotationState(rotationStart)
	outcome, err := state.ApplyHand(discardWin(South, West, 9), false, rotationStart)
	if err != nil {
		t.Fatalf("ApplyHand() error = %v", err)
	}

	if state.Tallies[South].TablePoints != 0 {
		t.Fatal("ApplyHand mutated the receiver's tallies")
	}
	if state.HandsPlayed != 0 || state.Dealer != East {
		t.Fatalf("ApplyHand mutated the receiver: %+v", state)
	}
	if outcome.State.Tallies[South].TablePoints != 9 {
		t.Fatal("the returned state did not record the hand")
	}
}

func TestPlacementRanksByTablePoints(t *testing.T) {
	state := NewRotationState(rotationStart)
	state.Tallies[East].TablePoints = -12
	state.Tallies[South].TablePoints = 30
	state.Tallies[West].TablePoints = 5
	state.Tallies[North].TablePoints = -23

	placements, err := state.FinalPlacement([]Seat{East, South, West, North})
	if err != nil {
		t.Fatalf("FinalPlacement() error = %v", err)
	}

	order := []Seat{}
	for _, placement := range placements {
		order = append(order, placement.Seat)
	}
	want := []Seat{South, West, East, North}
	for index := range want {
		if order[index] != want[index] {
			t.Fatalf("placement order = %v, want %v", order, want)
		}
	}
	if placements[0].Position != 1 || placements[3].Position != 4 {
		t.Fatalf("positions not assigned: %+v", placements)
	}
}

func TestPlacementTieBreaksInTheOrderTheSpecLists(t *testing.T) {
	// §8.4: fewer deal-ins, then more Zimo wins, then greater raw Tai won,
	// then the initial seat order. Each level is only consulted when the ones
	// above it are equal.
	base := func() RotationState {
		state := NewRotationState(rotationStart)
		for _, seat := range seats {
			state.Tallies[seat].TablePoints = 10
		}
		return state
	}

	byDealIns := base()
	byDealIns.Tallies[West].DealIns = 0
	byDealIns.Tallies[East].DealIns = 3
	byDealIns.Tallies[South].DealIns = 3
	byDealIns.Tallies[North].DealIns = 3
	placements, err := byDealIns.FinalPlacement([]Seat{East, South, West, North})
	if err != nil {
		t.Fatalf("FinalPlacement() error = %v", err)
	}
	if placements[0].Seat != West {
		t.Fatalf("fewer deal-ins did not win the tie: %s led", placements[0].Seat)
	}

	byZimo := base()
	byZimo.Tallies[North].ZimoWins = 2
	placements, _ = byZimo.FinalPlacement([]Seat{East, South, West, North})
	if placements[0].Seat != North {
		t.Fatalf("more Zimo wins did not win the tie: %s led", placements[0].Seat)
	}

	byTai := base()
	byTai.Tallies[South].RawTaiWon = 40
	placements, _ = byTai.FinalPlacement([]Seat{East, South, West, North})
	if placements[0].Seat != South {
		t.Fatalf("greater raw Tai did not win the tie: %s led", placements[0].Seat)
	}

	// Everything equal: the randomized initial seat order decides, and it is
	// honoured rather than falling back on map order.
	bySeat := base()
	placements, _ = bySeat.FinalPlacement([]Seat{North, West, South, East})
	if placements[0].Seat != North {
		t.Fatalf("initial seat order was not the last tie-break: %s led", placements[0].Seat)
	}
}

func TestEqualTablePointsAreMarkedRatingTiesDespiteTheDisplayedOrder(t *testing.T) {
	// §8.4: equal table points are rating ties. The podium still shows an
	// order, so anything computing Elo has to be told not to read that order
	// as a result.
	state := NewRotationState(rotationStart)
	state.Tallies[East].TablePoints = 10
	state.Tallies[South].TablePoints = 10
	state.Tallies[West].TablePoints = -20
	state.Tallies[North].TablePoints = 0
	state.Tallies[East].DealIns = 1

	placements, err := state.FinalPlacement([]Seat{East, South, West, North})
	if err != nil {
		t.Fatalf("FinalPlacement() error = %v", err)
	}

	tied := map[Seat]bool{}
	for _, placement := range placements {
		if placement.RatingTie {
			tied[placement.Seat] = true
		}
	}
	if !tied[East] || !tied[South] {
		t.Fatalf("the two seats on 10 points were not marked as a rating tie: %+v", placements)
	}
	if tied[West] || tied[North] {
		t.Fatalf("a seat with unique points was marked tied: %+v", placements)
	}
	// They are still ordered for display.
	if placements[0].Seat == placements[1].Seat {
		t.Fatal("tied seats collapsed into one placement")
	}
}

func TestPlacementRejectsAnIncompleteSeatOrder(t *testing.T) {
	// Without a full order the last tie-break would fall back on Go's
	// randomized map iteration, so the podium could differ between replays of
	// the same match.
	state := NewRotationState(rotationStart)

	if _, err := state.FinalPlacement([]Seat{East, South, West}); err == nil {
		t.Fatal("accepted a seat order missing a seat")
	}
	if _, err := state.FinalPlacement([]Seat{East, East, South, West}); err == nil {
		t.Fatal("accepted a seat order with a duplicate")
	}
}

func TestDealInAndZimoCountersFollowTheHandKind(t *testing.T) {
	state := NewRotationState(rotationStart)

	// A discard win charges the discarder a deal-in.
	outcome, err := state.ApplyHand(discardWin(South, West, 4), false, rotationStart)
	if err != nil {
		t.Fatalf("ApplyHand() error = %v", err)
	}
	state = outcome.State
	if state.Tallies[West].DealIns != 1 {
		t.Fatal("a discard win did not charge the discarder a deal-in")
	}
	if state.Tallies[South].ZimoWins != 0 {
		t.Fatal("a discard win counted as a Zimo")
	}

	// A self-draw has no discarder, so nobody deals in.
	before := state.Tallies[West].DealIns
	outcome, err = state.ApplyHand(zimoWin(South, 6), false, rotationStart)
	if err != nil {
		t.Fatalf("ApplyHand() error = %v", err)
	}
	state = outcome.State
	if state.Tallies[West].DealIns != before {
		t.Fatal("a Zimo charged someone a deal-in")
	}
	if state.Tallies[South].ZimoWins != 1 {
		t.Fatal("a Zimo was not counted")
	}
	if state.Tallies[South].RawTaiWon != 10 {
		t.Fatalf("raw Tai won = %d, want 4 + 6", state.Tallies[South].RawTaiWon)
	}
}
