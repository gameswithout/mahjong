#!/usr/bin/env bash
# Runs the E3.F4 AI calibration release gate: §11.4's "at least 10,000
# same-seed seat-rotated simulations" per pairing (Easy-vs-3-Medium, Medium
# mirror, Hard-vs-3-Medium), asserting each pairing's first-place-rate band
# and writing a JSON calibration report (bots/calibration_test.go,
# TestCalibrationSuite). A failing band fails this script, per §11.4/E3.F4
# ("out-of-band fails release").
#
# Usage:
#   scripts/run-calibration.sh [hand-count] [base-seed] [report-path]
#
# Defaults to 10,000 hands/pairing per §11.4, seed 20260719, and a report
# written to calibration-report.json in the repo root.
#
# Hands within one pairing run concurrently across GOMAXPROCS workers (each
# hand is an independent simulation), but RunCalibration's three pairings
# run one after another. Measured throughput on a 10-core development
# machine is ~0.34-0.46s/hand (parallel wall-clock, i.e. already reflecting
# the per-pairing worker-pool speedup) with Hard the slowest of the three —
# at 10,000 hands/pairing that is roughly 55-75 minutes per pairing, ~3
# hours total. This is not fast enough to run on every commit, matching
# scripts/run-rc-simulator.sh's own precedent for a large opt-in-only gate;
# always measure on the actual CI/release runner before treating a specific
# wall-clock figure as a hard requirement.
set -euo pipefail

HANDS="${1:-10000}"
SEED="${2:-20260719}"
REPORT="${3:-calibration-report.json}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Running ${HANDS} calibration hands per pairing starting at seed ${SEED}..."
cd "$REPO_ROOT"
MAHJONG_CALIBRATION_HANDS="$HANDS" MAHJONG_CALIBRATION_SEED="$SEED" MAHJONG_CALIBRATION_REPORT="$REPORT" \
  go test ./bots -run TestCalibrationSuite -v -timeout 0

echo "Calibration report written to ${REPORT}"
