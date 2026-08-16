# Growth telemetry and the AI Analytics dashboard

- Date: 2026-08-15
- Approved feature: custom telemetry events chosen for growth decisions, plus an
  AGS AI Analytics dashboard built on them
- Approval: the user asked, as growth expert, to identify and implement the
  events needed to grow the game and to stand up the analytics dashboard

## Confirmed context

- Nineteen custom events already ship to AGS Game Telemetry (schema v1). They
  answer correctness questions — did the queue work, did the tutorial land —
  and no growth questions at all.
- AGS AI Analytics is live on this namespace through the Athena facade
  (`athena-facade-poc`), with a $10 lifetime spend cap, $0.50 used.
- Telemetry lands in `foundations_prod_game_telemetry_event` as **one Glue
  table per event name**, `gameswithout_mahjong_<event_name>`. Nine tables
  existed before this change.
- `userid` is an envelope column AGS binds from the player token, so
  per-player cohorting is possible on essential events without the client
  sending any identity of its own.
- The namespace held **no tenant context document**, so AI Analytics had no
  game-specific grounding at all.

## What the data said before any code changed

| Signal | Value | Source |
|---|---|---|
| Sessions recorded, 29 Jul – 15 Aug | 234 | `app_session_started` |
| Distinct players, all time | 26 | same |
| Daily active players, peak → last | 16 (29 Jul) → 1 (12 Aug) | same |
| Days since any session | 3 | same |
| Players active on exactly one day | 19 of 26 (73%) | same |
| Returned within 7 days of first session | 7 of 26 eligible (27%) | same |
| Optional (behavioural) events, all time | **6** | all optional tables |
| Essential events, all time | **1,466** | all essential tables |

Two conclusions drove the design:

1. **The behavioural funnel is invisible.** Optional events need consent,
   consent is opt-in and buried in Settings, and roughly nobody grants it. One
   `hand_completed` row exists for 234 sessions. Adding more optional events
   alone would have added more empty tables.
2. **The essential stream is enough for the retention layer.** Because AGS
   binds `userid`, DAU, return rate, and stickiness are all computable from
   `app_session_started` today. That is where the dashboard starts.

## Goal

Emit the events a growth and product team needs to decide what to build next —
retention, activation, conversion, economy, social, feature adoption — and put
the questions they answer on a dashboard.

## Non-goals

- Weakening the privacy contract. Behavioural events stay optional and the
  default without an answer stays "no"; what changed is that the game now asks
  once, in the lobby, instead of waiting to be found in Settings.
- Server-authored telemetry. Every event added here is client-side, matching
  the existing AGS-only transport.
- Collecting anything new about a player. Every added field is a band, a count,
  or a state name; the banding in `client/growth.ts` is the control that keeps
  it that way, and `client/telemetry.ts` rejects anything off the allowlist.

## Affected areas

- `client/growth.ts` (new): banding rules, the device-local activation store.
- `client/telemetry.ts`: ten new event specs, schema version 2.
- `client/App.tsx`: the trigger for each.
- `client/AnalyticsConsentCard.tsx` (new), `client/settings.ts`,
  `client/i18n/catalog.json`, `client/styles.css`: the lobby consent ask.
- `client/growth.test.ts` and `client/App.analyticsConsent.test.tsx` (new),
  `client/telemetry.test.ts`, `client/App.telemetry.test.tsx`,
  `client/settings.test.ts`.
- `docs/ags-plans/ai-analytics-context.md`, now also published to AGS.

## The events

Three essential, seven optional. The line is the one the project already drew:
the lifecycle of the app and of the account is essential; how somebody played
is optional.

| Event | Class | Growth question it answers |
|---|---|---|
| `app_session_ended` | essential | How long is a session, and what share never reach a table? |
| `analytics_consent_changed` | essential | What is the consent rate — the denominator for everything below? |
| `account_upgrade_step` | essential | Where does guest → linked account conversion leak, and which surface converts? |
| `activation_milestone` | optional | What share of installs ever finish a hand, and how long does it take? |
| `match_abandoned` | optional | Do players quit bored (early) or beaten (late)? |
| `economy_checkpoint` | optional | Who runs out of Jade, and is that where they stop? |
| `economy_recovery` | optional | Does the welfare faucet actually recover anybody? |
| `progression_level_up` | optional | Is the reward curve set where players actually reach it? |
| `social_action` | optional | Is the social loop — the acquisition loop in a four-seat game — being used? |
| `feature_engaged` | optional | Which features get adopted, including the new locales? |

`app_session_started` also gained `return_band` and `session_count_band`.
Both are coarse, device-local, and disclose nothing that was not already
derivable from that event's own history by `userid`.

Each name becomes its own Athena table, which is why the set is ten events with
variation in dimensions rather than thirty near-duplicate names.

## Dashboard

Six pins on the namespace dashboard, all from essential events so they have
data today and are not a sample of consenting players:

| Pin | Chart | Reads |
|---|---|---|
| Daily active players | line | DAU and sessions, rolling 30 days |
| New vs returning players | stacked bar | acquisition against retention, per day |
| Return rate by window | bar | D1/D3/D7/D14/D30 returned against eligible |
| Player stickiness | horizontal bar | lifetime distinct active days per player |
| Telemetry coverage by privacy class | horizontal bar | how much of the funnel consent is hiding |
| When players are online | heatmap | weekday × UTC hour, the seat-filling constraint |

Refresh is the only billable action; opening the dashboard serves cached rows.

### Ready to pin once the growth events have data

These cannot be pinned yet — the Glue tables are created by the first event of
each name, and a pin over a missing table fails rather than showing zero. Pin
them after the client ships and each event has fired once.

**Session depth mix** — what share of sessions bounce:

```sql
SELECT json_extract_scalar(payload, '$.dimensions.session_depth') AS depth,
       count(*) AS sessions,
       round(avg(CAST(json_extract_scalar(payload, '$.measurements.session_seconds') AS double)), 1) AS avg_seconds
FROM "gameswithout_mahjong_app_session_ended"
WHERE namespacez = 'gameswithout-mahjong' AND year >= '2026'
GROUP BY 1 ORDER BY 2 DESC
```

**Activation funnel** — the ladder as a funnel chart:

```sql
SELECT json_extract_scalar(payload, '$.dimensions.milestone') AS milestone,
       count(DISTINCT userid) AS players,
       round(approx_percentile(
         CAST(json_extract_scalar(payload, '$.measurements.minutes_since_first_session') AS double), 0.5), 1)
         AS median_minutes_to_reach
FROM "gameswithout_mahjong_activation_milestone"
WHERE namespacez = 'gameswithout-mahjong' AND year >= '2026'
GROUP BY 1
ORDER BY CASE json_extract_scalar(payload, '$.dimensions.milestone')
  WHEN 'first_lobby' THEN 1 WHEN 'first_match_entered' THEN 2
  WHEN 'first_hand_completed' THEN 3 WHEN 'first_staked_hand' THEN 4 ELSE 5 END
```

**Guest upgrade funnel by surface** — which offer converts:

```sql
SELECT json_extract_scalar(payload, '$.dimensions.surface') AS surface,
       json_extract_scalar(payload, '$.dimensions.step') AS step,
       count(DISTINCT userid) AS players
FROM "gameswithout_mahjong_account_upgrade_step"
WHERE namespacez = 'gameswithout-mahjong' AND year >= '2026'
GROUP BY 1, 2 ORDER BY 1, 3 DESC
```

**Consent rate** — the denominator:

```sql
SELECT json_extract_scalar(payload, '$.dimensions.outcome') AS outcome,
       json_extract_scalar(payload, '$.dimensions.surface') AS surface,
       count(*) AS decisions
FROM "gameswithout_mahjong_analytics_consent_changed"
WHERE namespacez = 'gameswithout-mahjong' AND year >= '2026'
GROUP BY 1, 2 ORDER BY 3 DESC
```

**Locale mix** — market signal for the Chinese localization:

```sql
SELECT json_extract_scalar(payload, '$.dimensions.value') AS locale,
       json_extract_scalar(payload, '$.dimensions.surface') AS surface,
       count(DISTINCT userid) AS players
FROM "gameswithout_mahjong_feature_engaged"
WHERE namespacez = 'gameswithout-mahjong' AND year >= '2026'
  AND json_extract_scalar(payload, '$.dimensions.feature') = 'locale'
GROUP BY 1, 2 ORDER BY 3 DESC
```

**Jade band transitions** — the economy's churn edge:

```sql
SELECT json_extract_scalar(payload, '$.dimensions.balance_band') AS band,
       count(DISTINCT userid) AS players, count(*) AS crossings
FROM "gameswithout_mahjong_economy_checkpoint"
WHERE namespacez = 'gameswithout-mahjong' AND year >= '2026'
GROUP BY 1 ORDER BY 2 DESC
```

## AI Analytics context

`docs/ags-plans/ai-analytics-context.md` is now published to the namespace as
the tenant context document `mahjong_game_context`
(`context_id: 3HyTCOxWXtGH2RjEHGRRCbIphm7`, order 100). The Athena workflow
reads it before writing any SQL, so questions asked of AI Analytics are grounded
in this game's modes, denominators, and traps rather than generic AGS defaults.

The repo copy stays the source of truth. To update the published copy:
`GET .../contexts/{id}` for its `updated_at`, then
`PUT .../contexts/{id}` with `If-Match: <that updated_at>`.

## Authorization plan

- Caller: browser game client (events) and the operator's own AGS session
  (analytics reads).
- Token source: player access token in the browser; the operator's user token
  through the AGS MCP for Athena and dashboard calls.
- AGS calls: existing `POST /game-telemetry/v1/protected/events` only — no new
  game-client operation. Analytics uses `athena-facade-poc` queries, contexts,
  and pinned-queries under the operator's existing namespace roles.
- Verified access: telemetry ingestion unchanged from the 2026-07-28 slice;
  every analytics call in this slice ran and returned 200/201.

## Verification

- `npx vitest run`: 59 files, 516 tests passed.
- `npm run build`: TypeScript and production Vite build passed.
- `client/growth.test.ts` covers the bands, the return windows, milestone
  once-per-device behaviour across reloads, and storage being unavailable.
- `client/telemetry.test.ts` proves the three essential growth events send
  without consent, the seven optional ones do not, and that an exact Jade
  balance is rejected as a dimension.
- `client/App.telemetry.test.tsx` proves the session-start cohort dimensions,
  that a restored consent preference is not reported as a decision, and that
  `app_session_ended` fires once with its depth even if the tab hides twice.
- `client/App.analyticsConsent.test.tsx` proves the lobby ask appears only for
  a player with no recorded answer, that both answers are recorded with
  `surface: "first_run"` (a decline is a decision, not a default), and that
  answering either way closes the card and stores the decision.
- Six pins created and the dashboard opened against live data.
- No AGS namespace configuration, IAM permission, or player data was mutated.

## Risks and controls

- **Optional events stay invisible until consent improves.** Seven of the ten
  new events are consent-gated, and today's consent rate is close to zero. The
  events are correct and will populate the moment that changes; until then the
  dashboard deliberately stands on essential events only.
- **Each event name creates a Glue table.** Adding names is cheap to write and
  permanent in the catalog — keep the set small and prefer a new dimension over
  a new name.
- **`app_session_ended` latches on first hide.** It undercounts a player who
  tabs away and comes back. Recorded in the context document so nobody reads
  average session length as time-to-close.
- **Milestones are device-local.** A player on a second browser re-reaches
  them, which inflates first-time counts slightly. The safe direction: a
  returning player is never miscounted into a first-time cohort.
- **`year >= '2026'` in the pinned SQL** prunes partitions and does not go
  stale at the year boundary, unlike `year = '2026'`.

## Recommendations for the product team

1. ~~**Move the consent ask out of Settings.**~~ **Shipped.** The lobby now
   asks once, with both answers a single click and neither preselected. The
   default without an answer is unchanged, so this changes who gets asked, not
   what happens to someone who says no. Watch
   `analytics_consent_changed` grouped by `surface` to see what the ask
   actually earns — and note that a grant rate is only meaningful against the
   `offer` count, so read `granted` against `granted + declined`.
2. **The retention number to move is 73% one-and-done**, not DAU. DAU is
   downstream of it.
3. **Population is the matchmaking constraint.** At 1–4 concurrent players,
   four seats cannot fill; the online heatmap says where to concentrate the few
   players there are.

## Deferred requested integrations

- Server-authoritative growth events (match lifecycle, Jade settlement, XP
  award) still publish nothing to telemetry; the 2026-07-28 slice deferred them
  and they remain deferred.
- Pinning the six growth queries above, once their tables exist.
