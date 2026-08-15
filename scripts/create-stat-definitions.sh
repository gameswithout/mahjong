#!/usr/bin/env bash
# Creates the AGS Statistics definitions the match service writes and the
# §P2.3 dashboard reads.
#
# A stat code with no definition in the namespace is a SILENT no-op, not an
# error: the bulk update returns success and the value is discarded. So a
# missing definition looks exactly like a player who has never done the
# thing, which is the worst possible failure mode for a statistics screen.
# Every code in pkg/progression/stats.go must exist here.
#
# Requires a PUBLISHER-LEVEL USER TOKEN, not the confidential tooling client,
# for the same reason scripts/create-achievements.sh does — statistics
# configuration is a publisher-namespace admin operation. See that script's
# failure matrix; it applies unchanged here.
#
# Get a token by signing in to the Admin Portal for the *publisher* namespace
# and copying the bearer token. Check it is the right account before using
# it: a token for another studio's namespace decodes with that namespace in
# its claims and will either fail with a subdomain mismatch or, worse, touch
# the wrong studio.
#
# Usage:
#   AGS_ADMIN_TOKEN=eyJ... scripts/create-stat-definitions.sh
#
# Safe to re-run: an existing statCode returns 409 and is reported as
# "exists" and skipped. Nothing here ever deletes or resets a definition, so
# it cannot destroy player values.
set -euo pipefail

NS="${ACCELBYTE_NAMESPACE:-gameswithout-mahjong}"
BASE="${AGS_PUBLISHER_BASE_URL:-https://gameswithout.prod.gamingservices.accelbyte.io}"

if [ -z "${AGS_ADMIN_TOKEN:-}" ]; then
  echo "AGS_ADMIN_TOKEN is required (a publisher-level user token)." >&2
  echo "A confidential client token will NOT work for this operation." >&2
  exit 1
fi

created=0
existing=0
failed=0
response=$(mktemp)
trap 'rm -f "${response}"' EXIT

# create <statCode> <name> <description>
#
# Every statistic here is server-authoritative, incremental, and never
# resets. setBy SERVER matters: a CLIENT-settable statistic can be written by
# anything holding a player token, which for a dashboard the player is shown
# — and for achievements evaluated against these values — would make the
# numbers unfalsifiable.
#
# minimum 0 with no maximum: these are lifetime counters. Giving them a
# maximum would silently clamp a long-lived account.
create() {
  local code="$1" name="$2" description="$3"
  local body http
  body=$(cat <<JSON
{
  "statCode": "${code}",
  "name": "${name}",
  "description": "${description}",
  "defaultValue": 0,
  "minimum": 0,
  "incrementOnly": true,
  "setAsGlobal": false,
  "setBy": "SERVER",
  "tags": ["mahjong", "dashboard"]
}
JSON
)
  http=$(curl -s -o "${response}" -w "%{http_code}" -X POST \
    -H "Authorization: Bearer ${AGS_ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${body}" \
    "${BASE}/social/v1/admin/namespaces/${NS}/stats")

  case "${http}" in
    200|201)
      printf '  created  %-28s %s\n' "${code}" "${name}"
      created=$((created + 1))
      ;;
    409)
      printf '  exists   %-28s\n' "${code}"
      existing=$((existing + 1))
      ;;
    401)
      printf '  FAILED   %-28s HTTP 401 — token expired or invalid\n' "${code}"
      failed=$((failed + 1))
      ;;
    *)
      printf '  FAILED   %-28s HTTP %s %s\n' "${code}" "${http}" \
        "$(head -c 140 "${response}" | tr -d '\n')"
      failed=$((failed + 1))
      ;;
  esac
}

echo "Creating statistics definitions in ${NS}"

# --- Achievement source counters (§12.3) ------------------------------------
# These predate the dashboard and back the incremental achievements.
create public-hands-completed "Public hands completed" \
  "Public hands played to a result."
create public-hands-won       "Public hands won" \
  "Public hands this player won."
create zimo-wins              "Self-drawn wins" \
  "Wins completed on the player's own draw."
create kongs-declared         "Kongs declared" \
  "Kongs declared across all public hands."
create highest-raw-tai        "Best hand" \
  "Highest raw Tai scored in a single winning hand."

# --- Dashboard rate numerators and denominators (§P2.3) ---------------------
# AGS stores one scalar per code and cannot divide, so each rate is a pair of
# counters and the division happens at read time.
create public-hands-dealt-in  "Hands dealt in" \
  "Hands where an opponent won on this player's discard."
create public-hands-ting      "Hands ready at the end" \
  "Hands where the player was still waiting when the hand ended."
create total-raw-tai          "Total Tai won" \
  "Running total of raw Tai across winning hands. Divided by wins for the average."
create public-hands-opened    "Hands opened" \
  "Hands where the player claimed at least one meld. The call-rate numerator."
create public-hands-drawn     "Hands reaching a draw" \
  "Hands that exhausted the wall. The tenpai-at-draw denominator."
create public-hands-ting-at-draw "Ready at a draw" \
  "Hands where the player was waiting when the wall ran out."
create discards-made          "Discards made" \
  "Discards the player made. The tile-efficiency denominator."
create discards-efficient     "Efficient discards" \
  "Discards matching the one-ply efficiency reference for that position."

# --- Pattern win counters (§12.3) -------------------------------------------
# One per scoring pattern that has an achievement. Written by patternWinStats
# from the winner's own scored hand, so the name here must match the code in
# pkg/progression/stats.go and not the pattern's display name.
create wins-all-pongs         "All Pongs wins" \
  "Wins whose scored hand included All Pongs."
create wins-full-flush        "Full Flush wins" \
  "Wins whose scored hand included Full Flush."
create wins-half-flush        "Half Flush wins" \
  "Wins whose scored hand included Half Flush."
create wins-big-three-dragons "Big Three Dragons wins" \
  "Wins whose scored hand included Big Three Dragons."
create wins-big-four-winds    "Big Four Winds wins" \
  "Wins whose scored hand included Big Four Winds."
create wins-all-honors        "All Honors wins" \
  "Wins whose scored hand included All Honors."
create wins-eight-flowers     "Eight Flowers wins" \
  "Wins by the Eight Flowers declaration."
create wins-robbing-kong      "Robbing a Kong wins" \
  "Wins by claiming a tile added to an opponent's Pong."
create wins-after-replacement "Replacement draw wins" \
  "Wins completed on a replacement draw."
create wins-last-tile-zimo    "Last tile wins" \
  "Wins self-drawn on the final drawable tile."
create wins-concealed-zimo    "Concealed self-drawn wins" \
  "Wins self-drawn with a fully concealed hand."
create wins-complete-flowers  "Complete Flowers wins" \
  "Wins holding a complete Flowers or Seasons set."
create wins-concealed-pongs   "Concealed Pong wins" \
  "Wins with three or more concealed Pongs."

# --- Seat splits ------------------------------------------------------------
# East deals, so pooling the seats hides a real effect.
create hands-seat-east      "Hands as East"  "Hands played from the East seat."
create hands-won-seat-east  "Wins as East"   "Hands won from the East seat."
create hands-seat-south     "Hands as South" "Hands played from the South seat."
create hands-won-seat-south "Wins as South"  "Hands won from the South seat."
create hands-seat-west      "Hands as West"  "Hands played from the West seat."
create hands-won-seat-west  "Wins as West"   "Hands won from the West seat."
create hands-seat-north     "Hands as North" "Hands played from the North seat."
create hands-won-seat-north "Wins as North"  "Hands won from the North seat."

echo
echo "created ${created}, already existed ${existing}, failed ${failed}"
if [ "${failed}" -gt 0 ]; then
  exit 1
fi
