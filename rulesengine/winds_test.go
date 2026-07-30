package rulesengine

import "testing"

func TestDealerAlwaysPlaysEast(t *testing.T) {
	// The whole point of the wind mapping: whoever is dealing is East, so
	// TurnEngine never has to know a rotation is happening.
	for _, dealer := range seats {
		wind, err := SeatWind(dealer, dealer)
		if err != nil {
			t.Fatalf("SeatWind(%s, %s): %v", dealer, dealer, err)
		}
		if wind != East {
			t.Fatalf("dealer %s plays %s, want East", dealer, wind)
		}
	}
}

func TestWindsTurnWithTheDealership(t *testing.T) {
	// With South dealing, the player to South's right (West) plays South.
	// Getting this backwards would rotate the table the wrong way, which
	// settlement would not catch because it stays balanced either way.
	cases := []struct {
		position Seat
		want     Seat
	}{
		{South, East},
		{West, South},
		{North, West},
		{East, North},
	}
	for _, testCase := range cases {
		wind, err := SeatWind(testCase.position, South)
		if err != nil {
			t.Fatalf("SeatWind(%s, South): %v", testCase.position, err)
		}
		if wind != testCase.want {
			t.Fatalf("position %s with South dealing plays %s, want %s", testCase.position, wind, testCase.want)
		}
	}
}

func TestSeatWindAndTablePositionAreInverse(t *testing.T) {
	for _, dealer := range seats {
		for _, position := range seats {
			wind, err := SeatWind(position, dealer)
			if err != nil {
				t.Fatalf("SeatWind(%s, %s): %v", position, dealer, err)
			}
			back, err := TablePosition(wind, dealer)
			if err != nil {
				t.Fatalf("TablePosition(%s, %s): %v", wind, dealer, err)
			}
			if back != position {
				t.Fatalf("dealer %s: %s -> %s -> %s, want round trip", dealer, position, wind, back)
			}
		}
	}
}

func TestSeatWindIsABijection(t *testing.T) {
	// Two positions sharing a wind would seat two players in one chair.
	for _, dealer := range seats {
		seen := map[Seat]Seat{}
		for _, position := range seats {
			wind, err := SeatWind(position, dealer)
			if err != nil {
				t.Fatalf("SeatWind(%s, %s): %v", position, dealer, err)
			}
			if other, clash := seen[wind]; clash {
				t.Fatalf("dealer %s: positions %s and %s both play %s", dealer, other, position, wind)
			}
			seen[wind] = position
		}
	}
}

func TestEastDealingIsTheIdentity(t *testing.T) {
	// Quick Play must be completely unaffected by the mapping existing.
	for _, position := range seats {
		wind, err := SeatWind(position, East)
		if err != nil {
			t.Fatalf("SeatWind(%s, East): %v", position, err)
		}
		if wind != position {
			t.Fatalf("with East dealing, position %s plays %s, want itself", position, wind)
		}
	}
}

func TestSeatWindRejectsUnknownSeats(t *testing.T) {
	if _, err := SeatWind("Z", East); err == nil {
		t.Fatal("expected an error for an unknown position")
	}
	if _, err := SeatWind(East, "Z"); err == nil {
		t.Fatal("expected an error for an unknown dealer")
	}
	if _, err := TablePosition("Z", East); err == nil {
		t.Fatal("expected an error for an unknown wind")
	}
}

func TestRebaseHandResultMovesWinnersAndPayer(t *testing.T) {
	// A discard win in a hand dealt by West: the engine reports the winner as
	// North and the payer as East, both winds. North is one after the dealer's
	// wind order, so in table terms the winner sits at South and the payer at
	// West.
	result := &HandResult{
		Kind:    WinDiscard,
		Payer:   East,
		Winners: []HandWinner{{Seat: North, Score: ScoreResult{RawTai: 5}}},
	}
	rebased, err := RebaseHandResult(result, West)
	if err != nil {
		t.Fatalf("RebaseHandResult: %v", err)
	}
	if rebased.Winners[0].Seat != South {
		t.Fatalf("winner rebased to %s, want South", rebased.Winners[0].Seat)
	}
	if rebased.Payer != West {
		t.Fatalf("payer rebased to %s, want West", rebased.Payer)
	}
	if rebased.Winners[0].Score.RawTai != 5 {
		t.Fatal("rebasing must not disturb the score")
	}
	// The original must be untouched; the caller still holds it for the view.
	if result.Winners[0].Seat != North || result.Payer != East {
		t.Fatal("RebaseHandResult mutated its input")
	}
}

func TestRebaseHandResultLeavesAnEmptyPayerEmpty(t *testing.T) {
	// A Zimo or draw has no payer. Rebasing "" must not invent a seat, or the
	// rotation would charge a deal-in to whoever happens to sit at East.
	result := &HandResult{
		Kind:    WinZimo,
		Winners: []HandWinner{{Seat: East}},
	}
	rebased, err := RebaseHandResult(result, North)
	if err != nil {
		t.Fatalf("RebaseHandResult: %v", err)
	}
	if rebased.Payer != "" {
		t.Fatalf("payer became %q, want empty", rebased.Payer)
	}
}

func TestRebaseHandResultWithEastDealingChangesNothing(t *testing.T) {
	result := &HandResult{
		Kind:    WinDiscard,
		Payer:   South,
		Winners: []HandWinner{{Seat: West}, {Seat: North}},
	}
	rebased, err := RebaseHandResult(result, East)
	if err != nil {
		t.Fatalf("RebaseHandResult: %v", err)
	}
	if rebased.Payer != South || rebased.Winners[0].Seat != West || rebased.Winners[1].Seat != North {
		t.Fatal("East dealing must leave a result exactly as it was")
	}
}

func TestRebaseHandResultPreservesWinnerOrder(t *testing.T) {
	// §5.6 turn-order proximity is carried by the order of Winners, and
	// settlement's largest-remainder tie-break reads it. Rebasing seats must
	// not reorder them.
	result := &HandResult{
		Kind:  WinDiscard,
		Payer: East,
		Winners: []HandWinner{
			{Seat: South, Score: ScoreResult{RawTai: 1}},
			{Seat: West, Score: ScoreResult{RawTai: 2}},
			{Seat: North, Score: ScoreResult{RawTai: 3}},
		},
	}
	rebased, err := RebaseHandResult(result, South)
	if err != nil {
		t.Fatalf("RebaseHandResult: %v", err)
	}
	for index, want := range []int{1, 2, 3} {
		if rebased.Winners[index].Score.RawTai != want {
			t.Fatalf("winner %d has %d Tai, want %d — order changed", index, rebased.Winners[index].Score.RawTai, want)
		}
	}
}

func TestRebaseHandResultOnNil(t *testing.T) {
	rebased, err := RebaseHandResult(nil, East)
	if err != nil || rebased != nil {
		t.Fatalf("nil result: got %v, %v", rebased, err)
	}
}
