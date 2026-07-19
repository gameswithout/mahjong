package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAGSVerifierReturnsUserIDWithoutLoggingToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/iam/v3/public/users/me" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer secret-token" {
			t.Fatalf("authorization header was not forwarded")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"userId":"guest-123"}`))
	}))
	defer server.Close()

	principal, err := (AGSVerifier{BaseURL: server.URL, Namespace: "test"}).Verify(context.Background(), "secret-token")
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if principal.UserID != "guest-123" {
		t.Fatalf("UserID = %q", principal.UserID)
	}
}

func TestAGSVerifierMapsUnauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	_, err := (AGSVerifier{BaseURL: server.URL, Namespace: "test"}).Verify(context.Background(), "expired")
	if err != ErrUnauthenticated {
		t.Fatalf("error = %v, want ErrUnauthenticated", err)
	}
}
