package economy

import (
	"testing"

	"github.com/AccelByte/accelbyte-go-sdk/platform-sdk/pkg/platformclientmodels"
)

func TestJadeWalletRequestsUseLiveAGSSystemOrigin(t *testing.T) {
	t.Parallel()

	const amount int64 = 23
	credit := jadeCreditRequest(amount)
	debit := jadeDebitRequest(amount)

	if credit.Origin != "System" {
		t.Fatalf("credit origin = %q, want %q", credit.Origin, "System")
	}
	if credit.Origin == platformclientmodels.CreditRequestOriginSYSTEM {
		t.Fatal("credit origin regressed to the generated SDK's server-rejected uppercase value")
	}
	if credit.Amount == nil || *credit.Amount != amount {
		t.Fatalf("credit amount = %v, want %d", credit.Amount, amount)
	}

	if debit.BalanceOrigin != "System" {
		t.Fatalf("debit balance origin = %q, want %q", debit.BalanceOrigin, "System")
	}
	if debit.BalanceOrigin == platformclientmodels.DebitByCurrencyCodeRequestBalanceOriginSYSTEM {
		t.Fatal("debit balance origin regressed to the generated SDK's server-rejected uppercase value")
	}
	if debit.Amount == nil || *debit.Amount != amount {
		t.Fatalf("debit amount = %v, want %d", debit.Amount, amount)
	}
}
