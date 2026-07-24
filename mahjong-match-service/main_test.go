package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestPostgresDSN_EncodesCredentialsAndTLSOptions(t *testing.T) {
	dsn := postgresDSN(
		"database.internal:5432",
		"mahjong-user",
		"p@ss:/?# word",
		"mahjong_match",
		"/certs/aurora root.pem",
	)
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("url.Parse() error = %v", err)
	}
	if got := parsed.User.Username(); got != "mahjong-user" {
		t.Fatalf("username = %q", got)
	}
	if got, _ := parsed.User.Password(); got != "p@ss:/?# word" {
		t.Fatalf("password did not round trip")
	}
	if parsed.Host != "database.internal:5432" || parsed.Path != "/mahjong_match" {
		t.Fatalf("address = %s%s", parsed.Host, parsed.Path)
	}
	if parsed.Query().Get("sslmode") != "verify-full" ||
		parsed.Query().Get("sslrootcert") != "/certs/aurora root.pem" {
		t.Fatalf("TLS query = %v", parsed.Query())
	}
}

func TestPostgresDSN_LocalConnectionDoesNotForceTLS(t *testing.T) {
	dsn := postgresDSN(
		"127.0.0.1:5432",
		"postgres",
		"postgres",
		"mahjong_match",
		"",
	)
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("url.Parse() error = %v", err)
	}
	if parsed.Query().Has("sslmode") || parsed.Query().Has("sslrootcert") {
		t.Fatalf("local TLS query = %v, want empty", parsed.Query())
	}
}

func TestCorsMiddleware_AnswersPreflightWithoutReachingTheHandler(t *testing.T) {
	called := false
	handler := corsMiddleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))

	request := httptest.NewRequest(http.MethodOptions, "/v1/namespaces/ns/sessions/s/matches/m/join", nil)
	request.Header.Set("Origin", "https://gameswithout.github.io")
	request.Header.Set("Access-Control-Request-Method", "POST")
	request.Header.Set("Access-Control-Request-Headers", "authorization,content-type")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if called {
		t.Fatal("preflight request reached the wrapped handler")
	}
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Headers"); got != "Authorization, Content-Type" {
		t.Fatalf("Access-Control-Allow-Headers = %q", got)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Methods"); got != "GET, POST, DELETE, OPTIONS" {
		t.Fatalf("Access-Control-Allow-Methods = %q", got)
	}
}

func TestCorsMiddleware_AddsOriginHeaderToRealRequests(t *testing.T) {
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	request := httptest.NewRequest(http.MethodPost, "/v1/namespaces/ns/sessions/s/matches/m/join", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
}
