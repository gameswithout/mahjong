package bots

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"
)

// TestCalibrationSuite runs the §11.4 placement-band calibration for all
// three pairings (Easy-vs-3-Medium, Medium mirror, Hard-vs-3-Medium) and
// logs a report for each.
//
// The default run (40 hands/pairing) is a fast sanity smoke test only —
// it exercises the harness end to end and prints real measured rates, but
// at that sample size §11.4's bands (as narrow as 6-8 percentage points)
// are well within sampling noise, so this does not assert them. The actual
// release gate is opt-in: set MAHJONG_CALIBRATION_HANDS (any value) to
// switch this test into asserting the real bands and failing when a
// pairing is out of band, per §11.4/E3.F4 ("out-of-band fails release").
// See scripts/run-calibration.sh for the full 10,000-hand run the spec
// requires ("at least 10,000 same-seed seat-rotated simulations") — with
// Hard in the mix, that takes on the order of an hour even parallelized
// across cores, so it is not run by default the way this smoke test is.
func TestCalibrationSuite(t *testing.T) {
	hands := 16
	gate := false
	if raw := os.Getenv("MAHJONG_CALIBRATION_HANDS"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			t.Fatalf("MAHJONG_CALIBRATION_HANDS=%q: %v", raw, err)
		}
		hands = parsed
		gate = true
	}
	baseSeed := uint64(20260719)
	if raw := os.Getenv("MAHJONG_CALIBRATION_SEED"); raw != "" {
		parsed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			t.Fatalf("MAHJONG_CALIBRATION_SEED=%q: %v", raw, err)
		}
		baseSeed = parsed
	}

	type check struct {
		name     string
		rate     float64
		min, max float64
	}
	pairings := []struct {
		spec   PairingSpec
		checks func(CalibrationReport) []check
	}{
		{PairingEasyVsMedium, func(r CalibrationReport) []check {
			return []check{{"easy_first_place_rate", r.SpecialRate, 0.10, 0.18}}
		}},
		{PairingMediumMirror, func(r CalibrationReport) []check {
			checks := make([]check, 0, len(seatOrder))
			for _, seat := range seatOrder {
				checks = append(checks, check{"medium_" + string(seat) + "_first_place_rate", r.SeatRates[seat], 0.22, 0.28})
			}
			return checks
		}},
		{PairingHardVsMedium, func(r CalibrationReport) []check {
			return []check{{"hard_first_place_rate", r.SpecialRate, 0.34, 0.42}}
		}},
	}

	reports := make([]CalibrationReport, 0, len(pairings))
	var failures []string
	for _, pairing := range pairings {
		report, err := RunCalibration(pairing.spec, hands, baseSeed)
		if err != nil {
			t.Fatalf("%s: RunCalibration() error = %v", pairing.spec.Name, err)
		}
		reports = append(reports, report)
		t.Logf("%s: hands=%d draws=%d special_rate=%.4f seat_rates=%v",
			report.Pairing, report.Hands, report.ExhaustiveDraws, report.SpecialRate, report.SeatRates)
		if !gate {
			continue
		}
		for _, c := range pairing.checks(report) {
			if c.rate < c.min || c.rate > c.max {
				failures = append(failures, fmt.Sprintf("%s: %s = %.4f, want [%.2f, %.2f]", report.Pairing, c.name, c.rate, c.min, c.max))
			}
		}
	}

	if path := os.Getenv("MAHJONG_CALIBRATION_REPORT"); path != "" {
		writeCalibrationReport(t, path, reports)
	}

	if !gate {
		t.Logf("smoke run (%d hands/pairing) — not a statistically meaningful band check; set MAHJONG_CALIBRATION_HANDS for the real release gate", hands)
		return
	}
	if len(failures) > 0 {
		t.Fatalf("calibration out of band (§11.4):\n%s", strings.Join(failures, "\n"))
	}
}

// writeCalibrationReport writes the §11.4/E3.F4 "calibration report...
// per AI version" artifact as JSON to path.
func writeCalibrationReport(t *testing.T, path string, reports []CalibrationReport) {
	t.Helper()
	encoded, err := json.MarshalIndent(reports, "", "  ")
	if err != nil {
		t.Fatalf("marshal calibration report: %v", err)
	}
	if err := os.WriteFile(path, encoded, 0o644); err != nil {
		t.Fatalf("write calibration report to %s: %v", path, err)
	}
	t.Logf("wrote calibration report to %s", path)
}
