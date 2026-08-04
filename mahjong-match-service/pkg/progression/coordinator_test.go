package progression

import (
	"context"
	"errors"
	"testing"

	"github.com/gameswithout/mahjong/rulesengine"
)

type memoryProgressionRepository struct {
	lifetime     int
	awards       map[string]HandAward
	onboarding   *OnboardingState
	majority     bool
	takeoverRead int
}

type dashboardProgressionRepository struct {
	*memoryProgressionRepository
	statistics map[string]float64
	statsErr   error
}

func (r *dashboardProgressionRepository) PlayerDashboardStatistics(
	_ context.Context,
	_ string,
) (map[string]float64, error) {
	if r.statsErr != nil {
		return nil, r.statsErr
	}
	return r.statistics, nil
}

func newMemoryProgressionRepository() *memoryProgressionRepository {
	return &memoryProgressionRepository{awards: map[string]HandAward{}}
}

func (r *memoryProgressionRepository) AwardXP(
	_ context.Context,
	userID string,
	_ string,
	award HandAward,
) (Player, HandAward, bool, error) {
	if existing, ok := r.awards[award.AwardID]; ok {
		player := PlayerFromXP(userID, r.lifetime)
		player.Onboarding = r.onboarding
		return player, existing, false, nil
	}
	r.awards[award.AwardID] = cloneTestAward(award)
	r.lifetime += award.Total
	player := PlayerFromXP(userID, r.lifetime)
	player.Onboarding = r.onboarding
	return player, award, true, nil
}

func (r *memoryProgressionRepository) RecordOnboarding(
	ctx context.Context,
	userID string,
	outcome OnboardingOutcome,
	award HandAward,
) (Player, HandAward, OnboardingState, bool, error) {
	if r.onboarding == nil || r.onboarding.Outcome == OnboardingSkipped {
		next := OnboardingState{Outcome: outcome, RecordedAt: "2026-07-27T00:00:00Z"}
		if r.onboarding != nil && r.onboarding.Outcome == OnboardingCompleted {
			next = *r.onboarding
		}
		r.onboarding = &next
	}
	if r.onboarding.Outcome == OnboardingCompleted && outcome == OnboardingSkipped {
		outcome = OnboardingCompleted
	}
	r.onboarding.Outcome = outcome
	player, persisted, applied, err := r.AwardXP(ctx, userID, "", award)
	player.Onboarding = r.onboarding
	return player, persisted, *r.onboarding, applied, err
}

func (r *memoryProgressionRepository) PlayerProgression(
	_ context.Context,
	userID string,
) (Player, error) {
	player := PlayerFromXP(userID, r.lifetime)
	player.Onboarding = r.onboarding
	return player, nil
}

func (r *memoryProgressionRepository) TakenOverMajority(
	context.Context,
	string,
	string,
) (bool, error) {
	r.takeoverRead++
	return r.majority, nil
}

func cloneTestAward(award HandAward) HandAward {
	award.Components = append([]XPComponent(nil), award.Components...)
	return award
}

func completedView() rulesengine.SeatView {
	return rulesengine.SeatView{
		Seat: rulesengine.East,
		HandResult: &rulesengine.HandResult{
			Kind: rulesengine.WinZimo,
			Winners: []rulesengine.HandWinner{{
				Seat: rulesengine.East,
				Score: rulesengine.ScoreResult{
					Winning: true,
					RawTai:  6,
				},
			}},
		},
	}
}

func TestCoordinatorDoesNotReadHistoryBeforeAHandCompletes(t *testing.T) {
	repository := newMemoryProgressionRepository()
	coordinator := NewCoordinator(repository)

	result, err := coordinator.RecordHand(
		context.Background(),
		"player",
		"runtime",
		rulesengine.SeatView{Seat: rulesengine.East},
		false,
	)
	if err != nil || result != nil {
		t.Fatalf("RecordHand() = %#v, %v; want no completed hand", result, err)
	}
	if repository.takeoverRead != 0 {
		t.Fatalf("takeover history reads = %d, want 0", repository.takeoverRead)
	}
}

func TestCoordinatorAppliesTakeoverMajorityBeforePricing(t *testing.T) {
	repository := newMemoryProgressionRepository()
	repository.majority = true
	coordinator := NewCoordinator(repository)

	result, err := coordinator.RecordHand(
		context.Background(), "player", "runtime", completedView(), false)
	if err != nil {
		t.Fatalf("RecordHand() error = %v", err)
	}
	if result.Award.Total != PublicHandXP {
		t.Fatalf("award = %+v, want completion XP only", result.Award)
	}
	if repository.takeoverRead != 1 {
		t.Fatalf("takeover history reads = %d, want 1", repository.takeoverRead)
	}
}

func TestCoordinatorReturnsOriginalAwardOnRepeatProjection(t *testing.T) {
	repository := newMemoryProgressionRepository()
	coordinator := NewCoordinator(repository)
	view := completedView()

	first, err := coordinator.RecordHand(
		context.Background(), "player", "runtime", view, false)
	if err != nil {
		t.Fatalf("first RecordHand() error = %v", err)
	}
	repeat, err := coordinator.RecordHand(
		context.Background(), "player", "runtime", view, false)
	if err != nil {
		t.Fatalf("repeat RecordHand() error = %v", err)
	}
	if repeat.Award.Total != first.Award.Total || !repeat.AlreadyAwarded {
		t.Fatalf("repeat = %+v, want original award %+v marked repeated", repeat, first.Award)
	}
	if repeat.Player.LifetimeXP != first.Award.Total {
		t.Fatalf("repeat lifetime XP = %d, want %d", repeat.Player.LifetimeXP, first.Award.Total)
	}
}

func TestCoordinatorOnboardingIsOneAwardWithMonotonicOutcome(t *testing.T) {
	repository := newMemoryProgressionRepository()
	coordinator := NewCoordinator(repository)

	skipped, err := coordinator.AwardOnboarding(
		context.Background(), "player", OnboardingSkipped)
	if err != nil {
		t.Fatalf("skip onboarding error = %v", err)
	}
	if skipped.AlreadyAwarded || skipped.Player.LifetimeXP != OnboardingXP ||
		skipped.Player.Onboarding == nil ||
		skipped.Player.Onboarding.Outcome != OnboardingSkipped {
		t.Fatalf("skip result = %+v", skipped)
	}

	completed, err := coordinator.AwardOnboarding(
		context.Background(), "player", OnboardingCompleted)
	if err != nil {
		t.Fatalf("complete onboarding error = %v", err)
	}
	if !completed.AlreadyAwarded || completed.Player.LifetimeXP != OnboardingXP ||
		completed.Player.Onboarding == nil ||
		completed.Player.Onboarding.Outcome != OnboardingCompleted {
		t.Fatalf("completion replay = %+v", completed)
	}

	regression, err := coordinator.AwardOnboarding(
		context.Background(), "player", OnboardingSkipped)
	if err != nil {
		t.Fatalf("repeat skip error = %v", err)
	}
	if regression.Player.Onboarding.Outcome != OnboardingCompleted {
		t.Fatalf("completed onboarding regressed: %+v", regression.Player.Onboarding)
	}
}

type fakeStatsMirror struct {
	calls   int
	updates [][]StatUpdate
	err     error
	// values is what ReadStats returns; readCodes records what was asked for.
	values     map[string]float64
	readCodes  []string
	readErr    error
	readCalled int
}

func (f *fakeStatsMirror) ReadStats(
	_ context.Context,
	_ string,
	statCodes []string,
) (map[string]float64, error) {
	f.readCalled++
	f.readCodes = statCodes
	if f.readErr != nil {
		return nil, f.readErr
	}
	return f.values, nil
}

func (f *fakeStatsMirror) RecordHandStats(
	_ context.Context,
	_ string,
	updates []StatUpdate,
) error {
	f.calls++
	f.updates = append(f.updates, updates)
	return f.err
}

func TestCoordinator_StatsProjectOnceDespiteRepeatedProjection(t *testing.T) {
	// GetMatchState re-projects a finished hand on every poll. Without riding
	// the XP award's idempotency, every poll would increment the achievement
	// counters again.
	repository := newMemoryProgressionRepository()
	stats := &fakeStatsMirror{}
	coordinator := NewCoordinator(repository)
	coordinator.SetStatsMirror(stats, nil)

	view := rulesengine.SeatView{
		Seat:       rulesengine.East,
		Players:    []rulesengine.PlayerView{{Seat: rulesengine.East}},
		HandResult: &rulesengine.HandResult{Kind: rulesengine.KindExhaustiveDraw},
	}

	for range 5 {
		if _, err := coordinator.RecordHand(
			context.Background(), "user-east", "runtime-1", view, false,
		); err != nil {
			t.Fatalf("RecordHand() error = %v", err)
		}
	}

	if stats.calls != 1 {
		t.Fatalf("stats projected %d times across 5 polls, want 1", stats.calls)
	}
}

func TestCoordinator_PracticeProjectsNoAchievementStats(t *testing.T) {
	repository := newMemoryProgressionRepository()
	stats := &fakeStatsMirror{}
	coordinator := NewCoordinator(repository)
	coordinator.SetStatsMirror(stats, nil)

	view := rulesengine.SeatView{
		Seat:       rulesengine.East,
		Players:    []rulesengine.PlayerView{{Seat: rulesengine.South, IsBot: true}},
		HandResult: &rulesengine.HandResult{Kind: rulesengine.KindExhaustiveDraw},
	}

	if _, err := coordinator.RecordHand(
		context.Background(), "user-east", "runtime-practice", view, true,
	); err != nil {
		t.Fatalf("RecordHand() error = %v", err)
	}
	if stats.calls != 0 {
		t.Fatalf("Practice projected achievement stats: %+v", stats.updates)
	}
}

func TestCoordinator_StatsFailureDoesNotFailTheHand(t *testing.T) {
	// The ledger is authoritative and AGS is a downstream mirror. A failed
	// projection must not undo the XP award or fail the player's hand.
	repository := newMemoryProgressionRepository()
	stats := &fakeStatsMirror{err: errors.New("AGS is down")}
	coordinator := NewCoordinator(repository)

	var reported error
	coordinator.SetStatsMirror(stats, func(err error) { reported = err })

	result, err := coordinator.RecordHand(
		context.Background(),
		"user-east",
		"runtime-1",
		rulesengine.SeatView{
			Seat:       rulesengine.East,
			Players:    []rulesengine.PlayerView{{Seat: rulesengine.East}},
			HandResult: &rulesengine.HandResult{Kind: rulesengine.KindExhaustiveDraw},
		},
		false,
	)
	if err != nil {
		t.Fatalf("a failed stats projection failed the hand: %v", err)
	}
	if result == nil {
		t.Fatal("a failed stats projection lost the XP result")
	}
	if reported == nil {
		t.Fatal("a failed stats projection was swallowed silently")
	}
}

type fakeAchievementReader struct {
	codes    []string
	progress []AchievementProgress
	calls    int
	userID   string
	err      error
}

func (f *fakeAchievementReader) UnlockedAchievementCodes(
	_ context.Context,
	_ string,
) ([]string, error) {
	f.calls++
	return f.codes, f.err
}

func (f *fakeAchievementReader) AchievementProgress(
	_ context.Context,
	userID string,
) ([]AchievementProgress, error) {
	f.calls++
	f.userID = userID
	return f.progress, f.err
}

func completedPublicHand() rulesengine.SeatView {
	return rulesengine.SeatView{
		Seat:       rulesengine.East,
		Players:    []rulesengine.PlayerView{{Seat: rulesengine.East}},
		HandResult: &rulesengine.HandResult{Kind: rulesengine.KindExhaustiveDraw},
	}
}

func TestCoordinator_AwardsAchievementXPOnce(t *testing.T) {
	repository := newMemoryProgressionRepository()
	coordinator := NewCoordinator(repository)
	coordinator.SetStatsMirror(&fakeStatsMirror{}, nil)
	// AGS reports every unlocked achievement on every call, including ones
	// paid long ago, so the same two codes come back each time.
	reader := &fakeAchievementReader{codes: []string{"first-hand", "first-win"}}
	coordinator.SetAchievementReader(reader)

	first, err := coordinator.RecordHand(
		context.Background(), "user-east", "runtime-1", completedPublicHand(), false,
	)
	if err != nil {
		t.Fatalf("RecordHand() error = %v", err)
	}
	if len(first.Achievements) != 2 {
		t.Fatalf("first hand paid %d achievements, want 2", len(first.Achievements))
	}
	total := 0
	for _, award := range first.Achievements {
		total += award.Total
	}
	// First Hand 100 + First Win 200.
	if total != 300 {
		t.Fatalf("achievement XP = %d, want 300", total)
	}

	// A different hand, same unlocks reported: nothing further may be paid.
	second, err := coordinator.RecordHand(
		context.Background(), "user-east", "runtime-2", completedPublicHand(), false,
	)
	if err != nil {
		t.Fatalf("RecordHand() error = %v", err)
	}
	if len(second.Achievements) != 0 {
		t.Fatalf("already-paid achievements paid again: %+v", second.Achievements)
	}
}

func TestCoordinator_UnknownAchievementCodePaysNothingAndReports(t *testing.T) {
	repository := newMemoryProgressionRepository()
	coordinator := NewCoordinator(repository)
	coordinator.SetStatsMirror(&fakeStatsMirror{}, nil)

	var reported error
	coordinator.SetStatsMirror(&fakeStatsMirror{}, func(err error) { reported = err })
	coordinator.SetAchievementReader(&fakeAchievementReader{
		codes: []string{"achievement-from-the-future"},
	})

	result, err := coordinator.RecordHand(
		context.Background(), "user-east", "runtime-1", completedPublicHand(), false,
	)
	if err != nil {
		t.Fatalf("RecordHand() error = %v", err)
	}
	if len(result.Achievements) != 0 {
		t.Fatalf("unknown achievement paid XP: %+v", result.Achievements)
	}
	// Silently paying zero would be indistinguishable from having paid.
	if reported == nil {
		t.Fatal("unknown achievement code was swallowed silently")
	}
}

func TestCoordinator_SweepsEvenWhenThisCallsStatsWriteFailed(t *testing.T) {
	// The sweep is deliberately decoupled from the write. AGS evaluates
	// unlocks asynchronously, so binding the sweep to a successful write in
	// the same call made it miss its own hand — verified live. A failed write
	// now says nothing about whether an earlier hand's unlock is pending.
	repository := newMemoryProgressionRepository()
	coordinator := NewCoordinator(repository)
	coordinator.SetStatsMirror(
		&fakeStatsMirror{err: errors.New("AGS is down")},
		func(error) {},
	)
	reader := &fakeAchievementReader{codes: []string{"first-hand"}}
	coordinator.SetAchievementReader(reader)

	if _, err := coordinator.RecordHand(
		context.Background(), "user-east", "runtime-1", completedPublicHand(), false,
	); err != nil {
		t.Fatalf("RecordHand() error = %v", err)
	}
	if reader.calls == 0 {
		t.Fatal("a failed stats write suppressed the sweep entirely")
	}
}

func TestCoordinator_PracticeNeverSweepsAchievements(t *testing.T) {
	repository := newMemoryProgressionRepository()
	coordinator := NewCoordinator(repository)
	coordinator.SetStatsMirror(&fakeStatsMirror{}, nil)
	reader := &fakeAchievementReader{codes: []string{"first-hand"}}
	coordinator.SetAchievementReader(reader)

	view := completedPublicHand()
	view.Players = []rulesengine.PlayerView{{Seat: rulesengine.South, IsBot: true}}

	if _, err := coordinator.RecordHand(
		context.Background(), "user-east", "runtime-practice", view, true,
	); err != nil {
		t.Fatalf("RecordHand() error = %v", err)
	}
	if reader.calls != 0 {
		t.Fatalf("Practice swept achievements %d times", reader.calls)
	}
}

func TestAchievementRewardTableMatchesConfiguredSet(t *testing.T) {
	// Every reward here must correspond to an achievement actually configured
	// in the namespace; an entry with no config can never pay, and a config
	// with no entry pays nothing while looking like it should.
	if got := len(LaunchAchievements()); got != 25 {
		t.Fatalf("reward table has %d achievements, want the 25 configured", got)
	}
	seen := map[string]bool{}
	for _, achievement := range LaunchAchievements() {
		if achievement.XP <= 0 {
			t.Fatalf("%s awards no XP", achievement.Code)
		}
		if seen[achievement.Code] {
			t.Fatalf("duplicate achievement code %q", achievement.Code)
		}
		seen[achievement.Code] = true
	}
	if _, known := AchievementByCode("not-an-achievement"); known {
		t.Fatal("an unknown code resolved to an achievement")
	}

	catalog := AchievementCatalog()
	if got := len(catalog); got != 34 {
		t.Fatalf("catalog has %d achievements, want 34", got)
	}
	unavailable := 0
	for _, achievement := range catalog {
		if achievement.Description == "" || achievement.Goal <= 0 || achievement.XP <= 0 {
			t.Errorf("incomplete catalog entry: %+v", achievement)
		}
		if !achievement.Available {
			unavailable++
			if achievement.UnavailableReason == "" {
				t.Errorf("%s is unavailable without a reason", achievement.Code)
			}
		}
	}
	if unavailable != 9 {
		t.Fatalf("unavailable catalog entries = %d, want 9", unavailable)
	}
}

func TestCoordinator_PlayerAchievementsMergesAGSProgressWithCompleteCatalog(t *testing.T) {
	reader := &fakeAchievementReader{progress: []AchievementProgress{
		{Code: "first-hand", Current: 1, Unlocked: true},
		{Code: "self-reliant", Current: 4},
		// Duplicate rows are merged conservatively.
		{Code: "self-reliant", Current: 3, Unlocked: true},
		// Invalid values never escape into JSON.
		{Code: "first-win", Current: -4},
		{Code: "achievement-from-the-future", Current: 7},
	}}
	coordinator := NewCoordinator(nil)
	var reported error
	coordinator.SetStatsMirror(nil, func(err error) { reported = err })
	coordinator.SetAchievementReader(reader)

	achievements, err := coordinator.PlayerAchievements(
		context.Background(),
		" player-1 ",
	)
	if err != nil {
		t.Fatalf("PlayerAchievements() error = %v", err)
	}
	if reader.userID != "player-1" {
		t.Fatalf("reader user ID = %q, want player-1", reader.userID)
	}
	if len(achievements) != 34 {
		t.Fatalf("catalog length = %d, want 34", len(achievements))
	}
	byCode := map[string]PlayerAchievement{}
	for _, achievement := range achievements {
		byCode[achievement.Achievement.Code] = achievement
	}
	if got := byCode["first-hand"]; got.Current != 1 || !got.Unlocked {
		t.Errorf("first-hand = %+v", got)
	}
	if got := byCode["self-reliant"]; got.Current != 4 || !got.Unlocked {
		t.Errorf("self-reliant duplicate merge = %+v", got)
	}
	if got := byCode["first-win"]; got.Current != 0 {
		t.Errorf("negative progress escaped: %+v", got)
	}
	if got := byCode["kong-collector"]; got.Current != 0 || got.Unlocked {
		t.Errorf("missing configured row did not default to zero: %+v", got)
	}
	if got := byCode["claim-student"]; got.Achievement.Available ||
		got.Current != 0 || got.Achievement.UnavailableReason == "" {
		t.Errorf("unavailable entry = %+v", got)
	}
	if reported == nil {
		t.Fatal("unknown AGS achievement was not reported")
	}
}

func TestCoordinator_PlayerAchievementsRequiresProgressReader(t *testing.T) {
	coordinator := NewCoordinator(nil)
	if _, err := coordinator.PlayerAchievements(context.Background(), "player-1"); !errors.Is(
		err,
		ErrNotInitialized,
	) {
		t.Fatalf("PlayerAchievements() error = %v, want ErrNotInitialized", err)
	}
}

// §P2.3. The dashboard reads the same counters the achievements evaluate, so
// the codes it asks for must be exactly the ones the write path produces.
func TestPlayerStatistics_ReadsTheDashboardCodes(t *testing.T) {
	stats := &fakeStatsMirror{values: map[string]float64{StatPublicHandsCompleted: 40}}
	coordinator := NewCoordinator(nil)
	coordinator.SetStatsMirror(stats, func(error) {})

	values, err := coordinator.PlayerStatistics(context.Background(), "player-1")
	if err != nil {
		t.Fatalf("PlayerStatistics: %v", err)
	}
	if values[StatPublicHandsCompleted] != 40 {
		t.Errorf("hands completed = %v, want 40", values[StatPublicHandsCompleted])
	}

	asked := map[string]bool{}
	for _, code := range stats.readCodes {
		asked[code] = true
	}
	for _, code := range []string{
		StatPublicHandsCompleted, StatPublicHandsWon, StatZimoWins,
		StatPublicHandsDealtIn, StatPublicHandsTing, StatKongsDeclared, StatHighestRawTai,
	} {
		if !asked[code] {
			t.Errorf("dashboard did not ask AGS for %s", code)
		}
	}
}

// Without the mirror the player would otherwise be shown a record of zeroes,
// which reads as "you have never won" rather than "this is unavailable".
func TestPlayerStatistics_WithoutAMirrorIsAnError(t *testing.T) {
	if _, err := NewCoordinator(nil).PlayerStatistics(context.Background(), "player-1"); err == nil {
		t.Fatal("a coordinator with no stats mirror returned statistics")
	}
}

func TestPlayerStatistics_UsesLedgerForCoreTotalsWhenProjectionFails(t *testing.T) {
	repository := &dashboardProgressionRepository{
		memoryProgressionRepository: newMemoryProgressionRepository(),
		statistics: map[string]float64{
			StatPublicHandsCompleted: 3,
			StatPublicHandsWon:       1,
		},
	}
	stats := &fakeStatsMirror{readErr: errors.New("AGS unavailable")}
	var reported error
	coordinator := NewCoordinator(repository)
	coordinator.SetStatsMirror(stats, func(err error) { reported = err })

	values, err := coordinator.PlayerStatistics(context.Background(), "player-1")
	if err != nil {
		t.Fatalf("PlayerStatistics: %v", err)
	}
	if values[StatPublicHandsCompleted] != 3 || values[StatPublicHandsWon] != 1 {
		t.Fatalf("ledger totals = %+v, want 3 played / 1 won", values)
	}
	if reported == nil {
		t.Fatal("projection read failure was not reported")
	}
}

func TestPlayerStatistics_LedgerCoreTotalsOverrideStaleProjection(t *testing.T) {
	repository := &dashboardProgressionRepository{
		memoryProgressionRepository: newMemoryProgressionRepository(),
		statistics: map[string]float64{
			StatPublicHandsCompleted: 4,
			StatPublicHandsWon:       2,
		},
	}
	stats := &fakeStatsMirror{values: map[string]float64{
		StatPublicHandsCompleted: 3,
		StatPublicHandsWon:       1,
		StatPublicHandsTing:      2,
	}}
	coordinator := NewCoordinator(repository)
	coordinator.SetStatsMirror(stats, nil)

	values, err := coordinator.PlayerStatistics(context.Background(), "player-1")
	if err != nil {
		t.Fatalf("PlayerStatistics: %v", err)
	}
	if values[StatPublicHandsCompleted] != 4 || values[StatPublicHandsWon] != 2 {
		t.Fatalf("stale projection replaced ledger totals: %+v", values)
	}
	if values[StatPublicHandsTing] != 2 {
		t.Fatalf("supplemental projected statistic missing: %+v", values)
	}
}

func TestCoordinator_SweepsOnEveryProjectionSoALateUnlockStillPays(t *testing.T) {
	// The bug this pins: AGS evaluates unlocks asynchronously from the stat
	// write, so the unlock is usually not visible on the call that wrote the
	// stats. Binding the sweep to that one call paid the XP a hand late — or
	// not at all. Verified live 2026-07-30 before the fix.
	repository := newMemoryProgressionRepository()
	coordinator := NewCoordinator(repository)
	coordinator.SetStatsMirror(&fakeStatsMirror{}, nil)

	// AGS reports nothing on the first look, as if it has not evaluated yet.
	reader := &fakeAchievementReader{}
	coordinator.SetAchievementReader(reader)

	view := completedPublicHand()
	first, err := coordinator.RecordHand(
		context.Background(), "user-east", "runtime-1", view, false,
	)
	if err != nil {
		t.Fatalf("RecordHand() error = %v", err)
	}
	if len(first.Achievements) != 0 {
		t.Fatalf("paid an achievement AGS had not reported: %+v", first.Achievements)
	}

	// The unlock lands a moment later. A subsequent projection of the *same*
	// finished hand — which the result screen produces by polling — must pay it.
	reader.codes = []string{"first-hand"}
	second, err := coordinator.RecordHand(
		context.Background(), "user-east", "runtime-1", view, false,
	)
	if err != nil {
		t.Fatalf("RecordHand() error = %v", err)
	}
	if len(second.Achievements) != 1 || second.Achievements[0].Total != 100 {
		t.Fatalf("late unlock was not paid on a later projection: %+v", second.Achievements)
	}

	// And still only once, however many more times it is reported.
	third, _ := coordinator.RecordHand(
		context.Background(), "user-east", "runtime-1", view, false,
	)
	if len(third.Achievements) != 0 {
		t.Fatalf("paid the same achievement twice: %+v", third.Achievements)
	}
}
