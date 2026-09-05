package rulesengine

import (
	"errors"
	"fmt"
	"math"
	"time"
)

// §8.4 Full Rotation: one East round in which every player is scheduled to
// deal once, subject to §5.11 continuations and a 60-minute match limit.
//
// This file is the pure rotation domain — table points, the end condition, and
// placement. It holds no I/O and no match-runtime concerns, so the sequencing
// rules can be reasoned about and tested on their own.
//
// Two things it deliberately reuses rather than reimplements:
//
//   - Table-point transfers go through SettleHand. §8.4 says they follow "the
//     same payer and multiple-winner rules as Jade but with no cap and no
//     stake multiplier", which is exactly SettleHand at stake 1 with the cap
//     lifted. Writing a parallel implementation would let the two drift on
//     precisely the rules that are hardest to get right.
//   - Dealer sequencing goes through NextDealerState, the §5.11 continuation
//     table that already governs Quick Play.

// TablePointTier is §8.4's "no cap and no stake multiplier": one table point
// per settlement unit, and a cap high enough that allocation never binds.
//
// The cap is not truly absent — SettleHand requires a positive one — but the
// largest hand §7.3 can produce is far below this, so no real settlement can
// reach it. RotationMatch guards the arithmetic separately.
var TablePointTier = LobbyTier{
	Name:        "Full Rotation table points",
	StakePerTai: 1,
	DebitCap:    math.MaxInt32,
}

// MatchTimeLimit is §8.4's 60 minutes. At the limit the current hand finishes
// and the match ends, even with the base rotation incomplete.
const MatchTimeLimit = 60 * time.Minute

// SeatCount is the number of seats that must each deal once for a base
// rotation to be complete.
const SeatCount = 4

var (
	ErrRotationComplete = errors.New("full rotation match is already complete")
	ErrRotationInvalid  = errors.New("full rotation state is invalid")
)

// SeatTally is one seat's running Full Rotation record. TablePoints may go
// negative (§8.4) and is not an account currency.
//
// The three tie-break counters exist only for the displayed podium; §8.4 makes
// equal table points a genuine rating tie, so nothing here may reorder the
// rating itself.
type SeatTally struct {
	Seat        Seat  `json:"seat"`
	TablePoints int64 `json:"table_points"`
	DealIns     int   `json:"deal_ins"`
	ZimoWins    int   `json:"zimo_wins"`
	RawTaiWon   int   `json:"raw_tai_won"`
	// HasDealt records whether this seat has held the dealership. The base
	// rotation is complete when every seat has.
	HasDealt bool `json:"has_dealt"`
}

// RotationState is a Full Rotation match between hands. It is a value: applying
// a hand returns the next state rather than mutating this one, so a replay of
// the same events always lands in the same place.
type RotationState struct {
	Dealer        Seat                `json:"dealer"`
	Continuations int                 `json:"continuations"`
	HandsPlayed   int                 `json:"hands_played"`
	Tallies       map[Seat]*SeatTally `json:"tallies"`
	StartedAt     time.Time           `json:"started_at"`
	// Complete and CompletionReason are set once the match has ended.
	Complete         bool                   `json:"complete"`
	CompletionReason RotationCompletionKind `json:"completion_reason,omitempty"`
}

type RotationCompletionKind string

const (
	// RotationCompletedRound is the intended ending: every seat has dealt.
	RotationCompletedRound RotationCompletionKind = "rotation_complete"
	// RotationCompletedTimeLimit is §8.4's 60-minute stop. A match ending this
	// way before every seat has dealt is structurally asymmetric, which is why
	// it is recorded distinctly rather than folded into the normal ending —
	// §8.4 makes its frequency a mandatory telemetry metric.
	RotationCompletedTimeLimit RotationCompletionKind = "time_limit"
)

// NewRotationState opens a match with East dealing and every seat on zero.
func NewRotationState(startedAt time.Time) RotationState {
	tallies := make(map[Seat]*SeatTally, SeatCount)
	for _, seat := range seats {
		tallies[seat] = &SeatTally{Seat: seat}
	}
	return RotationState{
		Dealer:    East,
		Tallies:   tallies,
		StartedAt: startedAt,
	}
}

func (s RotationState) clone() RotationState {
	tallies := make(map[Seat]*SeatTally, len(s.Tallies))
	for seat, tally := range s.Tallies {
		copied := *tally
		tallies[seat] = &copied
	}
	s.Tallies = tallies
	return s
}

// SeatsDealt counts how many seats have held the dealership.
func (s RotationState) SeatsDealt() int {
	dealt := 0
	for _, tally := range s.Tallies {
		if tally.HasDealt {
			dealt++
		}
	}
	return dealt
}

// TimeLimitReached reports whether §8.4's 60 minutes have elapsed. The limit
// stops the match *after* the current hand, never mid-hand, so this is only
// ever consulted at a hand boundary.
func (s RotationState) TimeLimitReached(now time.Time) bool {
	return !now.Before(s.StartedAt.Add(MatchTimeLimit))
}

// HandOutcome is what one completed hand contributes to the rotation.
type RotationHandOutcome struct {
	Settlement Settlement             `json:"settlement"`
	Next       ContinuationOutcome    `json:"next"`
	State      RotationState          `json:"state"`
	Completed  bool                   `json:"completed"`
	Reason     RotationCompletionKind `json:"reason,omitempty"`
}

// ApplyHand folds one completed hand into the rotation: it settles table
// points, updates the tie-break counters, advances the dealer through the
// §5.11 continuation table, and decides whether the match has ended.
//
// dealerTing matters only on an exhaustive draw, matching NextDealerState.
// now is the time the hand finished, and is what the 60-minute limit is
// measured against.
func (s RotationState) ApplyHand(
	result *HandResult,
	dealerTing bool,
	now time.Time,
) (RotationHandOutcome, error) {
	if s.Complete {
		return RotationHandOutcome{}, ErrRotationComplete
	}
	if result == nil {
		return RotationHandOutcome{}, fmt.Errorf("%w: hand result is required", ErrRotationInvalid)
	}
	if len(s.Tallies) != SeatCount {
		return RotationHandOutcome{}, fmt.Errorf("%w: expected %d seats", ErrRotationInvalid, SeatCount)
	}

	settlement, err := SettleHand(SettlementInput{
		Tier:          TablePointTier,
		Policy:        Taiwanese16V11Ruleset.Settlement,
		Dealer:        s.Dealer,
		Continuations: s.Continuations,
		Result:        result,
	})
	if err != nil {
		return RotationHandOutcome{}, fmt.Errorf("settle table points: %w", err)
	}

	next, err := NextDealerState(s.Dealer, s.Continuations, result, dealerTing)
	if err != nil {
		return RotationHandOutcome{}, fmt.Errorf("advance dealer: %w", err)
	}

	updated := s.clone()
	// The seat that just dealt has now dealt, however the hand ended. A
	// continuation does not make it a second seat's turn, so this is recorded
	// against the dealer of the hand just played rather than the next one.
	updated.Tallies[updated.Dealer].HasDealt = true

	for seat, delta := range settlement.Net {
		tally, known := updated.Tallies[seat]
		if !known {
			return RotationHandOutcome{}, fmt.Errorf("%w: settlement names unknown seat %s", ErrRotationInvalid, seat)
		}
		tally.TablePoints += delta
	}

	// Tie-break counters. §8.4 orders the displayed podium by fewer deal-ins,
	// then more Zimo wins, then greater total raw Tai won.
	for _, winner := range result.Winners {
		if tally, known := updated.Tallies[winner.Seat]; known {
			tally.RawTaiWon += winner.Score.RawTai
			if result.Kind == WinZimo {
				tally.ZimoWins++
			}
		}
	}
	// A deal-in is discarding the tile someone wins on. Zimo, rob, and the
	// special wins have no discarder, so only a discard win charges one.
	if result.Kind == WinDiscard && result.Payer != "" {
		if tally, known := updated.Tallies[result.Payer]; known {
			tally.DealIns++
		}
	}

	updated.HandsPlayed++
	updated.Dealer = next.NextDealer
	updated.Continuations = next.NextContinuations

	// End conditions, checked in the order §8.4 states them. The base rotation
	// completing is the intended ending; the time limit is the fallback, and
	// only bites once the current hand has finished.
	switch {
	case updated.SeatsDealt() >= SeatCount && !next.DealerRetains:
		updated.Complete = true
		updated.CompletionReason = RotationCompletedRound
	case updated.TimeLimitReached(now):
		updated.Complete = true
		updated.CompletionReason = RotationCompletedTimeLimit
	}

	return RotationHandOutcome{
		Settlement: settlement,
		Next:       next,
		State:      updated,
		Completed:  updated.Complete,
		Reason:     updated.CompletionReason,
	}, nil
}

// Placement is one seat's final standing.
type Placement struct {
	Seat        Seat      `json:"seat"`
	Position    int       `json:"position"`
	TablePoints int64     `json:"table_points"`
	Tally       SeatTally `json:"tally"`
	// RatingTie marks a seat whose table points equal another's. §8.4 makes
	// those genuine ties for rating even though the podium displays an order,
	// so anything computing Elo must not read Position as a strict ranking.
	RatingTie bool `json:"rating_tie"`
}

// FinalPlacement ranks the seats by net table points, applying §8.4's
// display-only tie-break: fewer deal-ins, then more Zimo wins, then greater
// total raw Tai won, then the initial seat order.
//
// seatOrder is the uniformly randomized initial order and is the last
// tie-break. It must contain every seat; without it the final comparison would
// fall back on map iteration, which is not deterministic in Go and would make
// the podium differ between replays of the same match.
func (s RotationState) FinalPlacement(seatOrder []Seat) ([]Placement, error) {
	if len(seatOrder) != SeatCount {
		return nil, fmt.Errorf("%w: seat order must name all %d seats", ErrRotationInvalid, SeatCount)
	}
	orderIndex := make(map[Seat]int, SeatCount)
	for index, seat := range seatOrder {
		if _, duplicate := orderIndex[seat]; duplicate {
			return nil, fmt.Errorf("%w: seat %s appears twice in seat order", ErrRotationInvalid, seat)
		}
		orderIndex[seat] = index
	}
	for _, seat := range seats {
		if _, named := orderIndex[seat]; !named {
			return nil, fmt.Errorf("%w: seat order omits %s", ErrRotationInvalid, seat)
		}
	}

	ranked := make([]Placement, 0, SeatCount)
	for _, seat := range seats {
		tally, known := s.Tallies[seat]
		if !known {
			return nil, fmt.Errorf("%w: no tally for seat %s", ErrRotationInvalid, seat)
		}
		ranked = append(ranked, Placement{
			Seat:        seat,
			TablePoints: tally.TablePoints,
			Tally:       *tally,
		})
	}

	sortPlacements(ranked, orderIndex)

	for index := range ranked {
		ranked[index].Position = index + 1
		for other := range ranked {
			if other != index && ranked[other].TablePoints == ranked[index].TablePoints {
				ranked[index].RatingTie = true
				break
			}
		}
	}
	return ranked, nil
}

// sortPlacements is an insertion sort: four elements, and it keeps the
// comparison rules readable in the order §8.4 lists them.
func sortPlacements(ranked []Placement, orderIndex map[Seat]int) {
	for i := 1; i < len(ranked); i++ {
		for j := i; j > 0 && placementBefore(ranked[j], ranked[j-1], orderIndex); j-- {
			ranked[j], ranked[j-1] = ranked[j-1], ranked[j]
		}
	}
}

func placementBefore(a, b Placement, orderIndex map[Seat]int) bool {
	if a.TablePoints != b.TablePoints {
		return a.TablePoints > b.TablePoints
	}
	if a.Tally.DealIns != b.Tally.DealIns {
		return a.Tally.DealIns < b.Tally.DealIns
	}
	if a.Tally.ZimoWins != b.Tally.ZimoWins {
		return a.Tally.ZimoWins > b.Tally.ZimoWins
	}
	if a.Tally.RawTaiWon != b.Tally.RawTaiWon {
		return a.Tally.RawTaiWon > b.Tally.RawTaiWon
	}
	return orderIndex[a.Seat] < orderIndex[b.Seat]
}
