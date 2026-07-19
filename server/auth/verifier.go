package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

var ErrUnauthenticated = errors.New("unauthenticated")

type Principal struct {
	UserID string
}

type Verifier interface {
	Verify(ctx context.Context, accessToken string) (Principal, error)
}

// AGSVerifier validates the bearer token through AGS IAM. The WebSocket
// handler never trusts a user ID supplied by the browser.
type AGSVerifier struct {
	BaseURL    string
	Namespace  string
	HTTPClient *http.Client
}

func (v AGSVerifier) Verify(ctx context.Context, accessToken string) (Principal, error) {
	accessToken = strings.TrimSpace(accessToken)
	if accessToken == "" || v.BaseURL == "" || v.Namespace == "" {
		return Principal{}, ErrUnauthenticated
	}

	client := v.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}

	// This is the same public current-user operation used by
	// UsersApi(sdk).getUsersMe_v3 in the installed AGS TypeScript SDK.
	url := strings.TrimRight(v.BaseURL, "/") + "/iam/v3/public/users/me"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return Principal{}, fmt.Errorf("create AGS user request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := client.Do(req)
	if err != nil {
		return Principal{}, fmt.Errorf("verify AGS user: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return Principal{}, ErrUnauthenticated
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Principal{}, fmt.Errorf("AGS user verification returned HTTP %d", resp.StatusCode)
	}

	var body struct {
		UserID string `json:"userId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return Principal{}, fmt.Errorf("decode AGS user: %w", err)
	}
	if body.UserID == "" {
		return Principal{}, ErrUnauthenticated
	}

	return Principal{UserID: body.UserID}, nil
}
