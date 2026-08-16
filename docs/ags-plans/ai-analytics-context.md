# AI Analytics context — Mahjong

Context file for [AGS AI Analytics](https://docs.accelbyte.io/gaming-services/modules/ai-analytics/).
Point an MCP-connected assistant at the `gameswithout-mahjong` namespace with
this file loaded, and its answers become game-specific instead of generic.

This file is published to the namespace as the tenant context document
`mahjong_game_context` (`context_id: 3HyTCOxWXtGH2RjEHGRRCbIphm7`), so the
Athena workflow reads it before writing SQL. Edit it here, then push it with
`PUT /afs/v1/admin/namespaces/gameswithout-mahjong/contexts/3HyTCOxWXtGH2RjEHGRRCbIphm7`
and an `If-Match` of the row's current `updated_at` — the repo is the source of
truth and the published copy is a mirror.

## Where the data is

Every event is its own table, one per event name:

```
foundations_prod_game_telemetry_event."gameswithout_mahjong_<event_name>"
```

There is no single events table and no `eventname` filter to apply — the table
*is* the filter. A question spanning events is a `UNION ALL` across tables.
Every query must carry `namespacez = 'gameswithout-mahjong'` plus a `year` /
`month` predicate, and the fields below live inside the `payload` JSON blob:
`json_extract_scalar(payload, '$.dimensions.mode')`,
`json_extract_scalar(payload, '$.measurements.session_seconds')`.

`userid` is an envelope column on every table — AGS binds it from the player's
token. It is the only player identifier; nothing in the payload identifies
anybody.

AI Analytics answers from **game telemetry events**, not from AGS Statistics.
The two are different surfaces and answer different questions:

| Surface | Answers | Authority |
|---|---|---|
| AGS Statistics | "what is *my* record?" — one player, lifetime counters | Authoritative. Drives the §P2.3 dashboard and §12.3 achievements. |
| Game Telemetry | "what is happening across players?" — cohorts, funnels, trends | Analysis only. Optional-consent, and lossy by design. |

Never reconcile one against the other. A player's dashboard is Statistics; a
question about players in aggregate is telemetry.

## What this game is

Taiwanese 16-tile Mahjong, four seats, played in a browser. A **hand** is one
deal played to a win or an exhaustive draw — it is the unit almost every
question should be asked in. A **match** is one hand in Quick Play and Practice,
and several hands in Full Rotation — so hands and matches are the same count in
some modes and not others. Never assume one from the other.

Three modes exist, and mixing them makes most answers wrong:

- **Practice** (`mode=practice`) — solo against three bots. Changes no Jade, no
  rating, no progression, and no statistics. Exclude it from anything about
  player performance or economy.
- **Quick Play** (`mode=quick_play`) — four humans, real stakes and
  progression. This is the mode that matters.
- **Full Rotation** (`mode=full_rotation`) — four humans, ranked, several hands
  to a match, no Jade staked. Playable since 2026-07-30 and requires a linked
  account, so its population is a subset of Quick Play's by construction.
  Excluded from anything about the economy, included in anything about
  performance.

Practice hands earn XP (capped per UTC day) but touch no Jade, no rating, and
no public statistics.

## Player eligibility

- Players sign in as **guests** (device ID) by default and may later attach an
  email to the *same* account. A guest is a real player, not an anonymous
  visitor — do not filter them out.
- The namespace is **closed beta**. Population is small; treat any percentage
  over a handful of players as directional, not conclusive.
- Bots occupy seats in Practice and take over disconnected seats in Quick Play.
  Bots are never players and emit no telemetry of their own.

## Event windows

- The client keeps a bounded in-memory queue **for the active tab only** and
  flushes on page hide. Events from a tab that was closed hard can be lost, so
  counts are a floor, not a census.
- `privacy_class=optional` events are only sent when the player has consented.
  Most behavioural events below are optional; treat gaps as consent, not as
  absence of play.
- **Consent is opt-in and off by default, and almost nobody turns it on.** Over
  July–August 2026 the namespace recorded 234 `app_session_started` rows and 2
  `mode_selected` rows. That ratio is the consent rate, not a funnel. It has
  one hard consequence for every question asked here: **never divide an
  optional numerator by an essential denominator.** Optional counts are a
  sample of consenting players; essential counts are the population. Mixing
  them produces conversion rates near zero that mean nothing.
  `analytics_consent_changed` (essential) is what to measure the consent rate
  itself with.
- Sessions are identified by `analytics_session_id`, which is per-tab and
  resets on reload. It is not a user id and must not be counted as one.

## Custom events

All events carry `schema_version`, `occurred_at`, `analytics_session_id` and
`privacy_class`.

### Gameplay

**`hand_completed`** — one per completed hand, per player. The analysable
counterpart to the dashboard statistics.

| Field | Meaning |
|---|---|
| `mode` | `practice` or `quick_play`. Filter to `quick_play` for anything about performance. |
| `outcome` | `won`, `lost`, or `draw` (exhaustive draw — nobody won). |
| `win_kind` | How the hand ended: `zimo` (self-draw), `discard`, `rob`, `eight_flowers`, `heavenly`, `exhaustive_draw`, or `none`. |
| `dealt_in` | `true` when *this* player discarded the tile somebody won on. Only ever true when `win_kind=discard`. |
| `ting` | `true` when this player was still one tile from winning as the hand ended. Not "reached Ting at any point" — it is measured at the end. |
| `raw_tai` | Score of this player's winning hand; `0` when they did not win. |
| `wall_remaining` | Tiles left in the wall. A low value means the hand ran long. |

Deal-in rate is `dealt_in=true` over all hands. Zimo share is `win_kind=zimo`
over **wins**, not over hands — a Zimo share computed against hands played is a
different and much smaller number, and is the most common way to get this wrong.

### Onboarding and lobby

`app_session_started`, `app_interactive`, `app_visibility_changed`,
`lobby_impression`, `mode_selected`, `tutorial_*` — the tutorial chapter and
step funnel.

### Matchmaking

`queue_entry_result`, `queue_threshold_reached`, `queue_alternative_offered`,
`queue_alternative_selected`, `queue_cancel_result`, `session_join_result`.

`queue_threshold_reached` fires when a player has waited long enough that the
lobby offers them a way out. A rise in it is a population problem, not a
matchmaking bug — with four seats to fill in a closed beta, queue time is
mostly a function of how many people are online.

### Growth (schema v2)

Ten events added on 2026-08-15 to answer growth questions rather than
correctness ones. Three are **essential** — they report for every player.

**`app_session_ended`** (essential) — one per session, paired with
`app_session_started`. `session_seconds`, `hands_completed`,
`matches_entered`, `queue_entries`; `end_reason` is `hidden`, `pagehide`, or
`unmount`, and `session_depth` is `bounced` → `queued` → `played`. Sessions are
ended on the first tab hide and latched, so a session's length is time-to-first-hide,
not time-to-close: it undercounts a player who tabs away and returns. Sessions
missing an end row are tabs killed hard; treat them as lost, not as zero-length.

**`analytics_consent_changed`** (essential) — `outcome` is `granted` or
`declined`, `surface` says where. Restoring a saved preference on load is
deliberately *not* recorded, so every row is a real decision by a real player.

**`account_upgrade_step`** (essential) — the guest → linked account funnel, the
conversion that unlocks ranked play and friends. `step` runs `offer_shown` →
`code_requested` → `code_sent` → `submitted` → `succeeded`, with `code_failed`
and `failed` carrying a `reason_code`. `surface` is `lobby` or `hand_result`:
which of the two converts better is the decision this event exists to settle.
`offer_shown` is the only honest denominator for upgrade rate — AGS IAM records
the successes but cannot record the offers nobody acted on.

**`activation_milestone`** (optional) — one row per rung per player, ever:
`first_lobby` → `first_match_entered` → `first_hand_completed` →
`first_staked_hand`, plus `first_friend`. `minutes_since_first_session` is
time-to-value. `first_hand_completed` is activation; `first_staked_hand` is
activation into the mode with the business on it, and is a much smaller number.
Milestones are device-local: a player on a second browser reaches them again.

**`match_abandoned`** (optional) — left a table with a hand still live.
`phase` says whether players quit early (bored) or late (beaten), and
`taken_over=true` means a bot was already playing the seat, which makes it a
reconnection failure rather than a choice.

**`economy_checkpoint`** (optional) — Jade banded against the minimum that
gates play: `empty`, `below_minimum`, `low`, `healthy`, `deep`. Emitted only
when the band changes. A player at `empty` or `below_minimum` cannot enter
Bamboo Courtyard at all — that transition, not the balance, is the churn edge.

**`economy_recovery`** (optional) — the welfare faucet: `offered`, `claimed`,
`not_granted`, `failed`. Claim rate against offer rate says whether the faucet
recovers anybody; the following session's `economy_checkpoint` says whether it
lasted.

**`progression_level_up`** (optional) — `level`, `level_band`, `lifetime_xp`.
Practice awards XP (capped daily) and Quick Play awards more, so a level-up is
not evidence of staked play.

**`social_action`** (optional) — `friend_request`, `party_create`,
`party_invite`, `party_join_code`, `party_share_code`, `party_leave`, and
`play_again` (requeue straight from the result screen). In a four-seat game the
social loop is also the acquisition loop.

**`feature_engaged`** (optional) — `feature` = `locale` (with `value` = `en`,
`zh-CN`, `zh-TW`; `surface=startup` is the language players arrived in,
`surface=selector` is a deliberate switch), plus `expertHud`, `autoPassClaims`,
`compactClaimPrompts`, `practiceBotSpeed`, `showTutorial`.

`app_session_started` also gained `return_band` (`first_session`, `same_day`,
`next_day`, `within_week`, `within_month`, `lapsed`) and `session_count_band`.
Both are device-local and coarse. For authoritative retention, cohort on
`userid` across `app_session_started` days instead — the bands are a cheap
approximation that resets when a player clears storage or changes browser.

## Questions worth asking

Product and correctness:

- Deal-in rate by account level — does the game actually teach defence?
- Ting rate against win rate — are players reaching Ting and still losing?
- Tutorial step drop-off, and whether players who skip it deal in more.
- Queue abandonment against `queue_threshold_reached`, split by hour.
- `wall_remaining` distribution on draws — are hands ending exhausted or early?

Growth:

- Day-1 and day-7 return, cohorting `userid` on `app_session_started` days.
- Session length and `session_depth` mix: what share of sessions never leave
  the lobby, and is that share moving?
- The activation ladder as a funnel: lobby → seated → first hand → first
  staked hand, and `minutes_since_first_session` at each rung.
- Upgrade rate by `surface` — does the offer convert better after a match or
  in the lobby, and which step loses the most players?
- `economy_checkpoint` transitions into `empty`, and whether a session
  following one ever happens.
- Locale mix at `surface=startup` against where players are — the Chinese
  localization shipped 2026-08-15 and its uptake is a market signal.
- Consent rate from `analytics_consent_changed`, which sets the confidence
  interval on every optional-event answer above.

## Traps

- **Practice pollutes everything.** It is most of the hands played and none of
  the stakes. Filter it out unless the question is about Practice.
- **A hand is not a match is not a session.** One tab can play many hands.
- **Percentages need a stated denominator.** The dashboard withholds a rate
  below twenty hands for this reason; apply the same restraint here.
- **Takeover seats.** A player disconnected for most of a hand still completes
  it, and their outcome reflects a bot's play, not theirs.
