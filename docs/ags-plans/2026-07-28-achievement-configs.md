# §12.3 Achievement Configurations — Slice 2 Reference

- Date: 2026-07-28
- Requires: a publisher-level user token (see "Who can create these")
- Stat definitions these depend on: **already live** (created 2026-07-28)

All 18 stat codes referenced below exist in the namespace and are being
written by the match service as of `b0d51c6`. Only the achievement
configurations themselves are missing.

## Who can create these — resolved 2026-07-28

Achievement configuration is a **publisher-namespace admin operation**. It
needs a publisher-level user token on the publisher subdomain; the
game-namespace confidential client cannot do it at all.

That was worth pinning down because every failure mode points somewhere else:

| Caller | Host | Result |
| --- | --- | --- |
| Client token | `gameswithout-mahjong.prod…` | `20013` insufficient permission |
| Client token | `gameswithout.prod…` | `20030` subdomain mismatch |
| User token | `gameswithout-mahjong.prod…` | `20030` subdomain mismatch |
| **User token** | **`gameswithout.prod…`** | **201 Created** |

The `20013` is the misleading one. `g_achievements` CREATE *was* granted to
client `373617a151fe4d3f92be11f4a045cba5` — verified as `selectedActions
[1,2,4,8]` on the client object — and creation still failed with the same
"insufficient permission" error. The permission was never the problem; the
caller's namespace level was. Granting more to that client will not help.

Statistics is different and does work from the client, which is why slice 1
landed: `m_statistics / g_user_statistics_value` already carries `[1,2,4,8]`.

`scripts/create-achievements.sh` therefore takes `AGS_ADMIN_TOKEN`, a
publisher user token, and calls the REST API on the publisher subdomain.
Tokens last one hour.

## Creatable now — 23 achievements

Every one of these is `incremental: true`, `hidden: false`,
`defaultLanguage: "en"`. `goalValue` is the AGS unlock threshold.

| Achievement | `achievementCode` | `statCode` | `goalValue` | §12.3 reward |
| --- | --- | --- | ---: | --- |
| First Hand | `first-hand` | `public-hands-completed` | 1 | 100 XP |
| First Win | `first-win` | `public-hands-won` | 1 | 200 XP, "First Victory" title |
| Self Reliant | `self-reliant` | `zimo-wins` | 10 | 300 XP |
| Self Reliant II | `self-reliant-ii` | `zimo-wins` | 50 | 750 XP |
| Kong Collector | `kong-collector` | `kongs-declared` | 25 | 300 XP |
| Kong Master | `kong-master` | `kongs-declared` | 100 | 750 XP |
| Hundred Hands | `hundred-hands` | `public-hands-completed` | 100 | 500 XP |
| Centurion of the Table | `centurion-of-the-table` | `public-hands-completed` | 500 | 1,000 XP, "Centurion" title |
| High Value | `high-value` | `highest-raw-tai` | 5 | 300 XP |
| Master Craft | `master-craft` | `highest-raw-tai` | 10 | 750 XP |
| All Pongs | `all-pongs` | `wins-all-pongs` | 1 | 500 XP, "Pong Specialist" title |
| Pure Hand | `pure-hand` | `wins-full-flush` | 1 | 750 XP, Pure Hand frame |
| Half and Half | `half-and-half` | `wins-half-flush` | 1 | 300 XP |
| Dragon Caller | `dragon-caller` | `wins-big-three-dragons` | 1 | 1,000 XP, "Dragon Caller" title |
| Four Winds | `four-winds` | `wins-big-four-winds` | 1 | 1,500 XP, Four Winds frame |
| Honor Guard | `honor-guard` | `wins-all-honors` | 1 | 1,000 XP, "Honored" title |
| Eightfold Bloom | `eightfold-bloom` | `wins-eight-flowers` | 1 | 1,500 XP, "Eightfold" title |
| Kong Robber | `kong-robber` | `wins-robbing-kong` | 1 | 500 XP |
| Replacement Artist | `replacement-artist` | `wins-after-replacement` | 1 | 300 XP |
| Last Chance | `last-chance` | `wins-last-tile-zimo` | 1 | 500 XP |
| Quiet Strength | `quiet-strength` | `wins-concealed-zimo` | 1 | 300 XP |
| Three of a Mind | `three-of-a-mind` | `wins-concealed-pongs` | 1 | 500 XP |
| Garden Party | `garden-party` | `wins-complete-flowers` | 1 | 500 XP |

Two pairs deliberately share a stat code with different goals — Self Reliant
I/II on `zimo-wins`, Kong Collector/Master on `kongs-declared`, High
Value/Master Craft on `highest-raw-tai`, and three tiers on
`public-hands-completed`. That is how §12.3's numbered progressions are meant
to work, and AGS unlocks each independently as the value climbs past its own
goal.

## Blocked — 9 achievements

Not creatable, and the reason is not the permission:

| Achievement | Blocker |
| --- | --- |
| Claim Student (50 claims) | No Chow/Pong claim counter is tracked |
| Claim Scholar (250 claims) | Same |
| Ready Regular (Ting in 100 hands) | No "reached Ting" detection per hand |
| Ready Veteran (Ting in 500 hands) | Same |
| Stone Wall (no-deal-in streak of 10) | No deal-in or streak tracking |
| Full Rotation Regular (10 matches) | Full Rotation mode does not exist |
| Clean Defense (a Full Rotation with no deal-in) | Same |
| Rotation Master (50 matches) | Same |
| Podium Regular (1st in 10 matches) | Same |

The first five need new per-hand tracking, following the same pattern
`stats.go` already uses. The last four are blocked on the Full Rotation game
mode, the same wall as P2.4 competitive progression.

## The XP rewards are not wired

§12.3 attaches XP to every achievement, but **AGS will not award it**. Our XP
lives in our own PostgreSQL (`player_xp` / `xp_awards`), so an AGS unlock
grants a badge and nothing else until something reads unlocks back and awards
the XP through `AwardXP`.

The `customAttributes: {"xp": N}` field in the JSON below carries each
achievement's XP value so that follow-up has the number to work from without
re-deriving it from the spec. Wiring it is not in this slice.

## Creating them

```shell
AGS_ADMIN_TOKEN=eyJ... scripts/create-achievements.sh
```

Creates all 23 in one run, safe to re-run — an existing code returns 409 and is
reported as "exists" and skipped.

**Status: 1 of 23 created.** `first-hand` exists; the token expired partway
through the first run, so the remaining 22 still need a fresh token.

For the Admin Portal instead, the table above has every field; leave icons
empty and tag them `launch`.
