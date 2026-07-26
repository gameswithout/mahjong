//go:build integration

package storage

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/economy"
	"github.com/gameswithout/mahjong/rulesengine"
)

func faucetStore(t *testing.T) *PostgreSQLStorage {
	t.Helper()
	connectionString := os.Getenv("TEST_DATABASE_URL")
	if connectionString == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	store, err := NewPostgreSQLStorage(connectionString)
	if err != nil {
		t.Fatalf("NewPostgreSQLStorage() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close(context.Background()) })
	return store
}

// spendUntilLockedOut plays real four-seat hands until the player can no longer
// enter Bamboo, and returns the balance they are stranded on.
//
// It stops when the account stops being eligible, because that is exactly where
// a real player stops: reserving the debit cap is itself gated on eligibility,
// so the lockout balance is whatever the last affordable hand left behind —
// never an arbitrary number a test picked.
func spendUntilLockedOut(t *testing.T, store *PostgreSQLStorage, table []string) int64 {
	t.Helper()
	ctx := context.Background()

	for hand := 0; ; hand++ {
		account, err := store.EnsureJadeAccount(ctx, table[0])
		if err != nil {
			t.Fatalf("EnsureJadeAccount(%s) error = %v", table[0], err)
		}
		if !account.Eligible {
			return account.Balance
		}
		if hand > 40 {
			t.Fatalf("player never reached lockout; balance stuck at %d", account.Balance)
		}

		key := MatchKey{
			Namespace: "gameswithout-mahjong",
			SessionID: fmt.Sprintf("drain-%s-%d", randomSuffix(t), hand),
			MatchID:   "match-1",
		}
		record, _, err := store.EnsureMatch(ctx, key, table)
		if err != nil {
			t.Fatalf("EnsureMatch() error = %v", err)
		}
		for _, userID := range table {
			if _, _, err := store.ReserveJade(ctx, userID); err != nil {
				t.Fatalf("ReserveJade(%s) error = %v", userID, err)
			}
			if err := store.BindJadeReservation(ctx, userID, record.RuntimeID); err != nil {
				t.Fatalf("BindJadeReservation(%s) error = %v", userID, err)
			}
		}

		// Seats are assigned by the repository, not by roster order, so the
		// loser is read back rather than assumed — assuming it silently made
		// this helper pay the player it was meant to drain.
		loserSeat, ok := record.Seats[table[0]]
		if !ok {
			t.Fatalf("player %s has no seat in %v", table[0], record.Seats)
		}
		amount := economy.DebitCap
		net := map[rulesengine.Seat]int64{
			rulesengine.East: 0, rulesengine.South: 0,
			rulesengine.West: 0, rulesengine.North: 0,
		}
		net[loserSeat] = -amount
		for _, seat := range []rulesengine.Seat{
			rulesengine.East, rulesengine.South, rulesengine.West, rulesengine.North,
		} {
			if seat != loserSeat {
				net[seat] = amount
				break
			}
		}
		if _, err := store.SettleJadeMatch(ctx, record.RuntimeID, rulesengine.Settlement{
			Net:          net,
			TotalCredits: amount,
			TotalDebits:  amount,
		}); err != nil {
			t.Fatalf("SettleJadeMatch() error = %v", err)
		}
	}
}

// table builds four account names sharing one suffix, with the player under
// test seated East.
func faucetTable(player, suffix string) []string {
	return []string{player, "seat-s-" + suffix, "seat-w-" + suffix, "seat-n-" + suffix}
}

func TestPostgreSQLStorage_WelfareRequiresPracticeAndPaysOncePerDay(t *testing.T) {
	store := faucetStore(t)
	ctx := context.Background()
	suffix := randomSuffix(t)
	player := "welfare-" + suffix

	stranded := spendUntilLockedOut(t, store, faucetTable(player, suffix))

	account, err := store.JadeAccountWithFaucets(ctx, player)
	if err != nil {
		t.Fatalf("JadeAccountWithFaucets() error = %v", err)
	}
	if account.Balance != stranded || stranded >= economy.MinimumBalance {
		t.Fatalf("balance = %d, want a locked-out balance below %d",
			account.Balance, economy.MinimumBalance)
	}
	// Locked out, but no Practice hand today: the way back is stated, not open.
	if account.Welfare.Eligible || account.Welfare.Reason != economy.WelfarePracticeNeeded {
		t.Fatalf("welfare before Practice = %#v", account.Welfare)
	}

	refused, status, err := store.ClaimJadeWelfare(ctx, player)
	if err != nil {
		t.Fatalf("ClaimJadeWelfare() error = %v", err)
	}
	if status.Eligible || refused.Balance != stranded {
		t.Fatalf("premature claim moved Jade: status=%#v balance=%d", status, refused.Balance)
	}

	// One Practice hand later, recovery opens.
	practiceKey := MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "practice-" + suffix,
		MatchID:   "match-1",
	}
	practice, _, err := store.EnsureMatch(ctx, practiceKey, faucetTable(player, suffix))
	if err != nil {
		t.Fatalf("EnsureMatch() error = %v", err)
	}
	if _, err := store.RecordCompletedHand(ctx, player, practice.RuntimeID, true); err != nil {
		t.Fatalf("RecordCompletedHand() error = %v", err)
	}

	claimed, granted, err := store.ClaimJadeWelfare(ctx, player)
	if err != nil {
		t.Fatalf("ClaimJadeWelfare() error = %v", err)
	}
	if !granted.Eligible || granted.Amount != economy.MinimumBalance-stranded {
		t.Fatalf("granted = %#v, want %d Jade", granted, economy.MinimumBalance-stranded)
	}
	if claimed.Balance != economy.MinimumBalance {
		t.Fatalf("balance after welfare = %d, want %d", claimed.Balance, economy.MinimumBalance)
	}
	if !claimed.Eligible {
		t.Fatal("welfare left the player still ineligible for Bamboo")
	}

	// Second claim the same UTC day is refused, and moves nothing.
	again, second, err := store.ClaimJadeWelfare(ctx, player)
	if err != nil {
		t.Fatalf("ClaimJadeWelfare() repeat error = %v", err)
	}
	if second.Eligible || again.Balance != economy.MinimumBalance {
		t.Fatalf("second claim paid again: status=%#v balance=%d", second, again.Balance)
	}
	if second.Reason != economy.WelfareBalanceFine {
		// At exactly the floor the balance reason wins, which is the honest
		// answer: they can play, so recovery is not what they need.
		t.Fatalf("second claim reason = %q", second.Reason)
	}
}

func TestPostgreSQLStorage_WelfareIsCappedAtOnePerDayEvenWhenStillPoor(t *testing.T) {
	store := faucetStore(t)
	ctx := context.Background()
	suffix := randomSuffix(t)
	player := "welfare-poor-" + suffix
	table := faucetTable(player, suffix)

	spendUntilLockedOut(t, store, table)
	key := MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "practice-" + suffix,
		MatchID:   "match-1",
	}
	practice, _, err := store.EnsureMatch(ctx, key, table)
	if err != nil {
		t.Fatalf("EnsureMatch() error = %v", err)
	}
	if _, err := store.RecordCompletedHand(ctx, player, practice.RuntimeID, true); err != nil {
		t.Fatalf("RecordCompletedHand() error = %v", err)
	}
	if _, granted, err := store.ClaimJadeWelfare(ctx, player); err != nil || !granted.Eligible {
		t.Fatalf("first claim: granted=%#v err=%v", granted, err)
	}

	// Lose it all again the same day. The daily key, not the balance, is what
	// stops a second top-up — otherwise welfare would fund unlimited play.
	stranded := spendUntilLockedOut(t, store, table)
	account, err := store.JadeAccountWithFaucets(ctx, player)
	if err != nil {
		t.Fatalf("JadeAccountWithFaucets() error = %v", err)
	}
	if account.Welfare.Eligible || account.Welfare.Reason != economy.WelfareAlreadyClaimed {
		t.Fatalf("welfare after same-day loss = %#v", account.Welfare)
	}
	if _, status, err := store.ClaimJadeWelfare(ctx, player); err != nil || status.Eligible {
		t.Fatalf("second same-day claim: status=%#v err=%v", status, err)
	}
	if after, _ := store.JadeAccountWithFaucets(ctx, player); after.Balance != stranded {
		t.Fatalf("refused claim moved Jade: balance = %d, want %d", after.Balance, stranded)
	}
}

func TestPostgreSQLStorage_DailyPlayGrantsPayOncePerDay(t *testing.T) {
	store := faucetStore(t)
	ctx := context.Background()
	suffix := randomSuffix(t)
	player := "daily-" + suffix

	start, err := store.EnsureJadeAccount(ctx, player)
	if err != nil {
		t.Fatalf("EnsureJadeAccount() error = %v", err)
	}

	play := func(n int) *PostgreSQLStorage {
		key := MatchKey{
			Namespace: "gameswithout-mahjong",
			SessionID: "public-" + suffix + "-" + string(rune('a'+n)),
			MatchID:   "match-1",
		}
		record, _, err := store.EnsureMatch(ctx, key, faucetTable(player, suffix))
		if err != nil {
			t.Fatalf("EnsureMatch() error = %v", err)
		}
		// Poll the same finished hand twice: the (user, match) key is what
		// keeps a poll loop from paying the grant repeatedly.
		for range 2 {
			if _, err := store.RecordCompletedHand(ctx, player, record.RuntimeID, false); err != nil {
				t.Fatalf("RecordCompletedHand() error = %v", err)
			}
		}
		return store
	}

	play(0)
	afterFirst, err := store.JadeAccountWithFaucets(ctx, player)
	if err != nil {
		t.Fatalf("JadeAccountWithFaucets() error = %v", err)
	}
	if got := afterFirst.Balance - start.Balance; got != economy.FirstHandGrant {
		t.Fatalf("after one hand, gained %d, want %d", got, economy.FirstHandGrant)
	}

	play(1)
	afterSecond, _ := store.JadeAccountWithFaucets(ctx, player)
	if got := afterSecond.Balance - start.Balance; got != economy.FirstHandGrant {
		t.Fatalf("after two hands, gained %d, want no second payment", got)
	}

	play(2)
	afterThird, _ := store.JadeAccountWithFaucets(ctx, player)
	want := economy.FirstHandGrant + economy.ThreeHandsGrant
	if got := afterThird.Balance - start.Balance; got != want {
		t.Fatalf("after three hands, gained %d, want %d", got, want)
	}

	play(3)
	afterFourth, _ := store.JadeAccountWithFaucets(ctx, player)
	if got := afterFourth.Balance - start.Balance; got != want {
		t.Fatalf("after four hands, gained %d, want %d", got, want)
	}
}

func TestPostgreSQLStorage_PracticeHandsEarnNoJade(t *testing.T) {
	store := faucetStore(t)
	ctx := context.Background()
	suffix := randomSuffix(t)
	player := "practice-only-" + suffix

	start, err := store.EnsureJadeAccount(ctx, player)
	if err != nil {
		t.Fatalf("EnsureJadeAccount() error = %v", err)
	}

	for hand := range 5 {
		key := MatchKey{
			Namespace: "gameswithout-mahjong",
			SessionID: "practice-" + suffix + "-" + string(rune('a'+hand)),
			MatchID:   "match-1",
		}
		record, _, err := store.EnsureMatch(ctx, key, faucetTable(player, suffix))
		if err != nil {
			t.Fatalf("EnsureMatch() error = %v", err)
		}
		if _, err := store.RecordCompletedHand(ctx, player, record.RuntimeID, true); err != nil {
			t.Fatalf("RecordCompletedHand() error = %v", err)
		}
	}

	// §11.4: Practice grants no Jade. Five hands must move the balance by zero.
	after, err := store.JadeAccountWithFaucets(ctx, player)
	if err != nil {
		t.Fatalf("JadeAccountWithFaucets() error = %v", err)
	}
	if after.Balance != start.Balance {
		t.Fatalf("Practice paid Jade: %d -> %d", start.Balance, after.Balance)
	}
}

func TestPostgreSQLStorage_GrantsKeepTheLedgerBalanced(t *testing.T) {
	store := faucetStore(t)
	ctx := context.Background()
	suffix := randomSuffix(t)
	player := "ledger-" + suffix

	spendUntilLockedOut(t, store, faucetTable(player, suffix))
	key := MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "practice-" + suffix,
		MatchID:   "match-1",
	}
	record, _, err := store.EnsureMatch(ctx, key, faucetTable(player, suffix))
	if err != nil {
		t.Fatalf("EnsureMatch() error = %v", err)
	}
	if _, err := store.RecordCompletedHand(ctx, player, record.RuntimeID, true); err != nil {
		t.Fatalf("RecordCompletedHand() error = %v", err)
	}
	if _, granted, err := store.ClaimJadeWelfare(ctx, player); err != nil || !granted.Eligible {
		t.Fatalf("claim: granted=%#v err=%v", granted, err)
	}

	// Every faucet is double-entry against the treasury, so the whole ledger
	// including the issuance account must still sum to zero.
	var total int64
	if err := store.pool.QueryRow(ctx, `SELECT COALESCE(SUM(balance), 0) FROM jade_accounts`).
		Scan(&total); err != nil {
		t.Fatalf("sum balances: %v", err)
	}
	if total != 0 {
		t.Fatalf("ledger sums to %d, want 0", total)
	}

	var postings int64
	if err := store.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0) FROM jade_postings`).Scan(&postings); err != nil {
		t.Fatalf("sum postings: %v", err)
	}
	if postings != 0 {
		t.Fatalf("postings sum to %d, want 0", postings)
	}
}
