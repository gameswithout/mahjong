package storage

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/economy"
	"github.com/jackc/pgx/v5"
)

// §7.5 faucets. Every write here is idempotent by primary key rather than by a
// read-then-write check, because the caller is a poll loop running against more
// than one replica.

func dailyGrantJournalID(kind, userID string, day time.Time) string {
	return fmt.Sprintf("grant:daily:%s:%s:%s", kind, day.Format("2006-01-02"), userID)
}

// RecordCompletedHand notes that a player finished a hand and pays any daily
// play grants that hand has earned. Calling it repeatedly for the same hand —
// which GetMatchState does on every poll of a finished match — writes once.
func (p *PostgreSQLStorage) RecordCompletedHand(
	ctx context.Context,
	userID string,
	runtimeID string,
	practice bool,
) (economy.Account, error) {
	if p == nil || p.pool == nil {
		return economy.Account{}, economy.ErrNotInitialized
	}
	userID = strings.TrimSpace(userID)
	runtimeID = strings.TrimSpace(runtimeID)
	if userID == "" || runtimeID == "" {
		return economy.Account{}, fmt.Errorf("%w: user and match are required", economy.ErrNotInitialized)
	}
	if _, err := p.EnsureJadeAccount(ctx, userID); err != nil {
		return economy.Account{}, err
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return economy.Account{}, fmt.Errorf("begin record completed hand: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := lockJadeAccount(ctx, tx, userID); err != nil {
		return economy.Account{}, err
	}

	day := economy.UTCDay(time.Now())
	if _, err := tx.Exec(ctx, `
		INSERT INTO jade_hand_participation (user_id, runtime_id, utc_day, practice)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, runtime_id) DO NOTHING`,
		userID, runtimeID, day, practice,
	); err != nil {
		return economy.Account{}, fmt.Errorf("record hand participation: %w", err)
	}

	counters, err := dailyCountersTx(ctx, tx, userID, day)
	if err != nil {
		return economy.Account{}, err
	}
	for _, grant := range economy.DueDailyPlayGrants(counters) {
		if err := awardDailyGrantTx(ctx, tx, userID, day, grant.Kind, grant.Amount); err != nil {
			return economy.Account{}, err
		}
	}

	account, err := jadeAccountWithFaucetsTx(ctx, tx, userID, day)
	if err != nil {
		return economy.Account{}, err
	}
	if err := upsertWalletTarget(ctx, tx, userID, account.Balance); err != nil {
		return economy.Account{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return economy.Account{}, fmt.Errorf("commit record completed hand: %w", err)
	}
	return account, nil
}

// ClaimJadeWelfare performs the §7.5 top-up: it sets the balance to the Bamboo
// minimum, once per UTC day, for a player who has played a Practice hand today.
// Eligibility is re-evaluated inside the transaction, under the account lock,
// so a claim cannot be decided against a balance that has since changed.
func (p *PostgreSQLStorage) ClaimJadeWelfare(
	ctx context.Context,
	userID string,
) (economy.Account, economy.WelfareStatus, error) {
	if p == nil || p.pool == nil {
		return economy.Account{}, economy.WelfareStatus{}, economy.ErrNotInitialized
	}
	if _, err := p.EnsureJadeAccount(ctx, userID); err != nil {
		return economy.Account{}, economy.WelfareStatus{}, err
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return economy.Account{}, economy.WelfareStatus{}, fmt.Errorf("begin Jade welfare claim: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := lockJadeAccount(ctx, tx, userID); err != nil {
		return economy.Account{}, economy.WelfareStatus{}, err
	}
	if err := releaseExpiredReservations(ctx, tx, userID); err != nil {
		return economy.Account{}, economy.WelfareStatus{}, err
	}

	day := economy.UTCDay(time.Now())
	account, err := jadeAccountWithFaucetsTx(ctx, tx, userID, day)
	if err != nil {
		return economy.Account{}, economy.WelfareStatus{}, err
	}
	if !account.Welfare.Eligible {
		// Not an error: the caller asked whether recovery was possible and the
		// answer, with its reason, is the useful reply.
		return account, account.Welfare, nil
	}

	if err := awardDailyGrantTx(
		ctx, tx, userID, day, economy.GrantWelfare, account.Welfare.Amount,
	); err != nil {
		return economy.Account{}, economy.WelfareStatus{}, err
	}

	granted := account.Welfare
	account, err = jadeAccountWithFaucetsTx(ctx, tx, userID, day)
	if err != nil {
		return economy.Account{}, economy.WelfareStatus{}, err
	}
	if err := upsertWalletTarget(ctx, tx, userID, account.Balance); err != nil {
		return economy.Account{}, economy.WelfareStatus{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return economy.Account{}, economy.WelfareStatus{}, fmt.Errorf("commit Jade welfare claim: %w", err)
	}
	return account, granted, nil
}

// JadeAccountWithFaucets is the account plus today's welfare standing, which is
// what the lobby needs to decide between "you are short" and "you can recover".
func (p *PostgreSQLStorage) JadeAccountWithFaucets(
	ctx context.Context,
	userID string,
) (economy.Account, error) {
	if p == nil || p.pool == nil {
		return economy.Account{}, economy.ErrNotInitialized
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return economy.Account{}, fmt.Errorf("begin Jade account read: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	account, err := jadeAccountWithFaucetsTx(ctx, tx, userID, economy.UTCDay(time.Now()))
	if err != nil {
		return economy.Account{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return economy.Account{}, fmt.Errorf("commit Jade account read: %w", err)
	}
	return account, nil
}

func jadeAccountWithFaucetsTx(
	ctx context.Context,
	tx pgx.Tx,
	userID string,
	day time.Time,
) (economy.Account, error) {
	account, err := jadeAccountTx(ctx, tx, userID)
	if err != nil {
		return economy.Account{}, err
	}
	counters, err := dailyCountersTx(ctx, tx, userID, day)
	if err != nil {
		return economy.Account{}, err
	}
	account.Welfare = economy.EvaluateWelfare(account.Balance, account.Reserved, counters)
	return account, nil
}

func dailyCountersTx(
	ctx context.Context,
	tx pgx.Tx,
	userID string,
	day time.Time,
) (economy.DailyCounters, error) {
	counters := economy.DailyCounters{Claimed: map[string]bool{}}
	if err := tx.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE practice),
			COUNT(*) FILTER (WHERE NOT practice)
		FROM jade_hand_participation
		WHERE user_id = $1 AND utc_day = $2`,
		userID, day,
	).Scan(&counters.PracticeHands, &counters.PublicHands); err != nil {
		return economy.DailyCounters{}, fmt.Errorf("read daily hand counters: %w", err)
	}

	rows, err := tx.Query(ctx, `
		SELECT grant_kind
		FROM jade_daily_grants
		WHERE user_id = $1 AND utc_day = $2`,
		userID, day,
	)
	if err != nil {
		return economy.DailyCounters{}, fmt.Errorf("read daily Jade grants: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var kind string
		if err := rows.Scan(&kind); err != nil {
			return economy.DailyCounters{}, fmt.Errorf("scan daily Jade grant: %w", err)
		}
		counters.Claimed[kind] = true
	}
	if err := rows.Err(); err != nil {
		return economy.DailyCounters{}, fmt.Errorf("iterate daily Jade grants: %w", err)
	}
	return counters, nil
}

// awardDailyGrantTx writes one grant.
//
// The journal goes first and is the real idempotency guard: its ID is derived
// from (kind, user, UTC day), and postJadeGrant only moves Jade on the insert
// that actually created it. jade_daily_grants is written second — it carries
// the foreign key to that journal, and its primary key states the
// once-per-day rule the schema is asked to enforce. A racing replica finds
// both rows already present and moves no Jade.
func awardDailyGrantTx(
	ctx context.Context,
	tx pgx.Tx,
	userID string,
	day time.Time,
	kind string,
	amount int64,
) error {
	if amount <= 0 {
		return nil
	}
	journalID := dailyGrantJournalID(kind, userID, day)
	if err := postJadeGrant(ctx, tx, journalID, kind+"_grant", userID, amount); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO jade_daily_grants (user_id, utc_day, grant_kind, journal_id, amount)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, utc_day, grant_kind) DO NOTHING`,
		userID, day, kind, journalID, amount,
	); err != nil {
		return fmt.Errorf("record %s Jade grant: %w", kind, err)
	}
	return nil
}
