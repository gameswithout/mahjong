# Matchmaking Discovery Evidence — 2026-07-17

- Status: Minimal configuration created and verified
- Plan: [Matchmaking ticket lifecycle plan](./2026-07-17-matchmaking-ticket-lifecycle.md)
- Namespace: `gameswithout-mahjong`
- Title-level host:
  `https://gameswithout-mahjong.prod.gamingservices.accelbyte.io`

## Discovery and configuration results

```text
match-pools list (before): data=null, pagination empty
rule-sets list (before): data=null, pagination empty
match-functions list: functions=basic, default; configs=null
match-functions get default: 520308 Match function not found
matchmaking config get: 20013 insufficient permission
rule-sets get mahjong-test-rules: alliance 1x4, rebalance disabled
match-pools list mahjong-test-pool: default function, mahjong-test-none,
  ticket expiry 300s, backfill ticket expiry 300s, proposal expiry 30s
```

The title-level operator session was restored to the publisher-level tooling
host after configuration. No custom match function or ticket was created.

## Interpretation

The title namespace now has a verified queue configuration. It references the
existing `mahjong-test-none` Session template and the native `default` match
function. The current CLI contract catalog still has no public ticket-create
method, so the browser API/SDK contract is the remaining implementation gate.

## Next Required Decision

The browser ticket create/status/cancel adapter and one-player queued-ticket
smoke are now complete. See
[ticket lifecycle evidence](./2026-07-17-matchmaking-ticket-lifecycle-evidence.md).
Four players are required to form a match with the test ruleset.
