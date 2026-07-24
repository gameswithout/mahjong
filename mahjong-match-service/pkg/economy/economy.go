package economy

import (
	"context"
	"errors"
	"fmt"
	"strings"

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
	return c.repository.EnsureJadeAccount(ctx, userID)
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
	if c == nil || c.repository == nil || IsPractice(view) {
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
		actual, syncErr := c.mirror.Balance(ctx, target.UserID)
		if syncErr == nil && actual < target.Balance {
			syncErr = c.mirror.Credit(ctx, target.UserID, target.Balance-actual)
		}
		if syncErr == nil && actual > target.Balance {
			syncErr = c.mirror.Debit(ctx, target.UserID, actual-target.Balance)
		}
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
