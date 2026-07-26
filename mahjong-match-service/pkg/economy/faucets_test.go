package economy

import (
	"testing"
	"time"
)

func counters(practice, public int, claimed ...string) DailyCounters {
	set := map[string]bool{}
	for _, kind := range claimed {
		set[kind] = true
	}
	return DailyCounters{PracticeHands: practice, PublicHands: public, Claimed: set}
}

func TestEvaluateWelfare(t *testing.T) {
	tests := []struct {
		name         string
		balance      int64
		reserved     int64
		counters     DailyCounters
		wantEligible bool
		wantAmount   int64
		wantReason   string
	}{
		{
			name:         "locked out player who practised today can recover",
			balance:      400,
			counters:     counters(1, 0),
			wantEligible: true,
			wantAmount:   600,
			wantReason:   WelfareAvailable,
		},
		{
			// "Cannot be banked": the top-up sets the balance to the minimum,
			// so a nearly-eligible player gets the difference and no more.
			name:         "tops up to the floor rather than by a fixed amount",
			balance:      999,
			counters:     counters(1, 0),
			wantEligible: true,
			wantAmount:   1,
			wantReason:   WelfareAvailable,
		},
		{
			name:       "a player who can already enter Bamboo is not offered it",
			balance:    1_000,
			counters:   counters(1, 0),
			wantReason: WelfareBalanceFine,
		},
		{
			name:       "one per UTC day",
			balance:    400,
			counters:   counters(1, 0, GrantWelfare),
			wantReason: WelfareAlreadyClaimed,
		},
		{
			name:       "requires a Practice hand that same day",
			balance:    400,
			counters:   counters(0, 0),
			wantReason: WelfarePracticeNeeded,
		},
		{
			// Yesterday's Practice hand does not carry over; the caller only
			// ever passes today's counters, which is the invariant this pins.
			name:       "a Practice hand from another day does not qualify",
			balance:    400,
			counters:   counters(0, 3),
			wantReason: WelfarePracticeNeeded,
		},
		{
			name:       "an open reservation blocks the claim",
			balance:    400,
			reserved:   300,
			counters:   counters(1, 0),
			wantReason: WelfareReservedFunds,
		},
		{
			// The reservation check runs before the balance check: a seated
			// player is not told their balance is fine when the real answer is
			// that a hand is still in flight.
			name:       "a seated player with a healthy balance is told about the seat",
			balance:    5_000,
			reserved:   300,
			counters:   counters(1, 0),
			wantReason: WelfareReservedFunds,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := EvaluateWelfare(test.balance, test.reserved, test.counters)
			if got.Eligible != test.wantEligible {
				t.Fatalf("Eligible = %v, want %v", got.Eligible, test.wantEligible)
			}
			if got.Amount != test.wantAmount {
				t.Fatalf("Amount = %d, want %d", got.Amount, test.wantAmount)
			}
			if got.Reason != test.wantReason {
				t.Fatalf("Reason = %q, want %q", got.Reason, test.wantReason)
			}
		})
	}
}

func TestEvaluateWelfareNeverIssuesNegativeJade(t *testing.T) {
	// A balance above the floor must never produce a debit dressed as a grant.
	for _, balance := range []int64{1_000, 1_001, 50_000} {
		got := EvaluateWelfare(balance, 0, counters(1, 0))
		if got.Eligible || got.Amount != 0 {
			t.Fatalf("balance %d: got %+v, want ineligible with no amount", balance, got)
		}
	}
}

func TestDueDailyPlayGrants(t *testing.T) {
	tests := []struct {
		name     string
		counters DailyCounters
		want     []DailyGrant
	}{
		{
			name:     "no public hands earns nothing",
			counters: counters(5, 0),
		},
		{
			name:     "the first public hand earns 250",
			counters: counters(0, 1),
			want:     []DailyGrant{{Kind: GrantFirstHand, Amount: 250}},
		},
		{
			name:     "two hands earn no more than one",
			counters: counters(0, 2),
			want:     []DailyGrant{{Kind: GrantFirstHand, Amount: 250}},
		},
		{
			// A player whose third hand lands before either grant was written
			// is owed both, in order.
			name:     "the third hand earns both when neither was paid",
			counters: counters(0, 3),
			want: []DailyGrant{
				{Kind: GrantFirstHand, Amount: 250},
				{Kind: GrantThreeHands, Amount: 500},
			},
		},
		{
			name:     "already-paid grants are not repeated",
			counters: counters(0, 9, GrantFirstHand, GrantThreeHands),
		},
		{
			name:     "the three-hand grant alone once the first is paid",
			counters: counters(0, 4, GrantFirstHand),
			want:     []DailyGrant{{Kind: GrantThreeHands, Amount: 500}},
		},
		{
			// Practice never pays Jade (§11.4).
			name:     "Practice hands do not earn play grants",
			counters: counters(20, 0),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := DueDailyPlayGrants(test.counters)
			if len(got) != len(test.want) {
				t.Fatalf("got %+v, want %+v", got, test.want)
			}
			for i := range got {
				if got[i] != test.want[i] {
					t.Fatalf("grant %d = %+v, want %+v", i, got[i], test.want[i])
				}
			}
		})
	}
}

func TestUTCDayBoundary(t *testing.T) {
	// Local midnight is not the boundary. A player in UTC+8 at 00:30 local is
	// still on the previous UTC day, and must not get a second day's faucets.
	late := time.Date(2026, 7, 26, 23, 59, 59, 0, time.UTC)
	justAfter := time.Date(2026, 7, 27, 0, 0, 1, 0, time.UTC)
	if UTCDay(late).Equal(UTCDay(justAfter)) {
		t.Fatal("times either side of UTC midnight collapsed into one day")
	}

	offset := time.FixedZone("UTC+8", 8*60*60)
	localMorning := time.Date(2026, 7, 27, 0, 30, 0, 0, offset)
	if !UTCDay(localMorning).Equal(UTCDay(late)) {
		t.Fatalf("UTC+8 00:30 mapped to %v, want the same UTC day as %v",
			UTCDay(localMorning), UTCDay(late))
	}
}
