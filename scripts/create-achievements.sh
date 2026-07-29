#!/usr/bin/env bash
# Creates the §12.3 launch achievements in the AGS Achievement service.
#
# Blocked as of 2026-07-28 on ADMIN:NAMESPACE:<ns>:ACHIEVEMENT [CREATE] — the
# tooling client can list achievements but not create them (error 20013). Run
# this once that permission is granted; it needs no other setup, because every
# stat code it references is already live in the namespace.
#
# Safe to re-run: an achievement code that already exists returns a conflict,
# which is reported as "exists" and skipped rather than treated as a failure.
#
# Usage:
#   AGS_CLIENT_SECRET=... scripts/create-achievements.sh
#
# The XP values ride in customAttributes. AGS does not award them — our XP
# lives in PostgreSQL — but carrying them here means whatever wires unlock->XP
# later does not have to re-derive them from the specification.

set -euo pipefail

NAMESPACE="${ACCELBYTE_NAMESPACE:-gameswithout-mahjong}"
export AGS_BASE_URL="${AGS_BASE_URL:-https://gameswithout-mahjong.prod.gamingservices.accelbyte.io}"
export AGS_PROFILE="${AGS_PROFILE:-mahjong}"

if [ -z "${AGS_CLIENT_SECRET:-}" ]; then
  echo "AGS_CLIENT_SECRET is required (the confidential tooling client's secret)." >&2
  exit 1
fi

created=0
existing=0
failed=0

# create <code> <name> <description> <statCode> <goalValue> <xp>
create() {
  local code="$1" name="$2" description="$3" stat="$4" goal="$5" xp="$6"
  local json
  json=$(cat <<JSON
{
  "achievementCode": "${code}",
  "defaultLanguage": "en",
  "name": {"en": "${name}"},
  "description": {"en": "${description}"},
  "statCode": "${stat}",
  "goalValue": ${goal},
  "incremental": true,
  "hidden": false,
  "tags": ["launch"],
  "lockedIcons": [],
  "unlockedIcons": [],
  "customAttributes": {"xp": ${xp}}
}
JSON
)
  local output
  if output=$(ags achievement achievements create \
      --namespace "${NAMESPACE}" --json "${json}" 2>&1); then
    printf '  created  %-24s %s >= %s\n' "${code}" "${stat}" "${goal}"
    created=$((created + 1))
  elif printf '%s' "${output}" | grep -qi "conflict\|already exist\|duplicate"; then
    printf '  exists   %-24s\n' "${code}"
    existing=$((existing + 1))
  else
    printf '  FAILED   %-24s %s\n' "${code}" "$(printf '%s' "${output}" | head -2 | tr '\n' ' ')"
    failed=$((failed + 1))
  fi
}

echo "Creating §12.3 launch achievements in ${NAMESPACE}"

# --- Participation and mastery counters -------------------------------------
create first-hand "First Hand" \
  "Complete your first public hand." public-hands-completed 1 100
create first-win "First Win" \
  "Win your first public hand." public-hands-won 1 200
create self-reliant "Self Reliant" \
  "Win by Zimo 10 times." zimo-wins 10 300
create self-reliant-ii "Self Reliant II" \
  "Win by Zimo 50 times." zimo-wins 50 750
create kong-collector "Kong Collector" \
  "Declare 25 legal Kongs." kongs-declared 25 300
create kong-master "Kong Master" \
  "Declare 100 legal Kongs." kongs-declared 100 750
create hundred-hands "Hundred Hands" \
  "Complete 100 public hands." public-hands-completed 100 500
create centurion-of-the-table "Centurion of the Table" \
  "Complete 500 public hands." public-hands-completed 500 1000

# --- Hand value --------------------------------------------------------------
create high-value "High Value" \
  "Win a hand worth at least 5 raw Tai." highest-raw-tai 5 300
create master-craft "Master Craft" \
  "Win a hand worth at least 10 raw Tai." highest-raw-tai 10 750

# --- Named winning patterns --------------------------------------------------
create all-pongs "All Pongs" \
  "Win with All Pongs." wins-all-pongs 1 500
create pure-hand "Pure Hand" \
  "Win with a Full Flush." wins-full-flush 1 750
create half-and-half "Half and Half" \
  "Win with a Half Flush." wins-half-flush 1 300
create dragon-caller "Dragon Caller" \
  "Win with Big Three Dragons." wins-big-three-dragons 1 1000
create four-winds "Four Winds" \
  "Win with Big Four Winds." wins-big-four-winds 1 1500
create honor-guard "Honor Guard" \
  "Win with All Honors." wins-all-honors 1 1000
create eightfold-bloom "Eightfold Bloom" \
  "Win with Eight Flowers." wins-eight-flowers 1 1500
create kong-robber "Kong Robber" \
  "Win by Robbing an Added Kong." wins-robbing-kong 1 500
create replacement-artist "Replacement Artist" \
  "Win after a replacement draw." wins-after-replacement 1 300
create last-chance "Last Chance" \
  "Win with a Last Tile Zimo." wins-last-tile-zimo 1 500
create quiet-strength "Quiet Strength" \
  "Win with a Concealed Zimo." wins-concealed-zimo 1 300
create three-of-a-mind "Three of a Mind" \
  "Win with three or more Concealed Pongs." wins-concealed-pongs 1 500
create garden-party "Garden Party" \
  "Win with Complete Seasons or Complete Flowers." wins-complete-flowers 1 500

echo
echo "created=${created} existing=${existing} failed=${failed}"
[ "${failed}" -eq 0 ]
