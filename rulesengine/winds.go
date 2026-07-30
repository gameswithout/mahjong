package rulesengine

import "fmt"

// Seat winds and table positions.
//
// Seat is used for two different things in this package, and Full Rotation is
// where they come apart:
//
//   - Inside a hand, a Seat is a *wind*. The dealer plays East, the player to
//     their right plays South, and scoring reads the wind directly
//     (scoreSetPatterns takes it as the seat wind). TurnEngine is built around
//     this: East is dealt the seventeenth tile, East is the opening actor, and
//     Earthly Hand is defined as a non-East opening draw.
//   - Across a rotation, a Seat is a *table position* — a fixed player. §8.4
//     schedules every position to deal once, and RotationState tallies table
//     points against positions, not winds.
//
// In Quick Play the two coincide, because the dealer is always East. In a
// rotation they diverge from the second hand on: the winds turn with the
// dealership, exactly as they do at a real table, so the player seated to the
// dealer's right plays South whoever is dealing.
//
// Keeping that distinction here means TurnEngine never learns about rotations.
// Each hand is dealt, played, and logged as an ordinary East-dealer hand, and
// only the runtime that owns the rotation translates between the two spaces.
// The alternative — teaching the engine an arbitrary dealer — would put a
// rotation-shaped change through the deal, the opening actor, the Heavenly and
// Earthly conditions, and the event log, for no gain in expressiveness.

// SeatWind returns the wind that table position plays in a hand dealt by
// dealer. The dealer always plays East.
func SeatWind(position, dealer Seat) (Seat, error) {
	positionIndex, err := seatOrdinal(position)
	if err != nil {
		return "", fmt.Errorf("seat wind position: %w", err)
	}
	dealerIndex, err := seatOrdinal(dealer)
	if err != nil {
		return "", fmt.Errorf("seat wind dealer: %w", err)
	}
	return seats[(positionIndex-dealerIndex+len(seats))%len(seats)], nil
}

// TablePosition is the inverse of SeatWind: the table position playing wind in
// a hand dealt by dealer.
func TablePosition(wind, dealer Seat) (Seat, error) {
	windIndex, err := seatOrdinal(wind)
	if err != nil {
		return "", fmt.Errorf("table position wind: %w", err)
	}
	dealerIndex, err := seatOrdinal(dealer)
	if err != nil {
		return "", fmt.Errorf("table position dealer: %w", err)
	}
	return seats[(windIndex+dealerIndex)%len(seats)], nil
}

// RebaseHandResult converts a hand result from wind space, which is what
// TurnEngine produces, into table-position space, which is what RotationState
// tallies. Everything else in the result is tile and pattern data that no
// rotation touches.
//
// This is the single boundary between the two spaces. A rotation must convert
// here and nowhere else: converting twice would silently rotate a result into
// the wrong seats, and settlement would still balance, so nothing downstream
// would notice.
func RebaseHandResult(result *HandResult, dealer Seat) (*HandResult, error) {
	if result == nil {
		return nil, nil
	}
	if _, err := seatOrdinal(dealer); err != nil {
		return nil, fmt.Errorf("rebase hand result: %w", err)
	}
	rebased := *result
	rebased.Winners = make([]HandWinner, len(result.Winners))
	for index, winner := range result.Winners {
		position, err := TablePosition(winner.Seat, dealer)
		if err != nil {
			return nil, fmt.Errorf("rebase winner %d: %w", index, err)
		}
		winner.Seat = position
		rebased.Winners[index] = winner
	}
	if result.Payer != "" {
		payer, err := TablePosition(result.Payer, dealer)
		if err != nil {
			return nil, fmt.Errorf("rebase payer: %w", err)
		}
		rebased.Payer = payer
	}
	return &rebased, nil
}

func seatOrdinal(seat Seat) (int, error) {
	for index, candidate := range seats {
		if candidate == seat {
			return index, nil
		}
	}
	return 0, fmt.Errorf("%w: unknown seat %q", ErrRotationInvalid, seat)
}
