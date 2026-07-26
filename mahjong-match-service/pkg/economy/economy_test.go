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
	recorded         []recordedHand
	welfareClaims    int
}

type recordedHand struct {
	userID    string
	runtimeID string
	practice  bool
}

func (f *fakeRepository) JadeAccountWithFaucets(context.Context, string) (Account, error) {
	f.accountCalls++
	return f.account, nil
}

func (f *fakeRepository) RecordCompletedHand(
	_ context.Context,
	userID string,
	runtimeID string,
	practice bool,
) (Account, error) {
	f.recorded = append(f.recorded, recordedHand{userID, runtimeID, practice})
	return f.account, nil
}

func (f *fakeRepository) ClaimJadeWelfare(
	context.Context,
	string,
) (Account, WelfareStatus, error) {
	f.welfareClaims++
	return f.account, WelfareStatus{Eligible: true, Amount: 600, Reason: WelfareAvailable}, nil
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
	balance         int64
	balanceReads    int
	creditAmount    int64
	debitAmount     int64
	ignoreMutations bool
}

func (f *fakeWalletMirror) Balance(context.Context, string) (int64, error) {
	f.balanceReads++
	return f.balance, nil
}

func (f *fakeWalletMirror) Credit(_ context.Context, _ string, amount int64) error {
	f.creditAmount = amount
	if !f.ignoreMutations {
		f.balance += amount
	}
	return nil
}

func (f *fakeWalletMirror) Debit(_ context.Context, _ string, amount int64) error {
	f.debitAmount = amount
	if !f.ignoreMutations {
		f.balance -= amount
	}
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
	if mirror.balanceReads != 2 {
		t.Fatalf("wallet balance reads = %d, want pre-write and post-write verification", mirror.balanceReads)
	}
	if repository.syncedUser != "user-east" || repository.syncedBalance != 5_000 {
		t.Fatalf("synced target = %q/%d", repository.syncedUser, repository.syncedBalance)
	}
}

func TestCoordinator_SyncWalletsRejectsUnconvergedMutation(t *testing.T) {
	repository := &fakeRepository{
		targets: []WalletTarget{{UserID: "user-east", Balance: 5_000}},
	}
	mirror := &fakeWalletMirror{balance: 4_700, ignoreMutations: true}
	coordinator := NewCoordinator(repository, mirror)

	if err := coordinator.SyncWallets(context.Background(), 20); err == nil {
		t.Fatal("SyncWallets() error = nil, want post-write verification mismatch")
	}
	if repository.syncedUser != "" {
		t.Fatalf("unconverged target marked synced for %q", repository.syncedUser)
	}
	if repository.syncFailedUser != "user-east" || repository.syncFailedReason == nil {
		t.Fatalf(
			"sync failure = user %q, reason %v",
			repository.syncFailedUser,
			repository.syncFailedReason,
		)
	}
}

func TestCoordinator_ProjectRecordsCompletedPracticeHandWithoutPaying(t *testing.T) {
	// §7.5 makes one Practice hand the welfare prerequisite, so a finished
	// Practice hand has to reach the repository — while still settling nothing.
	repository := &fakeRepository{account: Account{Balance: 400}}
	coordinator := NewCoordinator(repository, nil)
	view := rulesengine.SeatView{
		Players:    []rulesengine.PlayerView{{Seat: rulesengine.South, IsBot: true}},
		HandResult: &rulesengine.HandResult{Kind: rulesengine.KindExhaustiveDraw},
	}

	account, settlement, err := coordinator.Project(
		context.Background(), "user-east", "runtime-1", view,
	)
	if err != nil {
		t.Fatalf("Project() error = %v", err)
	}
	if settlement != nil {
		t.Fatalf("Practice produced a settlement: %#v", settlement)
	}
	if repository.settleCalls != 0 {
		t.Fatalf("Practice settled Jade: settleCalls = %d", repository.settleCalls)
	}
	if account == nil {
		t.Fatal("Practice hand returned no account; the client cannot learn the hand unlocked welfare")
	}
	if len(repository.recorded) != 1 {
		t.Fatalf("recorded = %#v, want exactly one hand", repository.recorded)
	}
	if got := repository.recorded[0]; !got.practice || got.runtimeID != "runtime-1" {
		t.Fatalf("recorded[0] = %#v, want the Practice hand for runtime-1", got)
	}
}

func TestCoordinator_ProjectRecordsPublicHandOnce(t *testing.T) {
	repository := &fakeRepository{account: Account{Balance: 5_000}}
	coordinator := NewCoordinator(repository, nil)
	view := rulesengine.SeatView{
		Players:    []rulesengine.PlayerView{{Seat: rulesengine.South}},
		HandResult: &rulesengine.HandResult{Kind: rulesengine.KindExhaustiveDraw},
	}

	// The client polls a finished match repeatedly; the coordinator forwards
	// each poll, and the repository's (user, match) key is what makes it count
	// once. Assert the forwarding is per-call and carries the right mode.
	for range 3 {
		if _, _, err := coordinator.Project(
			context.Background(), "user-east", "runtime-7", view,
		); err != nil {
			t.Fatalf("Project() error = %v", err)
		}
	}
	if len(repository.recorded) != 3 {
		t.Fatalf("recorded %d hands, want one per poll", len(repository.recorded))
	}
	for i, got := range repository.recorded {
		if got.practice || got.runtimeID != "runtime-7" || got.userID != "user-east" {
			t.Fatalf("recorded[%d] = %#v, want the public hand for runtime-7", i, got)
		}
	}
}

func TestCoordinator_ClaimWelfare(t *testing.T) {
	repository := &fakeRepository{account: Account{Balance: 1_000}}
	coordinator := NewCoordinator(repository, nil)

	_, status, err := coordinator.ClaimWelfare(context.Background(), " user-east ")
	if err != nil {
		t.Fatalf("ClaimWelfare() error = %v", err)
	}
	if !status.Eligible || status.Amount != 600 {
		t.Fatalf("status = %#v, want an eligible 600 Jade claim", status)
	}
	if repository.welfareClaims != 1 {
		t.Fatalf("welfareClaims = %d, want 1", repository.welfareClaims)
	}

	if _, _, err := coordinator.ClaimWelfare(context.Background(), "  "); err == nil {
		t.Fatal("ClaimWelfare() accepted a blank user ID")
	}
}
