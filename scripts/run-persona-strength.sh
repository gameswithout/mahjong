#!/usr/bin/env bash
# Runs the persona strength gate from docs/bot-playing-style-personas.md
# §9.3: each persona seated against three River Scholars, seat-rotated on
# the same seeds, asserting that its first-place rate stays within ±4
# percentage points of the neutral quarter share and writing a JSON report
# (bots/persona_strength_test.go, TestPersonaStrengthSuite).
#
# This is the "is the roster balanced" question, and it is a different one
# from "is each persona a style" — that is TestEverySpecialistDivergesFrom-
# TheReference, which compares decisions rather than playing hands and runs
# in the normal suite.
#
# Usage:
#   scripts/run-persona-strength.sh [hand-count] [base-seed] [report-path] [difficulty]
#
# §9.3 asks for at least 10,000 hands per persona. Every seat here runs the
# full persona evaluator, so a hand costs several times what the
# difficulty-only calibration costs.
#
# Budget REAL TIME, not the figure you would guess. Observed on a 10-core
# development machine: roughly 2 hours per persona at 2,000 hands, so about
# half a day for the roster and several days at §9.3's full 10,000.
#
# An earlier version of this comment claimed ~0.6s/hand and twenty minutes
# per persona. That was measured before offline runs stopped using §11.4's
# 250ms decision cutoff — which had been silently truncating the slowest
# decisions and substituting a cheaper policy. The benchmark was of a faster
# thing than this script now runs, and the estimate was out by roughly six
# times. Removing the cutoff was correct (it made runs unrepeatable; see
# budgetMode in bots/takeover.go), and this is its price.
#
# Default is 2,000 hands, whose ±2 percentage-point 95% interval is tight
# enough to test a ±4 point band. Raise it to 10,000 for the release gate,
# expect it to run overnight or longer, and measure on the actual runner
# rather than trusting any figure in this comment.
set -euo pipefail

HANDS="${1:-2000}"
SEED="${2:-20260814}"
REPORT="${3:-persona-strength-report.json}"
DIFFICULTY="${4:-medium}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Running ${HANDS} hands per persona at ${DIFFICULTY}, starting at seed ${SEED}..."
cd "$REPO_ROOT"
MAHJONG_PERSONA_HANDS="$HANDS" \
  MAHJONG_PERSONA_SEED="$SEED" \
  MAHJONG_PERSONA_REPORT="$REPORT" \
  MAHJONG_PERSONA_DIFFICULTY="$DIFFICULTY" \
  go test ./bots -run TestPersonaStrengthSuite -v -timeout 0

echo "Persona strength report written to ${REPORT}"
