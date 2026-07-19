#!/usr/bin/env bash
# Runs the E1.F10 release-candidate simulator gate: a large batch of seeded
# random hands through the rules engine's MatchActor, checking tile
# conservation, replay determinism, and settlement conservation on every
# hand (rulesengine/simulator_test.go).
#
# On failure, the test names the failing seed. Reproduce a single hand with:
#   MAHJONG_SIM_SEED=<seed> MAHJONG_SIM_HANDS=1 go test ./rulesengine -run TestSimulatorRandomHands -v
#
# Usage:
#   scripts/run-rc-simulator.sh [hand-count] [base-seed]
#
# Defaults to 1,000,000 hands per §1.3/§15.9. Measured throughput on a
# 10-core development machine is ~6.6ms/hand with GOMAXPROCS parallelism
# (~110 minutes for 1,000,000 hands) — over the spec's 60-minute CI target.
# Closing that gap needs either more CI parallelism than 10 cores or
# reducing per-hand cost in EvaluateHand's decomposition search; track that
# as a follow-up rather than assuming this script meets the target on
# arbitrary hardware. Always measure on the actual CI runner before treating
# this as a hard release gate.
set -euo pipefail

HANDS="${1:-1000000}"
SEED="${2:-20260718}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Running ${HANDS} simulated hands starting at seed ${SEED}..."
cd "$REPO_ROOT"
MAHJONG_SIM_HANDS="$HANDS" MAHJONG_SIM_SEED="$SEED" \
  go test ./rulesengine -run TestSimulatorRandomHands -timeout 0 -parallel "$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
