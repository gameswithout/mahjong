package storage

import "testing"

func TestWalletSyncErrorCode(t *testing.T) {
	tests := map[string]string{
		"": "",
		"query AGS Jade wallet: unexpected status 403":         "forbidden",
		"query AGS Jade wallet: unauthenticated":               "unauthorized",
		"query AGS Jade wallet: context deadline exceeded":     "timeout",
		"query AGS Jade wallet: upstream failure":              "query_failed",
		"credit AGS Jade wallet: upstream failure":             "credit_failed",
		"debit AGS Jade wallet: upstream failure":              "debit_failed",
		"AGS Jade wallet verification mismatch for user 123":   "balance_mismatch",
		"credit AGS Jade wallet: currency was not found (404)": "not_found",
		"something unexpected":                                 "unknown",
	}
	for message, want := range tests {
		t.Run(want+"/"+message, func(t *testing.T) {
			if got := walletSyncErrorCode(message); got != want {
				t.Fatalf("walletSyncErrorCode(%q) = %q, want %q", message, got, want)
			}
		})
	}
}
