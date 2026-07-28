# AGS Statistics for Achievements — Slice 1 Plan

- Date: 2026-07-28
- Requested feature: P2.2 launch achievements (§12.3), using AGS's native
  Achievement service in **incremental** mode
- This slice: the AGS Statistics values those achievements will consume
- Status: **plan only — not approved, no code written, no AGS state mutated**

## Why Statistics is the first slice

AGS incremental achievements unlock when a linked **Statistic** crosses a
`goalValue`. The namespace currently has **no stat definitions and no
achievements** (verified live, see Confirmed context), and this project has
never written a player Statistic to AGS — Jade, XP, and levels all live in our
own PostgreSQL. So the achievement config has nothing to hang off until stats
exist and are being written.

Dependency order per the AGS multi-slice gate: *Statistics before
statistic-backed achievement work when stats are the source data.*

## Confirmed context (discovered, not assumed)

| Fact | Evidence |
| --- | --- |
| Environment is Shared Cloud | Base URL is `gameswithout-mahjong.prod.gamingservices.accelbyte.io` (`gamingservices.accelbyte.io` marker) |
| No stat definitions exist | `ags social stat-definitions list` → "No stat definitions found" |
| No achievements exist | `ags achievement achievements list` → "No achievements found" |
| `social-sdk` already vendored | `mahjong-match-service/vendor/.../social-sdk/pkg/socialclient/user_statistic` |
| `achievement-sdk` already vendored | `mahjong-match-service/vendor/.../achievement-sdk` |
| v2 bulk update with strategies is available | `BulkUpdateUserStatItemV2Short`, supports `INCREMENT`/`MAX`/`MIN`/`OVERRIDE` |
| Every §12.3 pattern name is already emitted | `rulesengine/scoring.go` emits "All Pongs", "Full Flush", "Big Three Dragons", "Big Four Winds", "All Honors", "Half Flush", "Eight Flowers", "Robbing an Added Kong", "Win After Replacement", "Last Tile Zimo", "Concealed Zimo", "Three/Four/Five Concealed Pongs", "Complete Seasons", "Complete Flowers" |
| Per-hand outcome data already computed | `progression.HandOutcome` carries `Won`, `Zimo`, `RawTai`, `Kongs`, `Practice`, `TakenOverMajority` |
| Established server→AGS call pattern | `pkg/economy/ags_wallet.go` (`AGSWalletMirror`): confidential client, `repository.TokenRepository`, `auth.AuthInfoWriter` |

## Goal

Write authoritative per-player Statistics to AGS after every completed public
hand, so that slice 2 can configure incremental achievements against them
without any further gameplay tracking work.

## Non-goals

- Configuring the achievements themselves (slice 2).
- Any achievement UI (slice 3).
- Full Rotation-scoped achievements — that mode does not exist, same wall as
  P2.4. Explicitly deferred, not silently skipped.
- Replacing the existing XP/level system. Statistics is being added *alongside*
  our own progression ledger, not instead of it.

## Service Selection

- **Chosen:** AGS **Statistics** (`social` service) for the achievement source
  values, and AGS **Achievements** in slice 2.
- **Rejected — Cloud Save:** this is stat-driven integration data, not generic
  save/blob/preference JSON. §12.3 explicitly requires counters that feed
  achievement criteria; Cloud Save has no achievement integration.
- **Rejected — keeping counters only in our PostgreSQL:** that is what
  non-incremental achievements would have used. The user chose incremental, so
  AGS must own the values it evaluates.
- **Note:** our own `xp_awards` / `jade_hand_participation` tables remain the
  authoritative audit record. AGS Statistics is a *projection* for achievement
  evaluation, mirroring how `jade_wallet_sync` projects Jade into AGS Wallet.

## Proposed stat codes

All server-authoritative (`Set By: server`), all written by the match service.

**Counters (`INCREMENT`)**

| Stat code | Increments when | Feeds (§12.3) |
| --- | --- | --- |
| `public-hands-completed` | any completed public hand | First Hand, Hundred Hands, Centurion of the Table |
| `public-hands-won` | local seat is a winner | First Win |
| `zimo-wins` | win kind is `zimo` | Self Reliant, Self Reliant II |
| `kongs-declared` | per Kong in own melds | Kong Collector, Kong Master |

**Best-record (`MAX`)**

| Stat code | Set to | Feeds |
| --- | --- | --- |
| `highest-raw-tai` | winner's `raw_tai` | High Value (≥5), Master Craft (≥10) |

**Pattern wins (`INCREMENT`, goalValue 1 in slice 2)**

Driven by one mapping table from `score.patterns[].name` → stat code, so adding
a pattern achievement later is a data change, not a code change:
`wins-all-pongs`, `wins-full-flush`, `wins-half-flush`,
`wins-big-three-dragons`, `wins-big-four-winds`, `wins-all-honors`,
`wins-eight-flowers`, `wins-robbing-kong`, `wins-after-replacement`,
`wins-last-tile-zimo`, `wins-concealed-zimo`, `wins-concealed-pongs-3plus`,
`wins-complete-flowers-or-seasons`.

**Deferred (need tracking that does not exist yet):** Claim Student/Scholar
(Chow/Pong claim counts), Ready Regular/Veteran (Ting-reached detection),
Stone Wall (no-deal-in streak). These are real but out of this slice.

## Authorization preflight

```text
Caller:                game server (mahjong-match-service, Extend Service Extension)
Environment:           shared cloud
Environment evidence:  base URL gameswithout-mahjong.prod.gamingservices.accelbyte.io;
                       matches IMPLEMENTATION_PLAN deployment record
Token source:          service/server token (client credentials)
IAM client type:       confidential — AB_CLIENT_ID 72498bf13af54deabafdcba90d1ce497,
                       platform-provisioned, secret held as an Extend app secret
Secret location:       Extend deployment secret configuration only (never in repo/image)
AGS calls:             PUT /social/v2/admin/namespaces/{ns}/users/{userId}/statitems/value/bulk
                       (SDK: BulkUpdateUserStatItemV2Short)
                       slice 2 adds achievement config + unlock reads
Permission discovery:  AGS API MCP describe-apis — the v2 endpoint's spec entry does
                       NOT state a required permission string; the v1 sibling
                       likewise omits it. Not discoverable from the spec.
Required permissions:  Statistics/social user-statitem UPDATE — exact Shared Cloud
                       group NOT yet confirmed
Shared Cloud groups:   NOT CHECKED — `ags iam client-config list-permissions`
                       requires a browser user token (error 20022,
                       "Token is not a user token"); the client-credentials
                       secret available to this session cannot read the catalog
Verified access:       BLOCKED
```

**This is the gate on this slice.** The deployed runtime client's verified
permissions today are Session game-session READ and Platform Store/Wallet
READ + UPDATE (per the IMPLEMENTATION_PLAN permission block). Statistics is
**not** among them. Writing stats will return `403 / 20013 insufficient
permission` until that group is granted.

Two things must happen before implementation is worth starting:

1. Someone with a browser-authenticated AGS session runs
   `ags iam client-config list-permissions --exclude-permissions false` to
   resolve the exact Shared Cloud group for Statistics user-statitem UPDATE.
2. That group is granted to client `72498bf13af54deabafdcba90d1ce497`, and the
   IMPLEMENTATION_PLAN permission block is updated in the same change.

## Required AGS Admin Portal / CLI setup

Before code can pass, each stat code above must exist as a stat definition
(`ags social stat-definitions create`, or the Admin Portal Statistics page)
with: server-only `setBy`, `incrementOnly` where appropriate, a sane
`minimum`/`maximum`, and `defaultValue: 0`.

**TIED-configuration risk:** once player data is attached, these configs become
`TIED` and structural edits become migration-sensitive — deleting one can wipe
associated user stats. Get the stat code names and bounds right the first time.

## Implementation steps (not started)

1. `pkg/progression/stats.go` — pure mapping from `HandOutcome` +
   `score.patterns` to a list of `{statCode, updateStrategy, value}`. Unit
   tested with no network, same shape as `HandXP`.
2. `pkg/progression/ags_stats.go` — `AGSStatsMirror`, mirroring
   `AGSWalletMirror`'s construction and auth exactly.
3. Wire into the existing `RecordHand` path so stats are written from the same
   place XP is awarded, reusing its `(user, match)` idempotency.
4. Batch into **one** `BulkUpdateUserStatItemV2Short` call per hand — the API
   docs warn bulk entries are processed concurrently and must not repeat a
   `statCode`; the mapping must therefore emit each code at most once.
5. Failure isolation: a stats write failure must **not** fail the hand or the
   XP award. Follow the wallet mirror's precedent — record and retry, never
   block settlement.

## Verification

- Unit: the pure mapping, including "no duplicate statCode in one batch" and
  "Practice produces no public stats".
- Integration: existing Postgres suite unaffected.
- Live: extend `scripts/verify-live-progression.mjs` to read stats back after a
  real hand — the same script that proved XP live.

## Risks and open questions

1. **Permission is unresolved and unverifiable from this session.** Highest
   risk; blocks everything.
2. **Practice must not write public stats.** §11.4 says Practice grants no
   achievements. The mapping must gate on `!Practice`, and a test must pin it.
3. **Backfill.** Players who have already played get no retroactive stats.
   §12.3 says counters are event-log derived and corrected historical events
   update counters — a true backfill would replay `xp_awards`/participation
   rows. Out of scope here; flagged as a real follow-up.
4. **Double-count risk on re-projection.** `RecordHand` is called on every poll
   of a finished hand. The XP path is idempotent by award ID; the stats path
   must ride that same guard or it will increment forever.
5. **`TIED` configs are hard to change.** Naming is effectively one-way.

## Next step

Resolve the permission gap (items 1–2 under Authorization preflight), then
return here for Game Flow Plan approval.

## Deferred Requested Integrations

- [ ] Slice 2: configure the §12.3 achievements as AGS incremental
      achievements against these stat codes.
- [ ] Slice 3: achievement UI — progress display and unlock notification.
- [ ] Claim-count, Ting-reached, and no-deal-in-streak tracking for
      Claim Student/Scholar, Ready Regular/Veteran, and Stone Wall.
- [ ] Full Rotation achievements (Full Rotation Regular, Clean Defense,
      Rotation Master, Podium Regular) — blocked on the Full Rotation mode.
- [ ] Retroactive backfill of stats from the existing event log.
