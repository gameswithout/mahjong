package session

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func resolverFor(t *testing.T, handler http.HandlerFunc) *AGSIdentityResolver {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return &AGSIdentityResolver{BaseURL: server.URL, Client: server.Client()}
}

func withToken(token string) context.Context {
	return ContextWithAccessToken(context.Background(), token)
}

func TestGuestIsAnAccountWithNoEmail(t *testing.T) {
	// The definition is taken from the client (client/iam.ts, loginAsGuest)
	// rather than invented, so the two halves of the gate cannot disagree
	// about who is a guest.
	resolver := resolverFor(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"userId":"u1","emailAddress":""}`))
	})
	guest, err := resolver.IsGuest(withToken("t"))
	if err != nil || !guest {
		t.Fatalf("empty email should be a guest: guest=%v err=%v", guest, err)
	}
}

func TestAnAccountWithAnEmailIsNotAGuest(t *testing.T) {
	resolver := resolverFor(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"userId":"u1","emailAddress":"player@example.com"}`))
	})
	guest, err := resolver.IsGuest(withToken("t"))
	if err != nil || guest {
		t.Fatalf("an account with an email is not a guest: guest=%v err=%v", guest, err)
	}
}

func TestUnverifiedEmailStillCountsAsLinked(t *testing.T) {
	// §10.2's upgrade attaches an email and the account stops being a guest at
	// that moment. Requiring emailVerified would gate ranked play behind mail
	// delivery this namespace is known to fail at, and would be stricter than
	// the client's own rule.
	resolver := resolverFor(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"userId":"u1","emailAddress":"player@example.com","emailVerified":false}`))
	})
	guest, err := resolver.IsGuest(withToken("t"))
	if err != nil || guest {
		t.Fatalf("an unverified email is still a linked account: guest=%v err=%v", guest, err)
	}
}

func TestWhitespaceEmailIsAGuest(t *testing.T) {
	// A field of spaces is not an identity; treating it as one would admit a
	// guest to ranked play on a formatting artifact.
	resolver := resolverFor(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"userId":"u1","emailAddress":"   "}`))
	})
	guest, err := resolver.IsGuest(withToken("t"))
	if err != nil || !guest {
		t.Fatalf("a whitespace email should be a guest: guest=%v err=%v", guest, err)
	}
}

func TestItAsksAboutTheCallerNotAboutAUserID(t *testing.T) {
	// The request must carry the caller's own bearer token and name no user.
	// Looking a user up by an ID from the request body would let a caller ask
	// about somebody else's account.
	var sawAuth, sawPath string
	resolver := resolverFor(t, func(w http.ResponseWriter, r *http.Request) {
		sawAuth = r.Header.Get("Authorization")
		sawPath = r.URL.Path
		_, _ = w.Write([]byte(`{"userId":"u1","emailAddress":"a@b.c"}`))
	})
	if _, err := resolver.IsGuest(withToken("caller-token")); err != nil {
		t.Fatalf("IsGuest: %v", err)
	}
	if sawAuth != "Bearer caller-token" {
		t.Fatalf("authorization header = %q", sawAuth)
	}
	if sawPath != "/iam/v3/public/users/me" {
		t.Fatalf("path = %q, want the caller's own profile", sawPath)
	}
}

func TestUnreachableIAMRefusesRatherThanGuesses(t *testing.T) {
	// Admitting everyone whenever IAM is unreachable would make the gate
	// absent exactly when something is wrong. The caller decides what to do;
	// this only refuses to answer.
	resolver := resolverFor(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	if _, err := resolver.IsGuest(withToken("t")); !errors.Is(err, ErrIdentityUnavailable) {
		t.Fatalf("error = %v, want ErrIdentityUnavailable", err)
	}
}

func TestAnUnauthorizedTokenIsNotTreatedAsAFullAccount(t *testing.T) {
	// A 401 means the answer is unknown, not "not a guest". Mapping it to
	// "full" would turn an expired token into a way past the gate.
	resolver := resolverFor(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
	guest, err := resolver.IsGuest(withToken("t"))
	if !errors.Is(err, ErrIdentityUnavailable) {
		t.Fatalf("error = %v, want ErrIdentityUnavailable", err)
	}
	if guest {
		t.Fatal("a failed lookup must not report a definite answer either way")
	}
}

func TestMissingTokenIsRefused(t *testing.T) {
	resolver := resolverFor(t, func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("IAM must not be called without a caller token")
	})
	if _, err := resolver.IsGuest(context.Background()); !errors.Is(err, ErrIdentityUnavailable) {
		t.Fatalf("error = %v, want ErrIdentityUnavailable", err)
	}
}

func TestMalformedProfileIsRefused(t *testing.T) {
	resolver := resolverFor(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`not json`))
	})
	if _, err := resolver.IsGuest(withToken("t")); !errors.Is(err, ErrIdentityUnavailable) {
		t.Fatalf("error = %v, want ErrIdentityUnavailable", err)
	}
}

func TestFullAccountsAreCachedButGuestsAreNot(t *testing.T) {
	// The cache is one-directional on purpose: an account can gain an email
	// and stop being a guest, never the reverse. Caching "guest" would make an
	// upgrade take effect only after the cache expired.
	calls := 0
	resolver := resolverFor(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			_, _ = w.Write([]byte(`{"userId":"u1","emailAddress":"a@b.c"}`))
			return
		}
		_, _ = w.Write([]byte(`{"userId":"u2","emailAddress":""}`))
	})

	if guest, err := resolver.IsGuestCached(withToken("t"), "u1"); err != nil || guest {
		t.Fatalf("first lookup: guest=%v err=%v", guest, err)
	}
	if guest, err := resolver.IsGuestCached(withToken("t"), "u1"); err != nil || guest {
		t.Fatalf("cached lookup: guest=%v err=%v", guest, err)
	}
	if calls != 1 {
		t.Fatalf("IAM called %d times for a known full account, want 1", calls)
	}

	// A guest is asked about every time.
	for range 3 {
		if guest, err := resolver.IsGuestCached(withToken("t"), "u2"); err != nil || !guest {
			t.Fatalf("guest lookup: guest=%v err=%v", guest, err)
		}
	}
	if calls != 4 {
		t.Fatalf("IAM called %d times overall, want 4 — guests must not be cached", calls)
	}
}

func TestAccessTokenIsNotCarriedWhenBlank(t *testing.T) {
	ctx := ContextWithAccessToken(context.Background(), "   ")
	if _, ok := AccessTokenFromContext(ctx); ok {
		t.Fatal("a blank token must not be treated as present")
	}
}
