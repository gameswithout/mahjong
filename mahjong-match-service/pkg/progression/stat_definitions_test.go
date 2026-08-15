package progression

import (
	"os"
	"strings"
	"testing"
)

// A stat code with no definition in the namespace is a silent no-op: the
// bulk update returns success and the value is thrown away. The screen then
// shows a permanent zero, which is indistinguishable from a player who has
// never done the thing.
//
// So the provisioning script is checked against the codes this package
// actually writes. Adding a statistic without adding its definition is the
// easy mistake, and it is invisible until someone looks at production and
// wonders why one number never moves.
const statDefinitionScript = "../../../scripts/create-stat-definitions.sh"

func TestProvisioningScriptCoversEveryStatCodeWeWrite(t *testing.T) {
	script, err := os.ReadFile(statDefinitionScript)
	if err != nil {
		t.Fatalf("read %s: %v", statDefinitionScript, err)
	}
	body := string(script)

	written := map[string]string{}
	for _, code := range DashboardStatCodes() {
		written[code] = "dashboard"
	}
	for _, code := range patternStatCodes {
		written[code] = "pattern win"
	}

	var missing []string
	for code, source := range written {
		// Matched with surrounding whitespace so a code cannot be considered
		// covered by being a prefix of a longer one — public-hands-ting
		// against public-hands-ting-at-draw is exactly that trap.
		if !strings.Contains(body, "create "+code+" ") && !strings.Contains(body, "create "+code+"\t") {
			missing = append(missing, code+" ("+source+")")
		}
	}
	if len(missing) > 0 {
		t.Fatalf(
			"these stat codes are written by the service but never defined in %s:\n  %s",
			statDefinitionScript, strings.Join(missing, "\n  "),
		)
	}
}

// The reverse direction: a definition nothing writes is harmless in
// production but is usually a rename that left its old name behind, so it is
// worth surfacing rather than accumulating.
func TestProvisioningScriptDefinesNothingUnused(t *testing.T) {
	script, err := os.ReadFile(statDefinitionScript)
	if err != nil {
		t.Fatalf("read %s: %v", statDefinitionScript, err)
	}

	written := map[string]bool{}
	for _, code := range DashboardStatCodes() {
		written[code] = true
	}
	for _, code := range patternStatCodes {
		written[code] = true
	}

	var orphaned []string
	for _, line := range strings.Split(string(script), "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "create ") {
			continue
		}
		fields := strings.Fields(trimmed)
		if len(fields) < 2 {
			continue
		}
		if code := fields[1]; !written[code] {
			orphaned = append(orphaned, code)
		}
	}
	if len(orphaned) > 0 {
		t.Errorf(
			"%s defines stat codes nothing writes: %s",
			statDefinitionScript, strings.Join(orphaned, ", "),
		)
	}
}
