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
# difficulty-only calibration costs: measured throughput on a 10-core
# development machine is ~0.6s/hand of parallel wall-clock, i.e. roughly
# 100 minutes per persona and the better part of a day for the whole
# roster. Default here is 2,000 hands, which gives a ±2 percentage-point
# 95% interval — tight enough to test a ±4 point band — and takes about
# twenty minutes per persona. Raise it to 10,000 for the release gate, and
# always measure on the actual runner before treating any wall-clock figure
# as a requirement.
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
