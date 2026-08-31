package rulesengine

import (
	"errors"
	mathrand "math/rand"
	"testing"
)

func rawWinner(seat Seat, rawTai int) HandWinner {
	return HandWinner{Seat: seat, Score: ScoreResult{Winning: true, RawTai: rawTai}}
}

func settle(t *testing.T, tier LobbyTier, dealer Seat, k int, result *HandResult) Settlement {
	t.Helper()
	settlement, err := SettleHand(SettlementInput{Tier: tier, Policy: Taiwanese16V11Ruleset.Settlement, Dealer: dealer, Continuations: k, Result: result})
	if err != nil {
		t.Fatalf("SettleHand() error = %v", err)
	}
	assertConservation(t, settlement, tier)
	return settlement
}

func assertConservation(t *testing.T, settlement Settlement, tier LobbyTier) {
	t.Helper()
	if settlement.TotalCredits != settlement.TotalDebits {
		t.Fatalf("credits %d != debits %d", settlement.TotalCredits, settlement.TotalDebits)
	}
	netSum := int64(0)
	debits := map[Seat]int64{}
	for seat, net := range settlement.Net {
		netSum += net
		_ = seat
	}
	if netSum != 0 {
		t.Fatalf("net sum = %d, want 0", netSum)
	}
	for _, transfer := range settlement.Transfers {
		debits[transfer.From] += transfer.Amount
	}
	for seat, debit := range debits {
		if debit > tier.DebitCap {
			t.Fatalf("payer %s debit %d exceeds cap %d", seat, debit, tier.DebitCap)
		}
	}
}

func TestDealerMultiplierDoesNotEscalateWithContinuations(t *testing.T) {
	for _, k := range []int{0, 1, 2, 10} {
		got, err := DealerMultiplier(Taiwanese16V11Ruleset.Settlement, k)
		if err != nil || got != 2 {
			t.Fatalf("DealerMultiplier(%d) = %d, %v; want 2", k, got, err)
		}
	}
	for _, k := range []int{-1, 11} {
		if _, err := DealerMultiplier(Taiwanese16V11Ruleset.Settlement, k); !errors.Is(err, ErrContinuations) {
			t.Fatalf("DealerMultiplier(%d) error = %v, want ErrContinuations", k, err)
		}
	}
}

func TestSettlementRequiresExplicitRulesetPolicy(t *testing.T) {
	_, err := SettleHand(SettlementInput{
		Tier:   TierBambooCourtyard,
		Dealer: East,
		Result: &HandResult{Kind: WinDiscard, Payer: South, Winners: []HandWinner{rawWinner(West, 5)}},
	})
	if !errors.Is(err, ErrSettlementInput) {
		t.Fatalf("SettleHand() error = %v, want ErrSettlementInput", err)
	}
}

func TestSettlementPolicyAndCalculationTravelWithResult(t *testing.T) {
	policy := Taiwanese16V11Ruleset.Settlement
	policy.ID = "test-base-two"
	policy.BaseUnits = 2
	result := &HandResult{Kind: WinDiscard, Payer: South, Winners: []HandWinner{rawWinner(West, 5)}}
	settlement, err := SettleHand(SettlementInput{
		Tier: TierBambooCourtyard, Policy: policy, Dealer: East, Result: result,
	})
	if err != nil {
		t.Fatalf("SettleHand() error = %v", err)
	}
	if settlement.Method != policy {
		t.Fatalf("method = %#v, want %#v", settlement.Method, policy)
	}
	transfer := settlement.Transfers[0]
	if transfer.RawAmount != 70 || transfer.Calculation.MethodID != policy.ID ||
		transfer.Calculation.Multiplier != 1 || len(transfer.Calculation.Components) != 2 {
		t.Fatalf("transfer metadata = %#v", transfer)
	}
	if transfer.Calculation.Components[0].Kind != "base" || transfer.Calculation.Components[0].Amount != 20 ||
		transfer.Calculation.Components[1].Kind != "tai" || transfer.Calculation.Components[1].Amount != 50 {
		t.Fatalf("components = %#v", transfer.Calculation.Components)
	}
}

// §7.4 base table: a 5-Tai discard win with no dealer relationship scales by
// lobby stake alone.
func TestSettlementScalesByLobby(t *testing.T) {
	result := &HandResult{Kind: WinDiscard, Payer: South, Winners: []HandWinner{rawWinner(West, 5)}}
	for tier, want := range map[*LobbyTier]int64{
		&TierBambooCourtyard:    60,
		&TierSparrowPavilion:    600,
		&TierWindAndCloudLounge: 6_000,
		&TierDragonsDen:         60_000,
	} {
		settlement := settle(t, *tier, East, 0, result)
		if len(settlement.Transfers) != 1 || settlement.Transfers[0].Amount != want {
			t.Fatalf("%s transfer = %#v, want %d", tier.Name, settlement.Transfers, want)
		}
	}
}

// §7.4 example 1: dealer at k = 2 wins by Zimo with 5 raw Tai.
func TestSettlementDealerZimoWithContinuations(t *testing.T) {
	result := &HandResult{Kind: WinZimo, Winners: []HandWinner{rawWinner(East, 5)}}
	for tier, want := range map[*LobbyTier]int64{
		&TierBambooCourtyard:    120,
		&TierSparrowPavilion:    1_200,
		&TierWindAndCloudLounge: 12_000,
		&TierDragonsDen:         120_000,
	} {
		settlement := settle(t, *tier, East, 2, result)
		if len(settlement.Transfers) != 3 {
			t.Fatalf("transfers = %#v", settlement.Transfers)
		}
		for _, transfer := range settlement.Transfers {
			if transfer.Amount != want || transfer.EffectiveTai != 12 {
				t.Fatalf("%s transfer = %#v, want %d", tier.Name, transfer, want)
			}
		}
		if settlement.Net[East] != 3*want {
			t.Fatalf("%s winner net = %d, want %d", tier.Name, settlement.Net[East], 3*want)
		}
	}
}

// §7.4 example 2: non-dealer Zimo, dealer at k = 2 pays more.
func TestSettlementNonDealerZimoDealerPaysMore(t *testing.T) {
	result := &HandResult{Kind: WinZimo, Winners: []HandWinner{rawWinner(South, 5)}}
	settlement := settle(t, TierBambooCourtyard, East, 2, result)
	if settlement.Net[South] != 240 || settlement.Net[East] != -120 ||
		settlement.Net[West] != -60 || settlement.Net[North] != -60 {
		t.Fatalf("net = %#v", settlement.Net)
	}
}

// §7.4 example 3: 4 raw Tai non-dealer Zimo at k = 0.
func TestSettlementKongTaiSettlesOnlyAtHandEnd(t *testing.T) {
	result := &HandResult{Kind: WinZimo, Winners: []HandWinner{rawWinner(South, 4)}}
	settlement := settle(t, TierBambooCourtyard, East, 0, result)
	if settlement.Net[South] != 200 || settlement.Net[East] != -100 ||
		settlement.Net[West] != -50 || settlement.Net[North] != -50 {
		t.Fatalf("net = %#v", settlement.Net)
	}
}

// §7.4 example 4: non-dealer Eight Flowers uses the three-opponent model.
func TestSettlementEightFlowersThreePayerModel(t *testing.T) {
	result := &HandResult{Kind: WinEightFlowers, Winners: []HandWinner{rawWinner(South, 15)}}
	settlement := settle(t, TierBambooCourtyard, East, 0, result)
	if settlement.Net[South] != 620 || settlement.Net[East] != -300 ||
		settlement.Net[West] != -160 || settlement.Net[North] != -160 {
		t.Fatalf("net = %#v", settlement.Net)
	}
}

// A very high displayed Tai settles at the ordinary-hand 16-Tai cap.
func TestSettlementSinglePayerCap(t *testing.T) {
	result := &HandResult{Kind: WinDiscard, Payer: South, Winners: []HandWinner{rawWinner(West, 45)}}
	settlement := settle(t, TierDragonsDen, East, 0, result)
	transfer := settlement.Transfers[0]
	if transfer.RawAmount != 170_000 || transfer.Amount != 170_000 || transfer.Capped {
		t.Fatalf("transfer = %#v", transfer)
	}
}

// §7.4 examples 6 and 8: the maximum hand caps each Zimo payer independently.
func TestSettlementMaximumHandCapsEachPayerIndependently(t *testing.T) {
	result := &HandResult{Kind: WinZimo, Winners: []HandWinner{rawWinner(East, 69)}}
	settlement := settle(t, TierDragonsDen, East, 10, result)
	if len(settlement.Transfers) != 3 {
		t.Fatalf("transfers = %#v", settlement.Transfers)
	}
	for _, transfer := range settlement.Transfers {
		if transfer.EffectiveTai != 34 || transfer.RawAmount != 340_000 ||
			transfer.Amount != 300_000 || !transfer.Capped {
			t.Fatalf("transfer = %#v", transfer)
		}
	}
	if settlement.Net[East] != 900_000 {
		t.Fatalf("winner net = %d, want 900000", settlement.Net[East])
	}
}

// Two discard winners split the discarder's cap proportionally after each
// hand is capped to ordinary settlement Tai.
// integer largest-remainder allocation.
func TestSettlementLargestRemainderAllocation(t *testing.T) {
	result := &HandResult{
		Kind:  WinDiscard,
		Payer: North,
		Winners: []HandWinner{
			rawWinner(South, 20),
			rawWinner(West, 15),
		},
	}
	settlement := settle(t, TierBambooCourtyard, East, 0, result)
	if settlement.Net[South] != 155 || settlement.Net[West] != 145 || settlement.Net[North] != -300 {
		t.Fatalf("net = %#v", settlement.Net)
	}
}

// §7.4 example 9: an exhaustive draw transfers nothing.
func TestSettlementExhaustiveDrawTransfersNothing(t *testing.T) {
	settlement := settle(t, TierBambooCourtyard, East, 3, &HandResult{Kind: KindExhaustiveDraw})
	if len(settlement.Transfers) != 0 {
		t.Fatalf("transfers = %#v", settlement.Transfers)
	}
	for seat, net := range settlement.Net {
		if net != 0 {
			t.Fatalf("net[%s] = %d, want 0", seat, net)
		}
	}
}

func TestSettlementEqualRemaindersBreakByWinnerOrder(t *testing.T) {
	// Equal claims of 200 against a cap of 300 floor to 150 each with equal
	// zero leftover only when exact; use claims that force one leftover unit:
	// 3 winners x 100 against cap 200 floors to 66 each with equal remainders,
	// so the leftover units go to the earliest winners in recorded order.
	tier := LobbyTier{Name: "test", MinimumBalance: 1, StakePerTai: 10, DebitCap: 200}
	result := &HandResult{
		Kind:  WinDiscard,
		Payer: East,
		Winners: []HandWinner{
			rawWinner(South, 10),
			rawWinner(West, 10),
			rawWinner(North, 10),
		},
	}
	settlement := settle(t, tier, East, 0, result)
	// Dealer is the payer, so every claim is 10+1 = 11 effective Tai = 110.
	// 200*110/330 = 66 remainder 220 for each; the two leftover units go to
	// South then West.
	if settlement.Net[South] != 67 || settlement.Net[West] != 67 || settlement.Net[North] != 66 {
		t.Fatalf("net = %#v", settlement.Net)
	}
}

func TestSettlementConservationFuzz(t *testing.T) {
	rng := mathrand.New(mathrand.NewSource(20260718))
	tiers := []LobbyTier{TierBambooCourtyard, TierSparrowPavilion, TierWindAndCloudLounge, TierDragonsDen}
	for round := 0; round < 2000; round++ {
		tier := tiers[rng.Intn(len(tiers))]
		dealer := seats[rng.Intn(len(seats))]
		k := rng.Intn(MaxDealerContinuations + 1)
		var result *HandResult
		switch rng.Intn(4) {
		case 0:
			result = &HandResult{Kind: KindExhaustiveDraw}
		case 1:
			winner := seats[rng.Intn(len(seats))]
			result = &HandResult{Kind: WinZimo, Winners: []HandWinner{rawWinner(winner, 1+rng.Intn(69))}}
		case 2:
			payer := seats[rng.Intn(len(seats))]
			winner := seats[(seatIndex(payer)+1+rng.Intn(3))%len(seats)]
			result = &HandResult{Kind: WinDiscard, Payer: payer, Winners: []HandWinner{rawWinner(winner, 1+rng.Intn(69))}}
		default:
			payer := seats[rng.Intn(len(seats))]
			winnerCount := 1 + rng.Intn(3)
			winners := make([]HandWinner, 0, winnerCount)
			for offset := 1; offset <= 3 && len(winners) < winnerCount; offset++ {
				seat := seats[(seatIndex(payer)+offset)%len(seats)]
				winners = append(winners, rawWinner(seat, 1+rng.Intn(69)))
			}
			result = &HandResult{Kind: WinDiscard, Payer: payer, Winners: winners}
		}
		settlement, err := SettleHand(SettlementInput{Tier: tier, Policy: Taiwanese16V11Ruleset.Settlement, Dealer: dealer, Continuations: k, Result: result})
		if err != nil {
			t.Fatalf("round %d: SettleHand() error = %v", round, err)
		}
		assertConservation(t, settlement, tier)
	}
}

func TestNextDealerStateContinuationTable(t *testing.T) {
	dealerWin := &HandResult{Kind: WinZimo, Winners: []HandWinner{rawWinner(East, 5)}}
	otherWin := &HandResult{Kind: WinDiscard, Payer: East, Winners: []HandWinner{rawWinner(South, 5)}}
	sharedWin := &HandResult{Kind: WinDiscard, Payer: North, Winners: []HandWinner{rawWinner(East, 5), rawWinner(South, 5)}}
	exhaustive := &HandResult{Kind: KindExhaustiveDraw}

	cases := []struct {
		name   string
		k      int
		result *HandResult
		ting   bool
		want   ContinuationOutcome
	}{
		{"dealer win retains", 2, dealerWin, false, ContinuationOutcome{East, 3, true}},
		{"non-dealer win rotates", 2, otherWin, false, ContinuationOutcome{South, 0, false}},
		{"shared discard rotates", 2, sharedWin, false, ContinuationOutcome{South, 0, false}},
		{"exhaustive ting retains", 4, exhaustive, true, ContinuationOutcome{East, 5, true}},
		{"exhaustive not ting rotates", 4, exhaustive, false, ContinuationOutcome{South, 0, false}},
		{"k cap forces rotation", 10, dealerWin, false, ContinuationOutcome{South, 0, false}},
	}
	for _, testCase := range cases {
		got, err := NextDealerState(East, testCase.k, testCase.result, testCase.ting)
		if err != nil {
			t.Fatalf("%s: error = %v", testCase.name, err)
		}
		if got != testCase.want {
			t.Fatalf("%s: outcome = %#v, want %#v", testCase.name, got, testCase.want)
		}
	}
}
