package match

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/session"
	"github.com/gameswithout/mahjong/mahjong-match-service/pkg/storage"
	"github.com/gameswithout/mahjong/rulesengine"
)

// §10.1 gates ranked play on a linked account. The client hides the entry from
// guests, but the client is the untrusted half — anything speaking to the
// service directly bypasses it, and a ranked result feeds §12.4 rating.

type refusingIdentities struct {
	err error
}

func (r refusingIdentities) IsGuest(context.Context) (bool, error) { return false, r.err }

func rotationRuntimeWithIdentity(
	t *testing.T,
	players []string,
	identities session.IdentityResolver,
) (*Runtime, storage.MatchKey) {
	t.Helper()
	runtime := NewRuntime(
		session.StaticResolver{Members: players, SessionMode: session.ModeFullRotation},
		&fakeMatchRepository{},
		rulesengine.NewMemoryEventStore(),
		func() time.Time { return time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC) },
	)
	runtime.SetIdentities(identities)
	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "gate-session",
		MatchID:   "gate-match",
	}
	return runtime, key
}

func TestGuestCannotEnterAFullRotation(t *testing.T) {
	runtime, key := rotationRuntimeWithIdentity(
		t, []string{"a", "b", "c", "d"}, session.StaticIdentityResolver{Guest: true},
	)
	_, err := runtime.Join(context.Background(), key, "a")
	if !errors.Is(err, session.ErrLinkedAccountRequired) {
		t.Fatalf("Join() error = %v, want ErrLinkedAccountRequired", err)
	}
}

func TestUnknownIdentityRefusesRatherThanAdmits(t *testing.T) {
	// If the gate let everyone through whenever AGS IAM was unreachable, it
	// would be absent exactly when something is wrong.
	runtime, key := rotationRuntimeWithIdentity(
		t, []string{"a", "b", "c", "d"},
		refusingIdentities{err: session.ErrIdentityUnavailable},
	)
	_, err := runtime.Join(context.Background(), key, "a")
	if !errors.Is(err, session.ErrIdentityUnavailable) {
		t.Fatalf("Join() error = %v, want ErrIdentityUnavailable", err)
	}
}

func TestMissingIdentityResolverRefusesRankedEntry(t *testing.T) {
	// A deployment that forgot to configure the check must not silently run
	// ranked play ungated.
	runtime := NewRuntime(
		session.StaticResolver{
			Members:     []string{"a", "b", "c", "d"},
			SessionMode: session.ModeFullRotation,
		},
		&fakeMatchRepository{},
		rulesengine.NewMemoryEventStore(),
		time.Now,
	)
	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "ungated-session",
		MatchID:   "ungated-match",
	}
	_, err := runtime.Join(context.Background(), key, "a")
	if !errors.Is(err, session.ErrLinkedAccountRequired) {
		t.Fatalf("Join() error = %v, want the gate to refuse when unconfigured", err)
	}
}

func TestQuickPlayIsNotGated(t *testing.T) {
	// §10.1 gates ranked play, not all play. A guest must still be able to
	// take a Quick Play seat, which is the mode the guest experience exists
	// for in the first place.
	players := []string{"a", "b", "c", "d"}
	runtime := NewRuntime(
		session.StaticResolver{Members: players},
		&fakeMatchRepository{},
		rulesengine.NewMemoryEventStore(),
		time.Now,
	)
	runtime.SetIdentities(session.StaticIdentityResolver{Guest: true})
	key := storage.MatchKey{
		Namespace: "gameswithout-mahjong",
		SessionID: "quickplay-session",
		MatchID:   "quickplay-match",
	}
	view, err := runtime.Join(context.Background(), key, "a")
	if err != nil {
		t.Fatalf("a guest must still be able to play Quick Play: %v", err)
	}
	if view.Rotation != nil {
		t.Fatal("Quick Play produced a rotation")
	}
}

func TestLinkedAccountIsAdmittedToARotation(t *testing.T) {
	runtime, key := rotationRuntimeWithIdentity(
		t, []string{"a", "b", "c", "d"}, session.StaticIdentityResolver{Guest: false},
	)
	// No rotation storage is configured, so entry gets past the gate and fails
	// on storage instead. That is the assertion: the gate is not what stops it.
	_, err := runtime.Join(context.Background(), key, "a")
	if errors.Is(err, session.ErrLinkedAccountRequired) {
		t.Fatal("a linked account was refused by the §10.1 gate")
	}
}
