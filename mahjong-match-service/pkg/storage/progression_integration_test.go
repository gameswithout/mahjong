//go:build integration

package storage

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/progression"
)

func progressionStore(t *testing.T) *PostgreSQLStorage {
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

func testXPAward(id, source string, amount int) progression.HandAward {
	return progression.HandAward{
		AwardID: id,
		Source:  source,
		Total:   amount,
		Components: []progression.XPComponent{{
			Code:   "integration-test",
			Label:  "Integration test",
			Amount: amount,
		}},
	}
}

func TestPostgreSQLStorage_AwardXPIsIdempotentAndReturnsOriginalAward(t *testing.T) {
	store := progressionStore(t)
	ctx := context.Background()
	user := "xp-" + randomSuffix(t)
	id := "hand:r1:" + user
	original := testXPAward(id, progression.SourcePublicHand, 175)

	first, persisted, applied, err := store.AwardXP(ctx, user, "", original)
	if err != nil {
		t.Fatalf("AwardXP() error = %v", err)
	}
	if !applied || first.LifetimeXP != 175 || persisted.Total != 175 {
		t.Fatalf("first award: applied=%v player=%+v award=%+v", applied, first, persisted)
	}

	// Finished-hand projections repeat. Even a later caller with different
	// pricing inputs must receive the immutable original award.
	changed := testXPAward(id, progression.SourcePublicHand, 999)
	for range 5 {
		repeat, repeatAward, repeatApplied, err := store.AwardXP(ctx, user, "", changed)
		if err != nil {
			t.Fatalf("repeat AwardXP() error = %v", err)
		}
		if repeatApplied || repeat.LifetimeXP != 175 || repeatAward.Total != 175 {
			t.Fatalf(
				"repeat: applied=%v player=%+v award=%+v",
				repeatApplied,
				repeat,
				repeatAward,
			)
		}
		if len(repeatAward.Components) != 1 ||
			repeatAward.Components[0].Amount != 175 {
			t.Fatalf("repeat components = %+v, want original breakdown", repeatAward.Components)
		}
	}

	second, _, applied, err := store.AwardXP(
		ctx,
		user,
		"",
		testXPAward("hand:r2:"+user, progression.SourcePublicHand, 100),
	)
	if err != nil || !applied {
		t.Fatalf("second hand: applied=%v err=%v", applied, err)
	}
	if second.LifetimeXP != 275 {
		t.Fatalf("lifetime XP = %d, want 275", second.LifetimeXP)
	}
}

func TestPostgreSQLStorage_LevelRewardsAreGrantedMonotonically(t *testing.T) {
	store := progressionStore(t)
	ctx := context.Background()
	user := "xp-level-" + randomSuffix(t)
	award := progression.OnboardingAward()
	award.AwardID = "onboarding:" + user

	player, _, state, granted, err := store.RecordOnboarding(
		ctx,
		user,
		progression.OnboardingCompleted,
		award,
	)
	if err != nil {
		t.Fatalf("RecordOnboarding() error = %v", err)
	}
	if !granted || state.Outcome != progression.OnboardingCompleted {
		t.Fatalf("onboarding: granted=%v state=%+v", granted, state)
	}
	if player.Level.Level != 2 || player.Level.XPForNextLevel != 600 {
		t.Fatalf("player = %+v, want level 2 needing 600", player)
	}
	if len(player.Earned) != 1 ||
		player.Earned[0].Code != "level-2-student-title" {
		t.Fatalf("earned = %+v, want the persisted level 2 title", player.Earned)
	}
	if player.Next == nil || player.Next.Level != 5 {
		t.Fatalf("next = %+v, want the level 5 theme", player.Next)
	}

	if _, err := store.pool.Exec(
		ctx,
		`UPDATE progression_reward_grants SET reward_name = 'Revoked'
		 WHERE user_id = $1`,
		user,
	); err == nil {
		t.Fatal("progression reward grant accepted an UPDATE")
	}
	if _, err := store.pool.Exec(
		ctx,
		`DELETE FROM progression_reward_grants WHERE user_id = $1`,
		user,
	); err == nil {
		t.Fatal("progression reward grant accepted a DELETE")
	}
}

func TestPostgreSQLStorage_PracticeAwardsHaveNoDailyCap(t *testing.T) {
	store := progressionStore(t)
	ctx := context.Background()
	user := "xp-practice-" + randomSuffix(t)

	const hands = 12
	type result struct {
		award progression.HandAward
		err   error
	}
	results := make(chan result, hands)
	var wait sync.WaitGroup
	for hand := range hands {
		wait.Add(1)
		go func(hand int) {
			defer wait.Done()
			_, award, _, err := store.AwardXP(
				ctx,
				user,
				"",
				testXPAward(
					fmt.Sprintf("hand:practice-%d:%s", hand, user),
					progression.SourcePractice,
					progression.PracticeHandXP,
				),
			)
			results <- result{award: award, err: err}
		}(hand)
	}
	wait.Wait()
	close(results)

	total := 0
	for result := range results {
		if result.err != nil {
			t.Fatalf("concurrent AwardXP() error = %v", result.err)
		}
		total += result.award.Total
	}
	want := hands * progression.PracticeHandXP
	if total != want {
		t.Fatalf("concurrent Practice XP = %d, want %d", total, want)
	}
	player, err := store.PlayerProgression(ctx, user)
	if err != nil {
		t.Fatalf("PlayerProgression() error = %v", err)
	}
	if player.LifetimeXP != want {
		t.Fatalf("lifetime XP = %d, want %d", player.LifetimeXP, want)
	}
}

func TestPostgreSQLStorage_OnboardingOutcomeIsMonotonicAndAwardIsOnce(t *testing.T) {
	store := progressionStore(t)
	ctx := context.Background()
	user := "xp-onboarding-" + randomSuffix(t)
	award := progression.OnboardingAward()
	award.AwardID = "onboarding:" + user

	player, persisted, skipped, granted, err := store.RecordOnboarding(
		ctx,
		user,
		progression.OnboardingSkipped,
		award,
	)
	if err != nil {
		t.Fatalf("skip RecordOnboarding() error = %v", err)
	}
	if !granted || skipped.Outcome != progression.OnboardingSkipped ||
		player.LifetimeXP != progression.OnboardingXP ||
		persisted.Total != progression.OnboardingXP {
		t.Fatalf(
			"skip: granted=%v state=%+v player=%+v award=%+v",
			granted,
			skipped,
			player,
			persisted,
		)
	}

	_, _, completed, granted, err := store.RecordOnboarding(
		ctx,
		user,
		progression.OnboardingCompleted,
		award,
	)
	if err != nil {
		t.Fatalf("complete RecordOnboarding() error = %v", err)
	}
	if granted || completed.Outcome != progression.OnboardingCompleted {
		t.Fatalf("completion replay: granted=%v state=%+v", granted, completed)
	}

	player, _, final, granted, err := store.RecordOnboarding(
		ctx,
		user,
		progression.OnboardingSkipped,
		award,
	)
	if err != nil {
		t.Fatalf("regression RecordOnboarding() error = %v", err)
	}
	if granted || final.Outcome != progression.OnboardingCompleted ||
		player.LifetimeXP != progression.OnboardingXP {
		t.Fatalf("regression: granted=%v state=%+v player=%+v", granted, final, player)
	}
}

func TestPostgreSQLStorage_ZeroAwardStillMarksTheHandPriced(t *testing.T) {
	store := progressionStore(t)
	ctx := context.Background()
	user := "xp-zero-" + randomSuffix(t)
	award := testXPAward("hand:capped:"+user, progression.SourcePractice, 0)

	player, persisted, applied, err := store.AwardXP(ctx, user, "", award)
	if err != nil || !applied {
		t.Fatalf("zero award: applied=%v err=%v", applied, err)
	}
	if player.LifetimeXP != 0 || persisted.Total != 0 {
		t.Fatalf("zero award moved XP: player=%+v award=%+v", player, persisted)
	}
	if _, _, repeatApplied, err := store.AwardXP(ctx, user, "", award); err != nil {
		t.Fatalf("repeat zero award error = %v", err)
	} else if repeatApplied {
		t.Fatal("zero award was not recorded, so the hand would be priced again")
	}
}

func TestPostgreSQLStorage_PracticeMasteryCapIsAtomicAndResetsOnUTCDate(t *testing.T) {
	store := progressionStore(t)
	ctx := context.Background()
	user := "xp-practice-cap-" + randomSuffix(t)
	day := time.Date(2026, time.August, 15, 23, 59, 0, 0, time.UTC)
	store.now = func() time.Time { return day }

	for hand := 1; hand <= 5; hand++ {
		award := progression.HandXP(progression.HandOutcome{Practice: true}, 0)
		award.AwardID = fmt.Sprintf("hand:practice:%s:%d", user, hand)
		_, persisted, _, err := store.AwardXP(ctx, user, "", award)
		if err != nil {
			t.Fatalf("AwardXP(%d) error = %v", hand, err)
		}
		want := progression.PracticeHandXP
		if hand == 5 {
			want = 0
		}
		if persisted.Total != want {
			t.Fatalf("hand %d = %+v, want %d XP", hand, persisted, want)
		}
	}
	today, err := store.PracticeXPToday(ctx, user)
	if err != nil || today != progression.PracticeDailyXPCap {
		t.Fatalf("PracticeXPToday() = %d, %v", today, err)
	}

	day = day.Add(2 * time.Minute)
	award := progression.HandXP(progression.HandOutcome{Practice: true}, 0)
	award.AwardID = "hand:practice:next-day:" + user
	_, persisted, _, err := store.AwardXP(ctx, user, "", award)
	if err != nil || persisted.Total != progression.PracticeHandXP {
		t.Fatalf("next UTC day award = %+v, %v", persisted, err)
	}
}

func TestPostgreSQLStorage_PlayerProgressionNeedsNoRow(t *testing.T) {
	store := progressionStore(t)
	player, err := store.PlayerProgression(
		context.Background(),
		"xp-absent-"+randomSuffix(t),
	)
	if err != nil {
		t.Fatalf("PlayerProgression() error = %v", err)
	}
	if player.Level.Level != progression.StartingLevel || player.LifetimeXP != 0 {
		t.Fatalf("absent player = %+v", player)
	}
}

func TestPostgreSQLStorage_XPAwardsAreAppendOnly(t *testing.T) {
	store := progressionStore(t)
	ctx := context.Background()
	user := "xp-immutable-" + randomSuffix(t)
	id := "hand:immutable:" + user

	if _, _, _, err := store.AwardXP(
		ctx,
		user,
		"",
		testXPAward(id, progression.SourcePublicHand, 100),
	); err != nil {
		t.Fatalf("AwardXP() error = %v", err)
	}

	if _, err := store.pool.Exec(
		ctx,
		`UPDATE xp_awards SET amount = 9999 WHERE award_id = $1`,
		id,
	); err == nil {
		t.Fatal("xp_awards accepted an UPDATE")
	}
	if _, err := store.pool.Exec(
		ctx,
		`DELETE FROM xp_awards WHERE award_id = $1`,
		id,
	); err == nil {
		t.Fatal("xp_awards accepted a DELETE")
	}
}

func TestPostgreSQLStorage_RejectsInvalidXP(t *testing.T) {
	store := progressionStore(t)
	user := "xp-neg-" + randomSuffix(t)
	if _, _, _, err := store.AwardXP(
		context.Background(),
		user,
		"",
		testXPAward("hand:negative:"+user, progression.SourcePublicHand, -50),
	); err == nil {
		t.Fatal("AwardXP() accepted a negative amount")
	}

	mismatched := testXPAward("hand:mismatch:"+user, progression.SourcePublicHand, 50)
	mismatched.Components[0].Amount = 25
	if _, _, _, err := store.AwardXP(
		context.Background(),
		user,
		"",
		mismatched,
	); err == nil {
		t.Fatal("AwardXP() accepted a mismatched component total")
	}
}
