package bots

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"testing"
)

// TestPersonaStrengthSuite is §9.3's strength gate: style should create
// matchups, but no persona may be the secretly correct choice at every
// table, and none may be so weak that choosing it is a self-inflicted
// handicap the card never mentions.
//
// It follows TestCalibrationSuite's shape. By default it plays a handful of
// hands purely to prove the harness runs; set MAHJONG_PERSONA_HANDS to
// switch it into asserting the real band and failing when a persona is out
// of it. See scripts/run-persona-strength.sh.
//
// Hands are slow here — every seat runs the full persona evaluator, so this
// is several times the cost of the difficulty-only calibration and cannot
// run on every commit.
func TestPersonaStrengthSuite(t *testing.T) {
	hands := 8
	gate := false
	if raw := os.Getenv("MAHJONG_PERSONA_HANDS"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			t.Fatalf("MAHJONG_PERSONA_HANDS=%q: %v", raw, err)
		}
		hands = parsed
		gate = true
	}
	baseSeed := uint64(20260814)
	if raw := os.Getenv("MAHJONG_PERSONA_SEED"); raw != "" {
		parsed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			t.Fatalf("MAHJONG_PERSONA_SEED=%q: %v", raw, err)
		}
		baseSeed = parsed
	}
	difficulty := Medium
	if raw := strings.TrimSpace(os.Getenv("MAHJONG_PERSONA_DIFFICULTY")); raw != "" {
		difficulty = Difficulty(raw)
	}

	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	ids := roster.IDs()
	if !gate {
		// The smoke run only proves the harness plays hands and tallies
		// them. Two personas is enough for that and keeps the default suite
		// from doubling in length.
		ids = []string{DefaultPersonaID, "stone-lion"}
	}

	reports := make([]PersonaStrengthReport, 0, len(ids))
	var failures []string
	for _, id := range ids {
		persona, _ := roster.ByID(id)
		report, err := RunPersonaStrength(persona, difficulty, hands, baseSeed)
		if err != nil {
			t.Fatalf("%s: RunPersonaStrength() error = %v", id, err)
		}
		reports = append(reports, report)
		margin := wilsonMargin(report.FirstPlaceRate, report.DecidedHands)
		t.Logf("%-14s first=%.4f ±%.4f  decided=%d draws=%d  avgWinTai=%.2f  dealIn=%.4f  taiPaid=%.2f",
			id, report.FirstPlaceRate, margin, report.DecidedHands, report.ExhaustiveDraws,
			report.AverageWinningTai, report.DealInRate, report.AverageTaiPaid)
		if !gate || id == DefaultPersonaID {
			continue
		}
		// §9.3: population first-place rate within ±4 percentage points of
		// the reference. With one persona against three references, the
		// reference's own expectation is an even quarter of decided hands.
		const neutral, band = 0.25, 0.04
		if math.Abs(report.FirstPlaceRate-neutral) > band {
			failures = append(failures, fmt.Sprintf(
				"%s: first-place rate = %.4f ±%.4f, want within %.2f of %.2f",
				id, report.FirstPlaceRate, margin, band, neutral))
		}
	}

	if path := os.Getenv("MAHJONG_PERSONA_REPORT"); path != "" {
		writePersonaStrengthReport(t, path, reports)
	}
	if !gate {
		t.Logf("smoke run (%d hands/persona) — not a meaningful band check; set MAHJONG_PERSONA_HANDS for the real gate", hands)
		return
	}
	if len(failures) > 0 {
		t.Fatalf("persona strength out of band (§9.3):\n%s", strings.Join(failures, "\n"))
	}
}

// wilsonMargin is half the width of a 95% Wilson score interval, which
// behaves sensibly at the small samples a smoke run produces where the
// normal approximation does not. Reporting a rate without it invites
// reading noise as a finding.
func wilsonMargin(rate float64, n int) float64 {
	if n == 0 {
		return 0
	}
	const z = 1.96
	denominator := 1 + z*z/float64(n)
	spread := z * math.Sqrt(rate*(1-rate)/float64(n)+z*z/(4*float64(n)*float64(n)))
	return spread / denominator
}

func writePersonaStrengthReport(t *testing.T, path string, reports []PersonaStrengthReport) {
	t.Helper()
	encoded, err := json.MarshalIndent(reports, "", "  ")
	if err != nil {
		t.Fatalf("marshal persona strength report: %v", err)
	}
	if err := os.WriteFile(path, append(encoded, '\n'), 0o644); err != nil {
		t.Fatalf("write persona strength report %q: %v", path, err)
	}
	t.Logf("persona strength report written to %s", path)
}

func TestRunPersonaStrengthRejectsAnEmptyRun(t *testing.T) {
	roster, err := Personas()
	if err != nil {
		t.Fatalf("Personas() error = %v", err)
	}
	if _, err := RunPersonaStrength(roster.Default(), Medium, 0, 1); err == nil {
		t.Fatal("RunPersonaStrength(0 hands) error = nil, want a rejection")
	}
}
