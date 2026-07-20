# Game Flow Plan — Production Seating and Match Durability Spike

- Date: 2026-07-18
- Status: Approved and deployed 2026-07-19 — user directed deployment ahead
  of the append-latency benchmark and go/no-go decision record this plan
  originally required (see "Decision record required from the spike" and
  "Approval gate" below, and `mahjong-match-service/IMPLEMENTATION_PLAN.md`'s
  "Deployment record" for what's live and what's still unverified).
- Boundary: replace local connection-order seats and JSONL events with
  production-authoritative membership, randomized seating, and durable storage

## Confirmed context

- AGS Session Management already owns game-session membership and exposes the
  roster through the title namespace.
- The local runtime authenticates browser connections with AGS IAM, owns the
  Mahjong rules actor, persists append-before-ack events, and emits per-seat
  redacted views.
- The current `Runtime` assigns E/S/W/N by first connection and loses those
  bindings on restart. This is test infrastructure, not a production authority.
- Product rules require exactly four occupied seats, a uniformly randomized
  initial seat/dealer assignment, and stable reconnect to the same seat.
- `FileEventStore` proves the storage contract locally but does not satisfy
  production replication, backup, regional recovery, or operational metrics.

## Goal

For a formed four-player AGS Session, the match service:

1. authenticates the caller through IAM;
2. verifies that the caller belongs to the exact AGS Session roster;
3. creates one CSPRNG-randomized E/S/W/N assignment from that fixed roster;
4. durably commits the roster, seat assignment, rules version, seed commitment,
   and initial actor state before any player receives a hand;
5. restores the same seats and actor state after a process restart; and
6. rejects non-members, roster mismatches, duplicate initialization, and
   attempts to join a fifth player.

## Non-goals

- Deploying before the storage/latency spike has a written verdict.
- Trusting browser-supplied user IDs, seat requests, roster order, or teams.
- Using AGS Session member-array order as seat order.
- Using Cloud Save as an ordered gameplay event log.
- Lobby notification transport, bots, settlement, or regional failover.
- Mutating the live namespace during the discovery-only phase.

## Service selection

- **Membership authority:** AGS Session Management.
- **Player identity:** AGS IAM.
- **Rules and seat randomization:** the custom Mahjong match actor; AGS does not
  provide Taiwanese Mahjong seating/rules semantics.
- **Durability candidate:** an Extend app-owned transactional store capable of
  an atomic conditional match-create and ordered synchronous event append.
- **Rejected substitute:** Cloud Save, because generic document persistence
  does not provide the required single-writer sequence, append-before-ack
  contract, snapshot/event transaction boundary, or replay operations.
- **Fallback:** self-hosted transactional Postgres behind the same Go ports if
  the Extend storage candidate misses correctness or latency gates.

## Authorization Plan

| Field | Decision |
| --- | --- |
| Browser caller | Public AGS client with an in-memory player user token |
| Match-runtime caller | Confidential server/Extend workload identity |
| Player verification | Existing `GET /iam/v3/public/users/me` flow |
| Session verification | Server-side read of the exact AGS game session; endpoint and permission must be discovered and live-verified before implementation |
| Browser secret | None |
| Server secret | Managed deployment secret/workload configuration only; never repository, browser bundle, log, or event payload |
| Required AGS permission | Least-privilege Session game-session read; exact resource/action pending CLI/API discovery |
| Gameplay calls | Custom match runtime only after membership and seat binding succeed |

The production resolver must not elevate a player token into an operator flow.
If a service token is required for authoritative Session lookup, that token is
obtained and stored only by the server workload.

## Proposed ports

- `SessionRosterResolver.Resolve(ctx, sessionID) -> fixed four-user roster`
- `SeatAssignmentStore.CreateOnce(ctx, matchID, rosterHash, assignment)`
- `SeatAssignmentStore.Get(ctx, matchID)`
- existing `EventStore.Append/Events`

`CreateOnce` must be conditional and idempotent. Concurrent initialization may
produce only one committed assignment. The assignment record includes a
canonical roster hash so a later AGS roster mismatch fails closed instead of
silently reseating players.

## Implementation steps after approval

1. Use AGS CLI/API discovery to identify the least-privilege server-side
   Session detail operation and verify it with a service token.
2. Capture only safe response-shape evidence: session ID, status, member count,
   and canonical member-ID hash.
3. Add the roster resolver interface and contract tests for exact membership,
   four-player cardinality, duplicate IDs, and status gating.
4. Add unbiased CSPRNG seat permutation and deterministic persisted restore
   tests; do not derive seats from member or connection order.
5. Add a durable assignment record and make match creation conditional on it.
6. Implement and benchmark an Extend app-owned event/assignment adapter.
7. Run crash-after-append, concurrent-create, replay-hash, and reconnect tests.
8. Wire the resolver into `match.join`, retaining the local resolver behind an
   explicit development-only configuration.
9. Deploy to a non-production environment only after the spike passes.

## Verification gates

- Four Session members map to one uniformly generated seat permutation and
  retain it across restart.
- A non-member and a fifth member receive stable authorization errors without
  state creation.
- Concurrent initializers commit exactly one roster/assignment.
- Accepted command RPO is zero in forced process termination tests.
- Recovery reconstructs byte-equivalent per-seat projections from snapshot and
  later events.
- No access token, client secret, concealed tile, full wall, or another seat's
  private claim appears in logs or public payloads.
- Measured append acknowledgement and state broadcast latency meet the product
  targets in the intended deployment regions.

## Decision record required from the spike

- exact AGS Session operation and permission;
- selected service-token/workload-identity flow;
- selected Extend storage technology and transaction model — **decided**:
  AGS Extend's managed SQL cluster offering (AWS RDS Aurora Postgres), not
  the self-hosted Postgres fallback;
- append p50/p95/p99 and cross-region result — **not measured**; deployment
  went ahead without this;
- snapshot/recovery timing — not measured against the live cluster;
- backup/restore and retention capability — not evaluated;
- go/no-go verdict — **superseded**: the user directed deployment directly
  rather than waiting for a written verdict on the above. Treat the
  unmeasured items as open production risk, not as answered questions.

## Approval gate

This plan originally recorded the next recommended boundary only, with AGS
configuration, server client permissions, storage provisioning, and
deployment withheld until user approval. **That approval was given
2026-07-19**, and `mahjong-match-service` is now deployed to AGS Extend
(namespace `gameswithout-mahjong`) — see
`mahjong-match-service/IMPLEMENTATION_PLAN.md`'s "Deployment record". The
approval was explicit about proceeding ahead of the latency benchmark and
full Session smoke test; those remain open follow-up work, not resolved
by the deployment itself.
