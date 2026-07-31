#!/usr/bin/env bash
#
# Create the §8.4 Full Rotation matchmaking pool and its session template.
#
# Full Rotation cannot share Quick Play's pool. That pool's session template
# stakes Jade and produces a single hand; Full Rotation is ranked, unstaked,
# and several hands long. The attribute that tells the match service which mode
# a session is (full_rotation) lives on the session template, so the mode is
# decided by matchmaking configuration rather than by anything a client sends —
# which is what stops a client asking for a ranked match it was not matched into.
#
# The pool body is copied from Quick Play's, changing only the name and the
# session template. Both modes seat exactly four players with no skill input,
# so a hand-written second ruleset would be nothing but an opportunity for the
# two to drift apart.
#
# Requires an authenticated AGS CLI session:  ags auth login
#
# Usage: scripts/create-full-rotation-pool.sh [--dry-run]

set -euo pipefail

NAMESPACE="${AGS_NAMESPACE:-gameswithout-mahjong}"
QUICK_PLAY_POOL="${QUICK_PLAY_POOL:-mahjong-test-pool}"
QUICK_PLAY_TEMPLATE="${QUICK_PLAY_TEMPLATE:-mahjong-test-none}"
ROTATION_TEMPLATE="${ROTATION_TEMPLATE:-mahjong-full-rotation}"
ROTATION_POOL="${ROTATION_POOL:-mahjong-full-rotation-pool}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

say() { printf '\n=== %s ===\n' "$1"; }

if ! ags auth status >/dev/null 2>&1; then
  echo "AGS CLI is not authenticated. Run: ags auth login" >&2
  exit 1
fi

# This game has its own AGS account, separate from the work studio the default
# tooling targets. Creating a ranked pool in the wrong namespace would be quiet
# and wrong, so refuse rather than guess.
ACTUAL_NS=$(ags auth status 2>/dev/null | awk -F': *' '/Namespace/ {print $2; exit}' | tr -d ' \r')
if [ -n "$ACTUAL_NS" ] && [ "$ACTUAL_NS" != "$NAMESPACE" ]; then
  echo "AGS CLI is authenticated against '$ACTUAL_NS', expected '$NAMESPACE'." >&2
  echo "Run 'ags auth login' against the game account before continuing." >&2
  exit 1
fi

say "Reading Quick Play template ($QUICK_PLAY_TEMPLATE)"
ags session templates get --namespace "$NAMESPACE" --name "$QUICK_PLAY_TEMPLATE" --format json | tee /tmp/qp-template.json

say "Reading Quick Play pool ($QUICK_PLAY_POOL)"
ags matchmaking match-pools get --namespace "$NAMESPACE" --pool "$QUICK_PLAY_POOL" --format json | tee /tmp/qp-pool.json

say "Deriving the rotation pool from it"
python3 scripts/derive-rotation-pool.py \
  /tmp/qp-pool.json "$ROTATION_POOL" "$ROTATION_TEMPLATE" /tmp/rotation-pool.json

say "Deriving the session template from Quick Play's"
python3 scripts/derive-rotation-template.py \
  /tmp/qp-template.json "$ROTATION_TEMPLATE" /tmp/rotation-template.json

say "Session template to create ($ROTATION_TEMPLATE)"
cat /tmp/rotation-template.json

say "Match pool to create ($ROTATION_POOL)"
cat /tmp/rotation-pool.json

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "(dry run: nothing created)"
  exit 0
fi

say "Creating session template"
ags session templates create --namespace "$NAMESPACE" --json @/tmp/rotation-template.json || {
  echo "Template creation failed — it may already exist; continuing to the pool." >&2
}

say "Creating match pool"
ags matchmaking match-pools create --namespace "$NAMESPACE" --json @/tmp/rotation-pool.json

say "Verifying"
ags session templates get --namespace "$NAMESPACE" --name "$ROTATION_TEMPLATE" --format json
ags matchmaking match-pools get --namespace "$NAMESPACE" --pool "$ROTATION_POOL" --format json

cat <<NOTE

Next: set the pool in the client build.

  .env                                ACCELBYTE_ROTATION_MATCH_POOL=$ROTATION_POOL
  .github/workflows/deploy-pages.yml  same key

Until that is set the lobby card reports Full Rotation matchmaking as
unconfigured, which is accurate rather than broken.
NOTE
