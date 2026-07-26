package economy

import "time"

// §7.5 Version 1 Jade sources, beyond the two new-account grants already in
// economy.go. The decision logic lives here as pure functions over a day's
// counters so it can be tested without a database; storage owns only the SQL
// that supplies the counters and writes the resulting journal.

const (
	// The welfare top-up sets the balance to the Bamboo minimum. It is a set,
	// not an add: §7.5 says it "sets the balance to 1,000 Jade", and it
	// "cannot be banked", so a player at 999 receives 1 Jade, not 1,000.
	WelfareFloor = MinimumBalance

	FirstHandGrant      = int64(250)
	ThreeHandsGrant     = int64(500)
	ThreeHandsThreshold = 3
)

// Grant kinds, matching the jade_daily_grants CHECK constraint.
const (
	GrantWelfare    = "welfare"
	GrantFirstHand  = "first_hand"
	GrantThreeHands = "three_hands"
)

// DailyCounters is one player's activity for one UTC day.
type DailyCounters struct {
	PracticeHands int
	PublicHands   int
	// Grant kinds already claimed today.
	Claimed map[string]bool
}

func (d DailyCounters) claimed(kind string) bool {
	return d.Claimed != nil && d.Claimed[kind]
}

// WelfareStatus explains, in one value, whether the player can recover and why
// not when they cannot. The reason is a stable code, not display text: the
// client decides the wording, and analytics (§15) counts the code.
type WelfareStatus struct {
	Eligible bool
	// Amount that would be credited, given the current balance.
	Amount int64
	Reason string
}

// Welfare reason codes.
const (
	WelfareAvailable      = "available"
	WelfareBalanceFine    = "balance_sufficient"
	WelfareAlreadyClaimed = "claimed_today"
	WelfarePracticeNeeded = "practice_hand_required"
	WelfareReservedFunds  = "reservation_open"
)

// EvaluateWelfare decides whether the §7.5 top-up may be claimed.
//
// The prerequisite of one AI Practice hand that day is what keeps this from
// being a farmable faucet: recovery costs the player a hand of actual play,
// and the once-per-UTC-day key means it cannot be repeated.
func EvaluateWelfare(balance, reserved int64, counters DailyCounters) WelfareStatus {
	// An open reservation means Jade is committed to a table that has not
	// settled. Topping up underneath it would let a player claim welfare while
	// a hand they might still win is in flight.
	if reserved > 0 {
		return WelfareStatus{Reason: WelfareReservedFunds}
	}
	if balance >= WelfareFloor {
		return WelfareStatus{Reason: WelfareBalanceFine}
	}
	if counters.claimed(GrantWelfare) {
		return WelfareStatus{Reason: WelfareAlreadyClaimed}
	}
	if counters.PracticeHands < 1 {
		return WelfareStatus{Reason: WelfarePracticeNeeded}
	}
	return WelfareStatus{
		Eligible: true,
		Amount:   WelfareFloor - balance,
		Reason:   WelfareAvailable,
	}
}

// DueDailyPlayGrants returns the play grants the day's public-hand count has
// earned but not yet been paid, in the order they should be written.
//
// These are awarded rather than claimed. §7.5 describes them as the Section
// 13.3 Daily mission rewards, and no mission surface exists yet; paying them
// automatically is the behaviour a player would expect from the description,
// and the once-per-day key makes it safe to re-evaluate on every hand.
func DueDailyPlayGrants(counters DailyCounters) []DailyGrant {
	var due []DailyGrant
	if counters.PublicHands >= 1 && !counters.claimed(GrantFirstHand) {
		due = append(due, DailyGrant{Kind: GrantFirstHand, Amount: FirstHandGrant})
	}
	if counters.PublicHands >= ThreeHandsThreshold && !counters.claimed(GrantThreeHands) {
		due = append(due, DailyGrant{Kind: GrantThreeHands, Amount: ThreeHandsGrant})
	}
	return due
}

type DailyGrant struct {
	Kind   string
	Amount int64
}

// UTCDay is the grant day boundary. Every faucet in §7.5 resets per UTC day,
// deliberately not per local midnight: a player's timezone is not something
// the service knows, and a movable boundary is a farmable one.
func UTCDay(at time.Time) time.Time {
	utc := at.UTC()
	return time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
}
