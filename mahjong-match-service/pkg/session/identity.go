package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// §10.1 account gating, server side.
//
// The client hides Full Rotation from guests, which stops real players in the
// real UI. It does not stop anything that talks to the match service directly,
// and "guests cannot play ranked" is not a claim a client-side check can make:
// the client is the untrusted half. Ranked results feed §12.4 rating, so the
// service decides for itself.
//
// What counts as a guest is taken from the client's own definition rather than
// invented here: an account with no email address is headless (client/iam.ts,
// loginAsGuest). Two things that look like better signals are not:
//
//   - authType is "EMAILPASSWD" on a headless account too, so it separates
//     nothing.
//   - the JWT's jflgs and ipf claims do differ for a device login, but they
//     are undocumented, and ipf describes how *this token* was obtained rather
//     than whether the account has an identity. A guest who upgrades still
//     holds the token they logged in with.
//
// emailVerified is deliberately not required. §10.2's upgrade attaches an
// email and the account stops being a guest at that moment; making ranked play
// wait for a verification mail would gate it behind delivery this namespace is
// known to fail at, and would be a stricter rule than the client's.

var (
	// ErrLinkedAccountRequired is returned when a guest attempts something
	// §10.1 reserves for a durable account.
	ErrLinkedAccountRequired = errors.New("this mode requires a linked account")
	ErrIdentityUnavailable   = errors.New("could not determine whether the caller is a guest")
)

// IdentityResolver reports whether the caller holds a full account.
type IdentityResolver interface {
	// IsGuest reports whether the caller is a headless account. The caller's
	// own access token is read from ctx, so this asks AGS about the caller
	// rather than about a user ID the request supplied.
	IsGuest(ctx context.Context) (bool, error)
}

type accessTokenKey struct{}

// ContextWithAccessToken carries the caller's bearer token for the duration of
// a request. It is read only by IsGuest and never logged: this is the caller's
// credential, and the service holds it exactly long enough to ask AGS who they
// are.
func ContextWithAccessToken(ctx context.Context, token string) context.Context {
	token = strings.TrimSpace(token)
	if token == "" {
		return ctx
	}
	return context.WithValue(ctx, accessTokenKey{}, token)
}

func AccessTokenFromContext(ctx context.Context) (string, bool) {
	token, ok := ctx.Value(accessTokenKey{}).(string)
	return token, ok && token != ""
}

// StaticIdentityResolver is the test and local-development stand-in.
type StaticIdentityResolver struct {
	Guest bool
}

func (r StaticIdentityResolver) IsGuest(context.Context) (bool, error) {
	return r.Guest, nil
}

// AGSIdentityResolver answers from AGS IAM, using the same endpoint and the
// same field the client reads.
type AGSIdentityResolver struct {
	BaseURL string
	Client  *http.Client

	// full caches accounts already known to hold an identity. The cache is
	// deliberately one-directional: an account can gain an email and stop being
	// a guest, but never the reverse, so a cached "full" cannot go stale in a
	// way that wrongly admits anyone. Guests are re-checked every time, which
	// is what makes an upgrade take effect immediately rather than at the end
	// of some cache window.
	mu   sync.RWMutex
	full map[string]time.Time
}

const identityCacheTTL = 30 * time.Minute

func (r *AGSIdentityResolver) cached(userID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	seen, ok := r.full[userID]
	return ok && time.Since(seen) < identityCacheTTL
}

func (r *AGSIdentityResolver) remember(userID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.full == nil {
		r.full = map[string]time.Time{}
	}
	r.full[userID] = time.Now()
}

// IsGuest asks AGS IAM for the caller's own profile.
//
// It never guesses on failure. A network error or an unexpected status returns
// ErrIdentityUnavailable, and the caller decides — refusing entry to a ranked
// match is the safe direction, and silently admitting everyone when IAM is
// unreachable would make the gate worthless exactly when it is being tested.
func (r *AGSIdentityResolver) IsGuest(ctx context.Context) (bool, error) {
	token, ok := AccessTokenFromContext(ctx)
	if !ok {
		return false, fmt.Errorf("%w: no caller token on the request", ErrIdentityUnavailable)
	}
	if strings.TrimSpace(r.BaseURL) == "" {
		return false, fmt.Errorf("%w: AGS base URL is not configured", ErrIdentityUnavailable)
	}

	client := r.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodGet, strings.TrimRight(r.BaseURL, "/")+"/iam/v3/public/users/me", nil,
	)
	if err != nil {
		return false, fmt.Errorf("%w: %v", ErrIdentityUnavailable, err)
	}
	request.Header.Set("Authorization", "Bearer "+token)

	response, err := client.Do(request)
	if err != nil {
		return false, fmt.Errorf("%w: %v", ErrIdentityUnavailable, err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return false, fmt.Errorf("%w: AGS IAM returned %d", ErrIdentityUnavailable, response.StatusCode)
	}

	var profile struct {
		UserID       string `json:"userId"`
		EmailAddress string `json:"emailAddress"`
	}
	if err := json.NewDecoder(response.Body).Decode(&profile); err != nil {
		return false, fmt.Errorf("%w: %v", ErrIdentityUnavailable, err)
	}

	guest := strings.TrimSpace(profile.EmailAddress) == ""
	if !guest && profile.UserID != "" {
		r.remember(profile.UserID)
	}
	return guest, nil
}

// IsGuestCached is IsGuest with the one-directional cache applied. userID is
// the already-authenticated caller from the token subject, not anything the
// request body supplied.
func (r *AGSIdentityResolver) IsGuestCached(ctx context.Context, userID string) (bool, error) {
	if userID != "" && r.cached(userID) {
		return false, nil
	}
	return r.IsGuest(ctx)
}
