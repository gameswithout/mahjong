package economy

import (
	"context"
	"testing"

	"github.com/gameswithout/mahjong/rulesengine"
)

type fakeRepository struct {
	account          Account
	accountCalls     int
	settleCalls      int
	targets          []WalletTarget
	syncedUser       string
	syncedBalance    int64
	syncFailedUser   string
	syncFailedReason error
}

func (f *fakeRepository) EnsureJadeAccount(context.Context, string) (Account, error) {
	f.accountCalls++
	return f.account, nil
}

func (f *fakeRepository) ReserveJade(context.Context, string) (Account, Reservation, error) {
	return f.account, Reservation{}, nil
}

func (f *fakeRepository) ReleaseJadeReservation(context.Context, string) (Account, error) {
	return f.account, nil
}

func (f *fakeRepository) BindJadeReservation(context.Context, string, string) error {
	return nil
}

func (f *fakeRepository) SettleJadeMatch(
	_ context.Context,
	runtimeID string,
	_ rulesengine.Settlement,
) (map[string]PlayerSettlement, error) {
	f.settleCalls++
	f.account.Balance = 5_030
	f.account.Available = 5_030
	return map[string]PlayerSettlement{
		"user-east": {
			RuntimeID:     runtimeID,
			UserID:        "user-east",
			Seat:          rulesengine.East,
			Delta:         30,
			BalanceBefore: 5_000,
			BalanceAfter:  5_030,
			JournalID:     "settlement:" + runtimeID,
		},
	}, nil
}

func (f *fakeRepository) JadeSettlement(
	context.Context,
	string,
	string,
) (*PlayerSettlement, error) {
	return nil, nil
}

func (f *fakeRepository) PendingJadeWalletTargets(context.Context, int) ([]WalletTarget, error) {
	return f.targets, nil
}

func (f *fakeRepository) MarkJadeWalletSynced(_ context.Context, userID string, balance int64) error {
	f.syncedUser = userID
	f.syncedBalance = balance
	return nil
}

func (f *fakeRepository) MarkJadeWalletSyncFailed(
	_ context.Context,
	userID string,
	err error,
) error {
	f.syncFailedUser = userID
	f.syncFailedReason = err
	return nil
}

type fakeWalletMirror struct {
	balance      int64
	creditAmount int64
	debitAmount  int64
}

func (f *fakeWalletMirror) Balance(context.Context, string) (int64, error) {
	return f.balance, nil
}

func (f *fakeWalletMirror) Credit(_ context.Context, _ string, amount int64) error {
	f.creditAmount = amount
	f.balance += amount
	return nil
}

func (f *fakeWalletMirror) Debit(_ context.Context, _ string, amount int64) error {
	f.debitAmount = amount
	f.balance -= amount
	return nil
}

func TestCoordinator_ProjectBypassesPractice(t *testing.T) {
	repository := &fakeRepository{account: Account{Balance: 5_000}}
	coordinator := NewCoordinator(repository, nil)
	view := rulesengine.SeatView{
		Players: []rulesengine.PlayerView{{Seat: rulesengine.South, IsBot: true}},
	}

	account, settlement, err := coordinator.Project(
		context.Background(),
		"user-east",
		"runtime-1",
		view,
	)
	if err != nil {
		t.Fatalf("Project() error = %v", err)
	}
	if account != nil || settlement != nil || repository.accountCalls != 0 || repository.settleCalls != 0 {
		t.Fatalf(
			"Practice touched economy: account=%#v settlement=%#v accountCalls=%d settleCalls=%d",
			account,
			settlement,
			repository.accountCalls,
			repository.settleCalls,
		)
	}
}

func TestCoordinator_ProjectPostsAndReturnsPersonalSettlement(t *testing.T) {
	result := rulesengine.HandResult{Kind: rulesengine.KindExhaustiveDraw}
	settlement := rulesengine.Settlement{
		Net: map[rulesengine.Seat]int64{
			rulesengine.East: 30,
		},
		TotalCredits: 30,
		TotalDebits:  30,
	}
	repository := &fakeRepository{account: Account{Balance: 5_000, Available: 5_000}}
	coordinator := NewCoordinator(repository, nil)

	account, player, err := coordinator.Project(
		context.Background(),
		"user-east",
		"runtime-1",
		rulesengine.SeatView{
			Players:    []rulesengine.PlayerView{{Seat: rulesengine.East}},
			HandResult: &result,
			Settlement: &settlement,
		},
	)
	if err != nil {
		t.Fatalf("Project() error = %v", err)
	}
	if repository.settleCalls != 1 || account == nil || account.Balance != 5_030 {
		t.Fatalf("account=%#v settleCalls=%d", account, repository.settleCalls)
	}
	if player == nil || player.Delta != 30 || player.BalanceAfter != 5_030 {
		t.Fatalf("player settlement = %#v", player)
	}
}

func TestCoordinator_SyncWalletsReconcilesToTarget(t *testing.T) {
	repository := &fakeRepository{
		targets: []WalletTarget{{UserID: "user-east", Balance: 5_000}},
	}
	mirror := &fakeWalletMirror{balance: 4_700}
	coordinator := NewCoordinator(repository, mirror)

	if err := coordinator.SyncWallets(context.Background(), 20); err != nil {
		t.Fatalf("SyncWallets() error = %v", err)
	}
	if mirror.creditAmount != 300 || mirror.debitAmount != 0 {
		t.Fatalf("wallet mutations = credit %d debit %d", mirror.creditAmount, mirror.debitAmount)
	}
	if repository.syncedUser != "user-east" || repository.syncedBalance != 5_000 {
		t.Fatalf("synced target = %q/%d", repository.syncedUser, repository.syncedBalance)
	}
}
