package main

import (
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
