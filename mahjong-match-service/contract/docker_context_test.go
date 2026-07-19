package contract_test

import (
	"os"
	"strings"
	"testing"
)

func TestDockerContextExcludesLocalEnvironmentFiles(t *testing.T) {
	content, err := os.ReadFile("../.dockerignore")
	if err != nil {
		t.Fatalf("ReadFile(.dockerignore) error = %v", err)
	}
	rules := strings.Fields(string(content))
	required := map[string]bool{
		".env":   false,
		".env.*": false,
	}
	for _, rule := range rules {
		if _, ok := required[rule]; ok {
			required[rule] = true
		}
	}
	for rule, found := range required {
		if !found {
			t.Errorf(".dockerignore is missing %q", rule)
		}
	}
}
