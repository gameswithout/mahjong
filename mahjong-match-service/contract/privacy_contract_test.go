package contract_test

import (
	"os"
	"strings"
	"testing"
)

func TestServerLoggingDoesNotEnablePayloadEvents(t *testing.T) {
	content, err := os.ReadFile("../main.go")
	if err != nil {
		t.Fatalf("ReadFile(main.go) error = %v", err)
	}
	source := string(content)
	for _, forbidden := range []string{"logging.PayloadReceived", "logging.PayloadSent"} {
		if strings.Contains(source, forbidden) {
			t.Errorf("main.go enables private payload logging through %s", forbidden)
		}
	}
}
