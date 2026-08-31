package rulesengine

import (
	"errors"
	"fmt"
)

// LobbyTier is a §7.1 lobby configuration. All amounts are integer Jade.
type LobbyTier struct {
	Name           string `json:"name"`
	MinimumBalance int64  `json:"minimum_balance"`
	StakePerTai    int64  `json:"stake_per_tai"`
	DebitCap       int64  `json:"debit_cap"`
}

var (
	TierBambooCourtyard    = LobbyTier{Name: "Bamboo Courtyard", MinimumBalance: 1_000, StakePerTai: 10, DebitCap: 300}
	TierSparrowPavilion    = LobbyTier{Name: "Sparrow Pavilion", MinimumBalance: 10_000, StakePerTai: 100, DebitCap: 3_000}
	TierWindAndCloudLounge = LobbyTier{Name: "Wind and Cloud Lounge", MinimumBalance: 100_000, StakePerTai: 1_000, DebitCap: 30_000}
	TierDragonsDen         = LobbyTier{Name: "Dragon's Den", MinimumBalance: 1_000_000, StakePerTai: 10_000, DebitCap: 300_000}
)

// MaxDealerContinuations is the §5.11 k-cap: after the hand played at k = 10
// the dealer rotates regardless of outcome.
const MaxDealerContinuations = 10

var (
	ErrSettlementInput = errors.New("invalid settlement input")
	ErrContinuations   = errors.New("dealer continuation count out of range")
)

// DealerMultiplier is applied once to a winner-payer relationship whenever
// either participant is the dealer. Continuations still control rotation, but
// do not inflate the payment multiplier.
func DealerMultiplier(policy SettlementPolicy, continuations int) (int64, error) {
	if continuations < 0 || continuations > MaxDealerContinuations {
		return 0, ErrContinuations
	}
	if policy.DealerMultiplier <= 0 {
		return 0, ErrSettlementInput
	}
	return policy.DealerMultiplier, nil
}

type SettlementInput struct {
	Tier          LobbyTier        `json:"tier"`
	Policy        SettlementPolicy `json:"policy"`
	Dealer        Seat             `json:"dealer"`
	Continuations int              `json:"continuations"`
	Result        *HandResult      `json:"result"`
}

// Transfer is one winner-payer settlement. RawAmount is the uncapped §7.3
// obligation; Amount is the Jade that actually moves after the payer's debit
// cap is allocated.
type Transfer struct {
	From         Seat               `json:"from"`
	To           Seat               `json:"to"`
	EffectiveTai int64              `json:"effective_tai"`
	RawAmount    int64              `json:"raw_amount"`
	Amount       int64              `json:"amount"`
	Capped       bool               `json:"capped"`
	Calculation  PaymentCalculation `json:"calculation"`
}

type PaymentComponent struct {
	Kind   string `json:"kind"`
	Units  int64  `json:"units"`
	Amount int64  `json:"amount"`
}

// PaymentCalculation is deliberately method-neutral result metadata. A
// result client renders its components without reconstructing settlement
// rules from raw Tai or dealer state.
type PaymentCalculation struct {
	MethodID   string             `json:"method_id"`
	Model      SettlementModel    `json:"model"`
	UnitValue  int64              `json:"unit_value"`
	Components []PaymentComponent `json:"components"`
	Multiplier int64              `json:"multiplier"`
}

type Settlement struct {
	Method       SettlementPolicy `json:"method"`
	Transfers    []Transfer       `json:"transfers,omitempty"`
	Net          map[Seat]int64   `json:"net"`
	TotalCredits int64            `json:"total_credits"`
	TotalDebits  int64            `json:"total_debits"`
}

// SettleHand computes the §7.3 Jade transfers for a completed hand. Discard
// and rob wins charge the single payer; Zimo, Heavenly, and Eight Flowers
// charge all three opponents. Each payer's aggregate debit is capped at the
// tier debit cap using integer largest-remainder allocation; equal remainders
// break by winner order, which for a shared payer follows §5.6 turn-order
// proximity as recorded in Result.Winners. Credits equal debits exactly.
func SettleHand(input SettlementInput) (Settlement, error) {
	if input.Result == nil || input.Tier.StakePerTai <= 0 || input.Tier.DebitCap <= 0 ||
		input.Policy.ID == "" || input.Policy.Model != SettlementModelLinearBaseTai ||
		input.Policy.BaseUnits < 0 || input.Policy.TaiCap <= 0 || input.Policy.DealerMultiplier <= 0 {
		return Settlement{}, ErrSettlementInput
	}
	if !containsSeat(seats[:], input.Dealer) {
		return Settlement{}, ErrSettlementInput
	}
	dealerMultiplier, err := DealerMultiplier(input.Policy, input.Continuations)
	if err != nil {
		return Settlement{}, err
	}
	settlement := Settlement{Method: input.Policy, Net: map[Seat]int64{}}
	for _, seat := range seats {
		settlement.Net[seat] = 0
	}
	if input.Result.Kind == KindExhaustiveDraw || len(input.Result.Winners) == 0 {
		return settlement, nil
	}

	claims := make([]settlementClaim, 0, len(input.Result.Winners)*3)
	for _, winner := range input.Result.Winners {
		if !winner.Score.Winning || winner.Score.RawTai <= 0 {
			return Settlement{}, fmt.Errorf("%w: winner %s has no winning score", ErrSettlementInput, winner.Seat)
		}
		payers, err := payersFor(input.Result, winner.Seat)
		if err != nil {
			return Settlement{}, err
		}
		for _, payer := range payers {
			settledTai := int64(winner.Score.RawTai)
			if settledTai > input.Policy.TaiCap {
				settledTai = input.Policy.TaiCap
			}
			multiplier := int64(1)
			if winner.Seat == input.Dealer || payer == input.Dealer {
				multiplier = dealerMultiplier
			}
			effective := (input.Policy.BaseUnits + settledTai) * multiplier
			claims = append(claims, settlementClaim{
				payer:     payer,
				winner:    winner.Seat,
				effective: effective,
				raw:       input.Tier.StakePerTai * effective,
				calculation: PaymentCalculation{
					MethodID:  input.Policy.ID,
					Model:     input.Policy.Model,
					UnitValue: input.Tier.StakePerTai,
					Components: []PaymentComponent{
						{Kind: "base", Units: input.Policy.BaseUnits, Amount: input.Tier.StakePerTai * input.Policy.BaseUnits},
						{Kind: "tai", Units: settledTai, Amount: input.Tier.StakePerTai * settledTai},
					},
					Multiplier: multiplier,
				},
			})
		}
	}

	// Allocate each payer's debit cap across that payer's claims, preserving
	// the winner order recorded in the result.
	for _, payer := range seats {
		indices := make([]int, 0, len(claims))
		total := int64(0)
		for index, item := range claims {
			if item.payer == payer {
				indices = append(indices, index)
				total += item.raw
			}
		}
		if len(indices) == 0 {
			continue
		}
		amounts := make([]int64, len(indices))
		capped := total > input.Tier.DebitCap
		if !capped {
			for position, index := range indices {
				amounts[position] = claims[index].raw
			}
		} else {
			amounts = largestRemainderAllocation(claims, indices, input.Tier.DebitCap, total)
		}
		for position, index := range indices {
			item := claims[index]
			transfer := Transfer{
				From:         payer,
				To:           item.winner,
				EffectiveTai: item.effective,
				RawAmount:    item.raw,
				Amount:       amounts[position],
				Capped:       capped,
				Calculation:  item.calculation,
			}
			settlement.Transfers = append(settlement.Transfers, transfer)
			settlement.Net[item.winner] += transfer.Amount
			settlement.Net[payer] -= transfer.Amount
			settlement.TotalCredits += transfer.Amount
			settlement.TotalDebits += transfer.Amount
		}
	}
	return settlement, nil
}

func payersFor(result *HandResult, winner Seat) ([]Seat, error) {
	switch result.Kind {
	case WinDiscard, WinRob:
		if !containsSeat(seats[:], result.Payer) || result.Payer == winner {
			return nil, fmt.Errorf("%w: %s win needs a distinct payer", ErrSettlementInput, result.Kind)
		}
		return []Seat{result.Payer}, nil
	case WinZimo, WinHeavenly, WinEightFlowers:
		payers := make([]Seat, 0, len(seats)-1)
		for _, seat := range seats {
			if seat != winner {
				payers = append(payers, seat)
			}
		}
		return payers, nil
	default:
		return nil, fmt.Errorf("%w: kind %q has no payer model", ErrSettlementInput, result.Kind)
	}
}

type settlementClaim struct {
	payer       Seat
	winner      Seat
	effective   int64
	raw         int64
	calculation PaymentCalculation
}

// largestRemainderAllocation splits cap proportionally to the raw claims at
// the given indices (§7.3). Floors are assigned first; leftover units go to
// the largest fractional remainders, breaking exact ties by winner order.
func largestRemainderAllocation(claims []settlementClaim, indices []int, cap, total int64) []int64 {
	amounts := make([]int64, len(indices))
	remainders := make([]int64, len(indices))
	assigned := int64(0)
	for position, index := range indices {
		product := cap * claims[index].raw
		amounts[position] = product / total
		remainders[position] = product % total
		assigned += amounts[position]
	}
	order := make([]int, len(indices))
	for position := range order {
		order[position] = position
	}
	for i := 1; i < len(order); i++ {
		for j := i; j > 0 && remainders[order[j]] > remainders[order[j-1]]; j-- {
			order[j], order[j-1] = order[j-1], order[j]
		}
	}
	for leftover := cap - assigned; leftover > 0; leftover-- {
		position := order[0]
		order = append(order[1:], position)
		amounts[position]++
	}
	return amounts
}

// ContinuationOutcome is one row of the §5.11 dealer continuation table.
type ContinuationOutcome struct {
	NextDealer        Seat `json:"next_dealer"`
	NextContinuations int  `json:"next_continuations"`
	DealerRetains     bool `json:"dealer_retains"`
}

// NextDealerState applies the §5.11 continuation table. dealerTing matters
// only on an exhaustive draw. After the hand played at k = 10 the dealer
// rotates regardless of outcome.
func NextDealerState(dealer Seat, continuations int, result *HandResult, dealerTing bool) (ContinuationOutcome, error) {
	if !containsSeat(seats[:], dealer) || result == nil {
		return ContinuationOutcome{}, ErrSettlementInput
	}
	if continuations < 0 || continuations > MaxDealerContinuations {
		return ContinuationOutcome{}, ErrContinuations
	}
	retains := false
	if result.Kind == KindExhaustiveDraw {
		retains = dealerTing
	} else {
		dealerWon, otherWon := false, false
		for _, winner := range result.Winners {
			if winner.Seat == dealer {
				dealerWon = true
			} else {
				otherWon = true
			}
		}
		// The dealer sharing a multi-winner discard rotates (§5.11).
		retains = dealerWon && !otherWon
	}
	if retains && continuations < MaxDealerContinuations {
		return ContinuationOutcome{NextDealer: dealer, NextContinuations: continuations + 1, DealerRetains: true}, nil
	}
	return ContinuationOutcome{NextDealer: nextSeat(dealer), NextContinuations: 0, DealerRetains: false}, nil
}
