//go:build integration

package storage

import (
	"context"
	"os"
	"testing"

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

func TestPostgreSQLStorage_AwardXPIsIdempotentPerAwardID(t *testing.T) {
	store := progressionStore(t)
	ctx := context.Background()
	user := "xp-" + randomSuffix(t)

	first, applied, err := store.AwardXP(ctx, "hand:r1:"+user, user, "", progression.SourcePublicHand, 175)
	if err != nil {
		t.Fatalf("AwardXP() error = %v", err)
	}
	if !applied || first.LifetimeXP != 175 {
		t.Fatalf("first award: applied=%v player=%+v", applied, first)
	}

	// The projection poll repeats a finished hand for the rest of the session.
	for range 5 {
		repeat, repeatApplied, err := store.AwardXP(
			ctx, "hand:r1:"+user, user, "", progression.SourcePublicHand, 175)
		if err != nil {
			t.Fatalf("repeat AwardXP() error = %v", err)
		}
		if repeatApplied {
			t.Fatal("repeat award reported as applied")
		}
		if repeat.LifetimeXP != 175 {
			t.Fatalf("repeat moved XP to %d", repeat.LifetimeXP)
		}
	}

	// A different hand is a different award.
	second, applied, err := store.AwardXP(ctx, "hand:r2:"+user, user, "", progression.SourcePublicHand, 100)
	if err != nil || !applied {
		t.Fatalf("second hand: applied=%v err=%v", applied, err)
	}
	if second.LifetimeXP != 275 {
		t.Fatalf("lifetime XP = %d, want 275", second.LifetimeXP)
	}
}

func TestPostgreSQLStorage_LevelIsDerivedFromLifetimeXP(t *testing.T) {
	store := progressionStore(t)
	ctx := context.Background()
	user := "xp-level-" + randomSuffix(t)

	// 500 XP is exactly level 2 on the §12.2 curve.
	player, _, err := store.AwardXP(ctx, "onboarding:"+user, user, "", progression.SourceOnboarding, 500)
	if err != nil {
		t.Fatalf("AwardXP() error = %v", err)
	}
	if player.Level.Level != 2 || player.Level.XPForNextLevel != 600 {
		t.Fatalf("player = %+v, want level 2 needing 600", player)
	}
	if len(player.Earned) != 1 || player.Earned[0].Name != "Student" {
		t.Fatalf("earned = %+v, want the level 2 title", player.Earned)
	}
	if player.Next == nil || player.Next.Level != 5 {
		t.Fatalf("next = %+v, want the level 5 theme", player.Next)
	}
}

func TestPostgreSQLStorage_PracticeXPTodayFeedsTheDailyCap(t *testing.T) {
	store := progressionStore(t)
	ctx := context.Background()
	user := "xp-practice-" + randomSuffix(t)

	if today, err := store.PracticeXPToday(ctx, user); err != nil || today != 0 {
		t.Fatalf("new account practice XP = %d, err = %v", today, err)
	}

	for hand := range 3 {
		if _, _, err := store.AwardXP(
			ctx, "hand:practice-"+string(rune('a'+hand))+":"+user, user, "",
			progression.SourcePractice, progression.PracticeHandXP,
		); err != nil {
			t.Fatalf("AwardXP() error = %v", err)
		}
	}

	today, err := store.PracticeXPToday(ctx, user)
	if err != nil {
		t.Fatalf("PracticeXPToday() error = %v", err)
	}
	if today != 75 {
		t.Fatalf("practice XP today = %d, want 75", today)
	}

	// Public XP must not count toward the Practice cap.
	if _, _, err := store.AwardXP(
		ctx, "hand:public:"+user, user, "", progression.SourcePublicHand, 175,
	); err != nil {
		t.Fatalf("AwardXP() error = %v", err)
	}
	if today, _ := store.PracticeXPToday(ctx, user); today != 75 {
		t.Fatalf("public XP leaked into the Practice cap: %d", today)
	}
}

func TestPostgreSQLStorage_ZeroAwardStillMarksTheHandPriced(t *testing.T) {
	store := progressionStore(t)
	ctx := context.Background()
	user := "xp-zero-" + randomSuffix(t)

	// A Practice hand played after the daily cap is worth zero, but must still
	// record that it was priced — otherwise it is re-evaluated forever.
	player, applied, err := store.AwardXP(
		ctx, "hand:capped:"+user, user, "", progression.SourcePractice, 0)
	if err != nil || !applied {
		t.Fatalf("zero award: applied=%v err=%v", applied, err)
	}
	if player.LifetimeXP != 0 {
		t.Fatalf("zero award moved XP to %d", player.LifetimeXP)
	}
	if _, repeatApplied, _ := store.AwardXP(
		ctx, "hand:capped:"+user, user, "", progression.SourcePractice, 0); repeatApplied {
		t.Fatal("zero award was not recorded, so the hand would be priced again")
	}
}

func TestPostgreSQLStorage_PlayerProgressionNeedsNoRow(t *testing.T) {
	store := progressionStore(t)
	// A player who has never earned XP is level 1, not an error and not a write.
	player, err := store.PlayerProgression(context.Background(), "xp-absent-"+randomSuffix(t))
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

	if _, _, err := store.AwardXP(
		ctx, "hand:immutable:"+user, user, "", progression.SourcePublicHand, 100,
	); err != nil {
		t.Fatalf("AwardXP() error = %v", err)
	}

	// An award that can be edited is not an audit record.
	if _, err := store.pool.Exec(ctx,
		`UPDATE xp_awards SET amount = 9999 WHERE award_id = $1`, "hand:immutable:"+user,
	); err == nil {
		t.Fatal("xp_awards accepted an UPDATE")
	}
	if _, err := store.pool.Exec(ctx,
		`DELETE FROM xp_awards WHERE award_id = $1`, "hand:immutable:"+user,
	); err == nil {
		t.Fatal("xp_awards accepted a DELETE")
	}
}

func TestPostgreSQLStorage_RejectsNegativeXP(t *testing.T) {
	store := progressionStore(t)
	// §12.2 never revokes. A negative award is a programming error.
	if _, _, err := store.AwardXP(
		context.Background(), "hand:negative", "xp-neg-"+randomSuffix(t), "",
		progression.SourcePublicHand, -50,
	); err == nil {
		t.Fatal("AwardXP() accepted a negative amount")
	}
}
