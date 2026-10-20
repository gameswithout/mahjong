//go:build integration

package storage

import (
	"context"
	"testing"
	"time"

	"github.com/gameswithout/mahjong/rulesengine"
)

func TestPlayerJourneyCountsOnlyNaturalCompletedRotations(t *testing.T) {
	store := progressionStore(t)
	ctx := context.Background()
	user := "journey-" + randomSuffix(t)
	first := time.Date(2020, 7, 1, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name        string
		complete    bool
		reason      string
		participant string
	}{
		{"ranked", true, string(rulesengine.RotationCompletedRound), user},
		{"bots", true, string(rulesengine.RotationCompletedRound), user},
		{"time-limited", true, string(rulesengine.RotationCompletedTimeLimit), user},
		{"unfinished", false, "", user},
		{"other-player", true, string(rulesengine.RotationCompletedRound), user + "-other"},
	} {
		key := MatchKey{Namespace: "journey-test", SessionID: user, MatchID: tc.name}
		rotation, _, err := store.EnsureRotation(ctx, key, []string{tc.participant, user + "-bot-1", user + "-bot-2", user + "-bot-3"}, first.Add(-time.Hour))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = store.pool.Exec(ctx, "DELETE FROM matches WHERE runtime_id = $1", rotation.RuntimeID) })
		if tc.complete {
			_, err = store.pool.Exec(ctx, `UPDATE rotation_matches SET complete = TRUE, completed_at = $2, state = jsonb_set(state, '{completion_reason}', to_jsonb($3::text)) WHERE runtime_id = $1`, rotation.RuntimeID, first, tc.reason)
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	for range 3 {
		got, err := store.PlayerJourney(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		if got.CompletedRotations != 2 || got.FirstCompletedAt != first.Format(time.RFC3339) {
			t.Fatalf("journey = %+v", got)
		}
	}
	empty, err := store.PlayerJourney(ctx, user+"-new")
	if err != nil {
		t.Fatal(err)
	}
	if empty.CompletedRotations != 0 || empty.FirstCompletedAt != "" || len(empty.Anniversaries) != 0 {
		t.Fatalf("empty = %+v", empty)
	}
}
