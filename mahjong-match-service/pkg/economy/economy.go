package economy

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gameswithout/mahjong/rulesengine"
)

const (
	CurrencyCode       = "JADE"
	MinimumBalance     = int64(1_000)
	StakePerTai        = int64(10)
	DebitCap           = int64(300)
	AccountGrant       = int64(3_000)
	OnboardingGrant    = int64(2_000)
	RulesVersion       = "taiwanese-16-v1.1"
	ReservationMinutes = 10
	walletSyncTimeout  = 15 * time.Second
)

var (
	ErrNotInitialized      = errors.New("Jade economy is not initialized")
	ErrIneligible          = errors.New("at least 1,000 Jade is required for Bamboo Courtyard")
	ErrInsufficientReserve = errors.New("300 available Jade is required to enter Bamboo Courtyard")
	ErrReservationBound    = errors.New("the active Jade reservation is already bound to a match")
	ErrReservationMissing  = errors.New("reserve Jade before joining a public match")
	ErrSettlementInvalid   = errors.New("the Jade settlement is invalid")
	ErrSettlementPending   = errors.New("the Jade settlement is waiting for all four reservations")
)

type Account struct {
	UserID       string
	CurrencyCode string
	Balance      int64
	Reserved     int64
	Available    int64
	Eligible     bool
	Minimum      int64
	StakePerTai  int64
	DebitCap     int64
	WalletStatus string
	WalletError  string
	// Welfare is today's §7.5 recovery standing. Carried on the account so the
	// lobby can tell "you are short" from "you are short, and here is the way
	// back" without a second round trip.
	Welfare WelfareStatus
}

type Reservation struct {
	ID        string
	Amount    int64
	Status    string
	RuntimeID string
}

type PlayerSettlement struct {
	RuntimeID     string
	UserID        string
	Seat          rulesengine.Seat
	Delta         int64
	BalanceBefore int64
	BalanceAfter  int64
	JournalID     string
}

type WalletTarget struct {
	UserID  string
	Balance int64
}

type Repository interface {
	EnsureJadeAccount(context.Context, string) (Account, error)
	ReserveJade(context.Context, string) (Account, Reservation, error)
	ReleaseJadeReservation(context.Context, string) (Account, error)
	BindJadeReservation(context.Context, string, string) error
	SettleJadeMatch(context.Context, string, rulesengine.Settlement) (map[string]PlayerSettlement, error)
	JadeSettlement(context.Context, string, string) (*PlayerSettlement, error)
	PendingJadeWalletTargets(context.Context, int) ([]WalletTarget, error)
	MarkJadeWalletSynced(context.Context, string, int64) error
	MarkJadeWalletSyncFailed(context.Context, string, error) error
	// §7.5 faucets.
	JadeAccountWithFaucets(context.Context, string) (Account, error)
	RecordCompletedHand(ctx context.Context, userID, runtimeID string, practice bool) (Account, error)
	ClaimJadeWelfare(context.Context, string) (Account, WelfareStatus, error)
}

type WalletMirror interface {
	Balance(context.Context, string) (int64, error)
	Credit(context.Context, string, int64) error
	Debit(context.Context, string, int64) error
}

type Coordinator struct {
	repository Repository
	mirror     WalletMirror
}

func NewCoordinator(repository Repository, mirror WalletMirror) *Coordinator {
	return &Coordinator{repository: repository, mirror: mirror}
}

func (c *Coordinator) Account(ctx context.Context, userID string) (Account, error) {
	if c == nil || c.repository == nil {
		return Account{}, ErrNotInitialized
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return Account{}, fmt.Errorf("%w: user ID is required", ErrNotInitialized)
	}
	if _, err := c.repository.EnsureJadeAccount(ctx, userID); err != nil {
		return Account{}, err
	}
	// Read back through the faucet-aware path so every account the client sees
	// carries today's welfare standing.
	return c.repository.JadeAccountWithFaucets(ctx, userID)
}

// ClaimWelfare performs the §7.5 recovery top-up. An ineligible claim is not an
// error: the returned status explains why, which is what the caller asked.
func (c *Coordinator) ClaimWelfare(
	ctx context.Context,
	userID string,
) (Account, WelfareStatus, error) {
	if c == nil || c.repository == nil {
		return Account{}, WelfareStatus{}, ErrNotInitialized
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return Account{}, WelfareStatus{}, fmt.Errorf("%w: user ID is required", ErrNotInitialized)
	}
	return c.repository.ClaimJadeWelfare(ctx, userID)
}

func (c *Coordinator) Reserve(ctx context.Context, userID string) (Account, Reservation, error) {
	if c == nil || c.repository == nil {
		return Account{}, Reservation{}, ErrNotInitialized
	}
	return c.repository.ReserveJade(ctx, strings.TrimSpace(userID))
}

func (c *Coordinator) Release(ctx context.Context, userID string) (Account, error) {
	if c == nil || c.repository == nil {
		return Account{}, ErrNotInitialized
	}
	return c.repository.ReleaseJadeReservation(ctx, strings.TrimSpace(userID))
}

func (c *Coordinator) Bind(ctx context.Context, userID, runtimeID string) error {
	if c == nil || c.repository == nil {
		return ErrNotInitialized
	}
	return c.repository.BindJadeReservation(
		ctx,
		strings.TrimSpace(userID),
		strings.TrimSpace(runtimeID),
	)
}

func (c *Coordinator) Project(
	ctx context.Context,
	userID string,
	runtimeID string,
	view rulesengine.SeatView,
) (*Account, *PlayerSettlement, error) {
	if c == nil || c.repository == nil {
		return nil, nil, nil
	}
	practice := IsPractice(view)

	// A finished hand is recorded for both modes, because §7.5 makes a Practice
	// hand the prerequisite for the welfare top-up. RecordCompletedHand is
	// keyed on (user, match), so the poll that repeats a finished view for the
	// rest of the session counts it exactly once.
	if view.HandResult != nil {
		account, err := c.repository.RecordCompletedHand(ctx, userID, runtimeID, practice)
		if err != nil {
			return nil, nil, err
		}
		if practice {
			// Practice pays no Jade and has no settlement to project, but the
			// account still travels back so the client sees any grant the hand
			// just unlocked.
			return &account, nil, nil
		}
	} else if practice {
		return nil, nil, nil
	}

	account, err := c.Account(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	if view.HandResult == nil || view.Settlement == nil {
		return &account, nil, nil
	}
	settlements, err := c.repository.SettleJadeMatch(ctx, runtimeID, *view.Settlement)
	if err != nil {
		if errors.Is(err, ErrSettlementPending) {
			return &account, nil, nil
		}
		return nil, nil, err
	}
	account, err = c.Account(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	settlement := settlements[userID]
	return &account, &settlement, nil
}

func (c *Coordinator) SyncWallets(ctx context.Context, limit int) error {
	if c == nil || c.repository == nil || c.mirror == nil {
		return nil
	}
	targets, err := c.repository.PendingJadeWalletTargets(ctx, limit)
	if err != nil {
		return err
	}
	var firstErr error
	for _, target := range targets {
		targetCtx, cancel := context.WithTimeout(ctx, walletSyncTimeout)
		actual, syncErr := c.mirror.Balance(targetCtx, target.UserID)
		if syncErr == nil && actual < target.Balance {
			syncErr = c.mirror.Credit(targetCtx, target.UserID, target.Balance-actual)
		}
		if syncErr == nil && actual > target.Balance {
			syncErr = c.mirror.Debit(targetCtx, target.UserID, actual-target.Balance)
		}
		if syncErr == nil && actual != target.Balance {
			actual, syncErr = c.mirror.Balance(targetCtx, target.UserID)
			if syncErr == nil && actual != target.Balance {
				syncErr = fmt.Errorf(
					"AGS Jade wallet verification mismatch for user %s: got %d, want %d",
					target.UserID,
					actual,
					target.Balance,
				)
			}
		}
		cancel()
		if syncErr == nil {
			syncErr = c.repository.MarkJadeWalletSynced(ctx, target.UserID, target.Balance)
		} else {
			_ = c.repository.MarkJadeWalletSyncFailed(ctx, target.UserID, syncErr)
		}
		if syncErr != nil && firstErr == nil {
			firstErr = syncErr
		}
	}
	return firstErr
}

func IsPractice(view rulesengine.SeatView) bool {
	for _, player := range view.Players {
		if player.IsBot {
			return true
		}
	}
	return false
}
