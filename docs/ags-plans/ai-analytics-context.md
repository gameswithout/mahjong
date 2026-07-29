# AI Analytics context — Mahjong

Context file for [AGS AI Analytics](https://docs.accelbyte.io/gaming-services/modules/ai-analytics/).
Point an MCP-connected assistant at the `gameswithout-mahjong` namespace with
this file loaded, and its answers become game-specific instead of generic.

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
question should be asked in. A **match** is currently one hand.

Two modes exist, and mixing them makes most answers wrong:

- **Practice** (`mode=practice`) — solo against three bots. Changes no Jade, no
  rating, no progression, and no statistics. Exclude it from anything about
  player performance or economy.
- **Quick Play** (`mode=quick_play`) — four humans, real stakes and
  progression. This is the mode that matters.

Full Rotation is named in the product spec but **is not playable**. Any
telemetry suggesting otherwise is a bug, not a feature launch.

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
  Every behavioural event below is optional; treat gaps as consent, not as
  absence of play.
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

## Questions worth asking

- Deal-in rate by account level — does the game actually teach defence?
- Ting rate against win rate — are players reaching Ting and still losing?
- Tutorial step drop-off, and whether players who skip it deal in more.
- Queue abandonment against `queue_threshold_reached`, split by hour.
- `wall_remaining` distribution on draws — are hands ending exhausted or early?

## Traps

- **Practice pollutes everything.** It is most of the hands played and none of
  the stakes. Filter it out unless the question is about Practice.
- **A hand is not a match is not a session.** One tab can play many hands.
- **Percentages need a stated denominator.** The dashboard withholds a rate
  below twenty hands for this reason; apply the same restraint here.
- **Takeover seats.** A player disconnected for most of a hand still completes
  it, and their outcome reflects a bot's play, not theirs.
