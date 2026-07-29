#!/usr/bin/env bash
# Creates the §12.3 launch achievements in the AGS Achievement service.
#
# Requires a PUBLISHER-LEVEL USER TOKEN, not the confidential tooling client.
# This is not a preference — it is the only combination that works, and the
# failure modes are actively misleading:
#
#   client token + gameswithout-mahjong subdomain -> 20013 "insufficient
#       permission", even with g_achievements CREATE granted to the client
#       (verified: selectedActions [1,2,4,8] and still denied)
#   client token + gameswithout subdomain         -> 20030 "subdomain mismatch"
#       (a game-namespace client cannot call the publisher subdomain)
#   user token   + gameswithout-mahjong subdomain -> 20030 "subdomain mismatch"
#   user token   + gameswithout subdomain         -> 201 Created
#
# So achievement configuration is a publisher-namespace admin operation. The
# 20013 is genuinely about the caller's namespace level, not a missing grant,
# which is why granting the client permission did not fix it.
#
# Get a token by signing in to the Admin Portal and copying the bearer token,
# or via `ags auth login` (browser). They last one hour — this script creates
# 23 achievements in a few seconds, but a token minted long before you run it
# may expire mid-run. Re-running is safe.
#
# Usage:
#   AGS_ADMIN_TOKEN=eyJ... scripts/create-achievements.sh
#
# Safe to re-run: an existing achievement code returns 409 and is reported as
# "exists" and skipped.
#
# The XP values ride in customAttributes. AGS does not award them — our XP
# lives in PostgreSQL — but carrying them here means whatever wires
# unlock -> XP later does not have to re-derive them from the specification.

set -euo pipefail

NS="${ACCELBYTE_NAMESPACE:-gameswithout-mahjong}"
# The publisher subdomain, deliberately: see the failure matrix above.
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

# create <code> <name> <description> <statCode> <goalValue> <xp>
create() {
  local code="$1" name="$2" description="$3" stat="$4" goal="$5" xp="$6"
  local body http
  body=$(cat <<JSON
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
  http=$(curl -s -o "${response}" -w "%{http_code}" -X POST \
    -H "Authorization: Bearer ${AGS_ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${body}" \
    "${BASE}/achievement/v1/admin/namespaces/${NS}/achievements")

  case "${http}" in
    200|201)
      printf '  created  %-24s %s >= %s\n' "${code}" "${stat}" "${goal}"
      created=$((created + 1))
      ;;
    409)
      printf '  exists   %-24s\n' "${code}"
      existing=$((existing + 1))
      ;;
    401)
      printf '  FAILED   %-24s HTTP 401 — token expired or invalid\n' "${code}"
      failed=$((failed + 1))
      ;;
    *)
      printf '  FAILED   %-24s HTTP %s %s\n' "${code}" "${http}" \
        "$(head -c 140 "${response}" | tr -d '\n')"
      failed=$((failed + 1))
      ;;
  esac
}

echo "Creating §12.3 launch achievements in ${NS}"

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
