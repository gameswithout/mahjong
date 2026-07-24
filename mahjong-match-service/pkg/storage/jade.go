package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/economy"
	"github.com/gameswithout/mahjong/rulesengine"
	"github.com/jackc/pgx/v5"
)

const jadeTreasuryAccount = "system:jade-issuance"

func (p *PostgreSQLStorage) EnsureJadeAccount(
	ctx context.Context,
	userID string,
) (economy.Account, error) {
	if p == nil || p.pool == nil {
		return economy.Account{}, economy.ErrNotInitialized
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return economy.Account{}, fmt.Errorf("%w: user ID is required", economy.ErrNotInitialized)
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return economy.Account{}, fmt.Errorf("begin ensure Jade account: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	accountID := jadePlayerAccount(userID)
	if _, err := tx.Exec(ctx, `
		INSERT INTO jade_accounts (account_id, allow_negative)
		VALUES ($1, TRUE)
		ON CONFLICT (account_id) DO NOTHING`, jadeTreasuryAccount); err != nil {
		return economy.Account{}, fmt.Errorf("ensure Jade treasury: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO jade_accounts (account_id, owner_user_id)
		VALUES ($1, $2)
		ON CONFLICT (account_id) DO NOTHING`, accountID, userID); err != nil {
		return economy.Account{}, fmt.Errorf("ensure player Jade account: %w", err)
	}
	var balance int64
	if err := tx.QueryRow(ctx, `
		SELECT balance
		FROM jade_accounts
		WHERE account_id = $1
		FOR UPDATE`, accountID).Scan(&balance); err != nil {
		return economy.Account{}, fmt.Errorf("lock player Jade account: %w", err)
	}
	if err := postJadeGrant(
		ctx, tx, "grant:account:"+userID, "account_grant", userID,
		economy.AccountGrant,
	); err != nil {
		return economy.Account{}, err
	}
	if err := postJadeGrant(
		ctx, tx, "grant:onboarding:"+userID, "onboarding_grant", userID,
		economy.OnboardingGrant,
	); err != nil {
		return economy.Account{}, err
	}
	account, err := jadeAccountTx(ctx, tx, userID)
	if err != nil {
		return economy.Account{}, err
	}
	if err := upsertWalletTarget(ctx, tx, userID, account.Balance); err != nil {
		return economy.Account{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return economy.Account{}, fmt.Errorf("commit ensure Jade account: %w", err)
	}
	return account, nil
}

func postJadeGrant(
	ctx context.Context,
	tx pgx.Tx,
	journalID string,
	reasonCode string,
	userID string,
	amount int64,
) error {
	tag, err := tx.Exec(ctx, `
		INSERT INTO jade_journals (
			journal_id, reason_code, rules_version, actor,
			total_debits, total_credits
		)
		VALUES ($1, $2, $3, 'system', $4, $4)
		ON CONFLICT (journal_id) DO NOTHING`,
		journalID, reasonCode, economy.RulesVersion, amount,
	)
	if err != nil {
		return fmt.Errorf("insert %s Jade journal: %w", reasonCode, err)
	}
	if tag.RowsAffected() == 0 {
		return nil
	}
	accountID := jadePlayerAccount(userID)
	if _, err := tx.Exec(ctx, `
		INSERT INTO jade_postings (
			journal_id, account_id, amount, reason_code, idempotency_key,
			rules_version, actor
		)
		VALUES
			($1, $2, $3, $4, $1 || ':player', $5, 'system'),
			($1, $6, -$3, $4, $1 || ':treasury', $5, 'system')`,
		journalID, accountID, amount, reasonCode, economy.RulesVersion,
		jadeTreasuryAccount,
	); err != nil {
		return fmt.Errorf("insert %s Jade postings: %w", reasonCode, err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE jade_accounts
		SET balance = balance + $2, updated_at = NOW()
		WHERE account_id = $1`, accountID, amount); err != nil {
		return fmt.Errorf("credit %s Jade grant: %w", reasonCode, err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE jade_accounts
		SET balance = balance - $2, updated_at = NOW()
		WHERE account_id = $1`, jadeTreasuryAccount, amount); err != nil {
		return fmt.Errorf("debit %s Jade treasury: %w", reasonCode, err)
	}
	return nil
}

func (p *PostgreSQLStorage) ReserveJade(
	ctx context.Context,
	userID string,
) (economy.Account, economy.Reservation, error) {
	if _, err := p.EnsureJadeAccount(ctx, userID); err != nil {
		return economy.Account{}, economy.Reservation{}, err
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return economy.Account{}, economy.Reservation{}, fmt.Errorf("begin Jade reservation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := lockJadeAccount(ctx, tx, userID); err != nil {
		return economy.Account{}, economy.Reservation{}, err
	}
	if err := releaseExpiredReservations(ctx, tx, userID); err != nil {
		return economy.Account{}, economy.Reservation{}, err
	}

	var current economy.Reservation
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT reservation_id, amount, status, COALESCE(runtime_id, ''), expires_at
		FROM jade_reservations
		WHERE user_id = $1 AND status IN ('active', 'bound')
		FOR UPDATE`, userID).Scan(
		&current.ID, &current.Amount, &current.Status, &current.RuntimeID, &expiresAt,
	)
	switch {
	case err == nil && current.Status == "bound":
		return economy.Account{}, economy.Reservation{}, economy.ErrReservationBound
	case err == nil:
		account, accountErr := jadeAccountTx(ctx, tx, userID)
		if accountErr != nil {
			return economy.Account{}, economy.Reservation{}, accountErr
		}
		if commitErr := tx.Commit(ctx); commitErr != nil {
			return economy.Account{}, economy.Reservation{}, fmt.Errorf("commit existing Jade reservation: %w", commitErr)
		}
		return account, current, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return economy.Account{}, economy.Reservation{}, fmt.Errorf("read Jade reservation: %w", err)
	}

	account, err := jadeAccountTx(ctx, tx, userID)
	if err != nil {
		return economy.Account{}, economy.Reservation{}, err
	}
	if account.Balance < economy.MinimumBalance {
		return economy.Account{}, economy.Reservation{}, economy.ErrIneligible
	}
	if account.Available < economy.DebitCap {
		return economy.Account{}, economy.Reservation{}, economy.ErrInsufficientReserve
	}
	reservationID, err := randomJadeID()
	if err != nil {
		return economy.Account{}, economy.Reservation{}, err
	}
	current = economy.Reservation{
		ID:     reservationID,
		Amount: economy.DebitCap,
		Status: "active",
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO jade_reservations (
			reservation_id, user_id, amount, status, expires_at
		)
		VALUES ($1, $2, $3, 'active', NOW() + ($4 * INTERVAL '1 minute'))`,
		current.ID, userID, current.Amount, economy.ReservationMinutes,
	); err != nil {
		return economy.Account{}, economy.Reservation{}, fmt.Errorf("insert Jade reservation: %w", err)
	}
	account, err = jadeAccountTx(ctx, tx, userID)
	if err != nil {
		return economy.Account{}, economy.Reservation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return economy.Account{}, economy.Reservation{}, fmt.Errorf("commit Jade reservation: %w", err)
	}
	return account, current, nil
}

func (p *PostgreSQLStorage) ReleaseJadeReservation(
	ctx context.Context,
	userID string,
) (economy.Account, error) {
	if _, err := p.EnsureJadeAccount(ctx, userID); err != nil {
		return economy.Account{}, err
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return economy.Account{}, fmt.Errorf("begin release Jade reservation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := lockJadeAccount(ctx, tx, userID); err != nil {
		return economy.Account{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE jade_reservations
		SET status = 'released', updated_at = NOW()
		WHERE user_id = $1 AND status = 'active'`, userID); err != nil {
		return economy.Account{}, fmt.Errorf("release Jade reservation: %w", err)
	}
	account, err := jadeAccountTx(ctx, tx, userID)
	if err != nil {
		return economy.Account{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return economy.Account{}, fmt.Errorf("commit release Jade reservation: %w", err)
	}
	return account, nil
}

func (p *PostgreSQLStorage) BindJadeReservation(
	ctx context.Context,
	userID string,
	runtimeID string,
) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin bind Jade reservation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := lockJadeAccount(ctx, tx, userID); err != nil {
		return err
	}
	if err := releaseExpiredReservations(ctx, tx, userID); err != nil {
		return err
	}
	var reservationID, status, boundRuntime string
	err = tx.QueryRow(ctx, `
		SELECT reservation_id, status, COALESCE(runtime_id, '')
		FROM jade_reservations
		WHERE user_id = $1 AND status IN ('active', 'bound')
		FOR UPDATE`, userID).Scan(&reservationID, &status, &boundRuntime)
	if errors.Is(err, pgx.ErrNoRows) {
		return economy.ErrReservationMissing
	}
	if err != nil {
		return fmt.Errorf("read Jade reservation for bind: %w", err)
	}
	if status == "bound" {
		if boundRuntime != runtimeID {
			return economy.ErrReservationBound
		}
		return tx.Commit(ctx)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE jade_reservations
		SET status = 'bound', runtime_id = $2, updated_at = NOW()
		WHERE reservation_id = $1`, reservationID, runtimeID); err != nil {
		return fmt.Errorf("bind Jade reservation: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit bind Jade reservation: %w", err)
	}
	return nil
}

func (p *PostgreSQLStorage) SettleJadeMatch(
	ctx context.Context,
	runtimeID string,
	settlement rulesengine.Settlement,
) (map[string]economy.PlayerSettlement, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin Jade settlement: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(
		ctx,
		"SELECT pg_advisory_xact_lock(hashtext($1))",
		"jade-settlement:"+runtimeID,
	); err != nil {
		return nil, fmt.Errorf("lock Jade settlement: %w", err)
	}
	existing, err := jadeSettlementsTx(ctx, tx, runtimeID)
	if err != nil {
		return nil, err
	}
	if len(existing) == 4 {
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit existing Jade settlement: %w", err)
		}
		return existing, nil
	}
	if len(existing) != 0 {
		return nil, fmt.Errorf("%w: partial persisted settlement", economy.ErrSettlementInvalid)
	}

	seats, users, err := matchSeatsTx(ctx, tx, runtimeID)
	if err != nil {
		return nil, err
	}
	deltas, err := validateJadeSettlement(seats, settlement)
	if err != nil {
		return nil, err
	}
	if err := lockJadeAccounts(ctx, tx, users); err != nil {
		return nil, err
	}
	var reservationCount int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM jade_reservations
		WHERE runtime_id = $1 AND status = 'bound'`, runtimeID).Scan(&reservationCount); err != nil {
		return nil, fmt.Errorf("count bound Jade reservations: %w", err)
	}
	if reservationCount != 4 {
		return nil, economy.ErrSettlementPending
	}

	journalID := "settlement:" + runtimeID
	if _, err := tx.Exec(ctx, `
		INSERT INTO jade_journals (
			journal_id, reason_code, match_id, rules_version, actor,
			total_debits, total_credits
		)
		VALUES ($1, 'match_settlement', $2, $3, 'match-service', $4, $5)`,
		journalID, runtimeID, economy.RulesVersion,
		settlement.TotalDebits, settlement.TotalCredits,
	); err != nil {
		return nil, fmt.Errorf("insert Jade settlement journal: %w", err)
	}

	result := make(map[string]economy.PlayerSettlement, 4)
	for _, userID := range users {
		var before int64
		if err := tx.QueryRow(ctx, `
			SELECT balance
			FROM jade_accounts
			WHERE owner_user_id = $1`, userID).Scan(&before); err != nil {
			return nil, fmt.Errorf("read Jade balance for settlement: %w", err)
		}
		delta := deltas[userID]
		after := before + delta
		if after < 0 {
			return nil, fmt.Errorf("%w: settlement would make a balance negative", economy.ErrSettlementInvalid)
		}
		if delta != 0 {
			if _, err := tx.Exec(ctx, `
				INSERT INTO jade_postings (
					journal_id, account_id, amount, reason_code,
					idempotency_key, match_id, rules_version, actor
				)
				VALUES (
					$1, $2, $3, 'match_settlement',
					$1 || ':' || $2, $4, $5, 'match-service'
				)`,
				journalID, jadePlayerAccount(userID), delta,
				runtimeID, economy.RulesVersion,
			); err != nil {
				return nil, fmt.Errorf("insert Jade settlement posting: %w", err)
			}
		}
		if _, err := tx.Exec(ctx, `
			UPDATE jade_accounts
			SET balance = $2, updated_at = NOW()
			WHERE owner_user_id = $1`, userID, after); err != nil {
			return nil, fmt.Errorf("update Jade settlement balance: %w", err)
		}
		player := economy.PlayerSettlement{
			RuntimeID:     runtimeID,
			UserID:        userID,
			Seat:          seats[userID],
			Delta:         delta,
			BalanceBefore: before,
			BalanceAfter:  after,
			JournalID:     journalID,
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO jade_settlements (
				runtime_id, user_id, seat, delta,
				balance_before, balance_after, journal_id
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			runtimeID, userID, string(player.Seat), delta,
			before, after, journalID,
		); err != nil {
			return nil, fmt.Errorf("insert player Jade settlement: %w", err)
		}
		if err := upsertWalletTarget(ctx, tx, userID, after); err != nil {
			return nil, err
		}
		result[userID] = player
	}
	if _, err := tx.Exec(ctx, `
		UPDATE jade_reservations
		SET status = 'consumed', updated_at = NOW()
		WHERE runtime_id = $1 AND status = 'bound'`, runtimeID); err != nil {
		return nil, fmt.Errorf("consume Jade reservations: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit Jade settlement: %w", err)
	}
	return result, nil
}

func (p *PostgreSQLStorage) JadeSettlement(
	ctx context.Context,
	runtimeID string,
	userID string,
) (*economy.PlayerSettlement, error) {
	var player economy.PlayerSettlement
	var seat string
	err := p.pool.QueryRow(ctx, `
		SELECT runtime_id, user_id, seat, delta,
		       balance_before, balance_after, journal_id
		FROM jade_settlements
		WHERE runtime_id = $1 AND user_id = $2`,
		runtimeID, userID,
	).Scan(
		&player.RuntimeID, &player.UserID, &seat, &player.Delta,
		&player.BalanceBefore, &player.BalanceAfter, &player.JournalID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read player Jade settlement: %w", err)
	}
	player.Seat = rulesengine.Seat(seat)
	return &player, nil
}

func (p *PostgreSQLStorage) PendingJadeWalletTargets(
	ctx context.Context,
	limit int,
) ([]economy.WalletTarget, error) {
	if limit <= 0 {
		limit = 20
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin Jade wallet target batch: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rows, err := tx.Query(ctx, `
		SELECT user_id, target_balance
		FROM jade_wallet_sync
		WHERE status IN ('pending', 'error') OR
		      (status = 'syncing' AND updated_at < NOW() - INTERVAL '2 minutes')
		ORDER BY updated_at
		LIMIT $1
		FOR UPDATE SKIP LOCKED`, limit)
	if err != nil {
		return nil, fmt.Errorf("query Jade wallet targets: %w", err)
	}
	targets := make([]economy.WalletTarget, 0, limit)
	for rows.Next() {
		var target economy.WalletTarget
		if err := rows.Scan(&target.UserID, &target.Balance); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan Jade wallet target: %w", err)
		}
		targets = append(targets, target)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate Jade wallet targets: %w", err)
	}
	rows.Close()
	for _, target := range targets {
		if _, err := tx.Exec(ctx, `
			UPDATE jade_wallet_sync
			SET status = 'syncing', attempt_count = attempt_count + 1,
			    updated_at = NOW()
			WHERE user_id = $1`, target.UserID); err != nil {
			return nil, fmt.Errorf("mark Jade wallet syncing: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit Jade wallet target batch: %w", err)
	}
	return targets, nil
}

func (p *PostgreSQLStorage) MarkJadeWalletSynced(
	ctx context.Context,
	userID string,
	balance int64,
) error {
	_, err := p.pool.Exec(ctx, `
		UPDATE jade_wallet_sync
		SET status = 'synced', last_error = NULL,
		    synced_at = NOW(), updated_at = NOW()
		WHERE user_id = $1 AND target_balance = $2`, userID, balance)
	if err != nil {
		return fmt.Errorf("mark Jade wallet synced: %w", err)
	}
	return nil
}

func (p *PostgreSQLStorage) MarkJadeWalletSyncFailed(
	ctx context.Context,
	userID string,
	syncErr error,
) error {
	message := "unknown wallet synchronization error"
	if syncErr != nil {
		message = syncErr.Error()
	}
	if len(message) > 500 {
		message = message[:500]
	}
	_, err := p.pool.Exec(ctx, `
		UPDATE jade_wallet_sync
		SET status = 'error', last_error = $2, updated_at = NOW()
		WHERE user_id = $1`, userID, message)
	if err != nil {
		return fmt.Errorf("mark Jade wallet sync failed: %w", err)
	}
	return nil
}

func jadePlayerAccount(userID string) string {
	return "player:" + userID
}

func lockJadeAccount(ctx context.Context, tx pgx.Tx, userID string) error {
	var accountID string
	if err := tx.QueryRow(ctx, `
		SELECT account_id
		FROM jade_accounts
		WHERE owner_user_id = $1
		FOR UPDATE`, userID).Scan(&accountID); err != nil {
		return fmt.Errorf("lock Jade account: %w", err)
	}
	return nil
}

func lockJadeAccounts(ctx context.Context, tx pgx.Tx, userIDs []string) error {
	rows, err := tx.Query(ctx, `
		SELECT owner_user_id
		FROM jade_accounts
		WHERE owner_user_id = ANY($1)
		ORDER BY account_id
		FOR UPDATE`, userIDs)
	if err != nil {
		return fmt.Errorf("lock Jade settlement accounts: %w", err)
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		count++
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate locked Jade accounts: %w", err)
	}
	if count != len(userIDs) {
		return economy.ErrSettlementPending
	}
	return nil
}

func releaseExpiredReservations(ctx context.Context, tx pgx.Tx, userID string) error {
	if _, err := tx.Exec(ctx, `
		UPDATE jade_reservations
		SET status = 'released', updated_at = NOW()
		WHERE user_id = $1 AND status = 'active' AND expires_at <= NOW()`,
		userID,
	); err != nil {
		return fmt.Errorf("release expired Jade reservation: %w", err)
	}
	return nil
}

func jadeAccountTx(ctx context.Context, tx pgx.Tx, userID string) (economy.Account, error) {
	if err := releaseExpiredReservations(ctx, tx, userID); err != nil {
		return economy.Account{}, err
	}
	account := economy.Account{
		UserID:       userID,
		CurrencyCode: economy.CurrencyCode,
		Minimum:      economy.MinimumBalance,
		StakePerTai:  economy.StakePerTai,
		DebitCap:     economy.DebitCap,
	}
	if err := tx.QueryRow(ctx, `
		SELECT a.balance,
		       COALESCE(SUM(r.amount) FILTER (
		           WHERE r.status IN ('active', 'bound') AND
		                 (r.status = 'bound' OR r.expires_at > NOW())
		       ), 0),
		       COALESCE(ws.status, 'pending')
		FROM jade_accounts a
		LEFT JOIN jade_reservations r ON r.user_id = a.owner_user_id
		LEFT JOIN jade_wallet_sync ws ON ws.user_id = a.owner_user_id
		WHERE a.owner_user_id = $1
		GROUP BY a.balance, ws.status`,
		userID,
	).Scan(&account.Balance, &account.Reserved, &account.WalletStatus); err != nil {
		return economy.Account{}, fmt.Errorf("read Jade account: %w", err)
	}
	account.Available = account.Balance - account.Reserved
	account.Eligible = account.Balance >= account.Minimum && account.Available >= account.DebitCap
	return account, nil
}

func upsertWalletTarget(ctx context.Context, tx pgx.Tx, userID string, balance int64) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO jade_wallet_sync (user_id, target_balance, status)
		VALUES ($1, $2, 'pending')
		ON CONFLICT (user_id) DO UPDATE
		SET target_balance = EXCLUDED.target_balance,
		    status = 'pending',
		    last_error = NULL,
		    updated_at = NOW()
		WHERE jade_wallet_sync.target_balance <> EXCLUDED.target_balance`,
		userID, balance,
	); err != nil {
		return fmt.Errorf("queue Jade wallet synchronization: %w", err)
	}
	return nil
}

func matchSeatsTx(
	ctx context.Context,
	tx pgx.Tx,
	runtimeID string,
) (map[string]rulesengine.Seat, []string, error) {
	rows, err := tx.Query(ctx, `
		SELECT user_id, seat
		FROM match_seats
		WHERE runtime_id = $1
		ORDER BY user_id`, runtimeID)
	if err != nil {
		return nil, nil, fmt.Errorf("read Jade settlement seats: %w", err)
	}
	defer rows.Close()
	seats := make(map[string]rulesengine.Seat, 4)
	users := make([]string, 0, 4)
	for rows.Next() {
		var userID, seat string
		if err := rows.Scan(&userID, &seat); err != nil {
			return nil, nil, fmt.Errorf("scan Jade settlement seat: %w", err)
		}
		seats[userID] = rulesengine.Seat(seat)
		users = append(users, userID)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate Jade settlement seats: %w", err)
	}
	if len(seats) != 4 {
		return nil, nil, economy.ErrSettlementPending
	}
	sort.Strings(users)
	return seats, users, nil
}

func validateJadeSettlement(
	seats map[string]rulesengine.Seat,
	settlement rulesengine.Settlement,
) (map[string]int64, error) {
	if settlement.TotalCredits < 0 ||
		settlement.TotalDebits < 0 ||
		settlement.TotalCredits != settlement.TotalDebits {
		return nil, economy.ErrSettlementInvalid
	}
	deltas := make(map[string]int64, 4)
	var sum, credits, debits int64
	for userID, seat := range seats {
		delta := settlement.Net[seat]
		if delta < -economy.DebitCap {
			return nil, fmt.Errorf("%w: Bamboo debit cap exceeded", economy.ErrSettlementInvalid)
		}
		deltas[userID] = delta
		sum += delta
		if delta > 0 {
			credits += delta
		} else {
			debits -= delta
		}
	}
	if sum != 0 || credits != settlement.TotalCredits || debits != settlement.TotalDebits {
		return nil, fmt.Errorf("%w: settlement does not conserve Jade", economy.ErrSettlementInvalid)
	}
	return deltas, nil
}

func jadeSettlementsTx(
	ctx context.Context,
	tx pgx.Tx,
	runtimeID string,
) (map[string]economy.PlayerSettlement, error) {
	rows, err := tx.Query(ctx, `
		SELECT runtime_id, user_id, seat, delta,
		       balance_before, balance_after, journal_id
		FROM jade_settlements
		WHERE runtime_id = $1`, runtimeID)
	if err != nil {
		return nil, fmt.Errorf("read Jade settlements: %w", err)
	}
	defer rows.Close()
	result := make(map[string]economy.PlayerSettlement, 4)
	for rows.Next() {
		var player economy.PlayerSettlement
		var seat string
		if err := rows.Scan(
			&player.RuntimeID, &player.UserID, &seat, &player.Delta,
			&player.BalanceBefore, &player.BalanceAfter, &player.JournalID,
		); err != nil {
			return nil, fmt.Errorf("scan Jade settlement: %w", err)
		}
		player.Seat = rulesengine.Seat(seat)
		result[player.UserID] = player
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate Jade settlements: %w", err)
	}
	return result, nil
}

func randomJadeID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", fmt.Errorf("generate Jade reservation ID: %w", err)
	}
	return hex.EncodeToString(value[:]), nil
}
