# Game Flow Plan — Matchmaking Ticket Lifecycle

- Date: 2026-07-17
- Status: Implemented — four-player match/join/roster/leave API flow verified; browser click-through pending
- P1 slice: enter a configured matchmaking queue, observe ticket status, and
  cancel safely

## Recommendation

Session IAM, Lobby, and create/join/roster are now verified. The next
dependency-ordered slice is a small Matchmaking ticket lifecycle, not AMS
server travel. It proves that a player can enter a Mahjong queue and leave it
without pretending that a match or game server exists.

## Proposed Feature

After `Lobby connected`, the browser exposes **Find a table** for an
owner-approved matchmaking pool. The UI renders:

- `Queue unavailable` when the pool/ruleset is not configured;
- `Joining queue…` while the ticket is created;
- `Searching for players` with a safe ticket status and Cancel action;
- `Match found` only when AGS returns a formed match/session reference; and
- `Queue error` with a safe Retry action.

The first smoke is allowed to remain queued with one player and then be
cancelled. It does not fabricate a match or open a game table.

## Minimal test configuration

The title namespace now has a minimal test ruleset and pool referencing the
verified Session template (`mahjong-test-none`). This is intentionally a
native, no-Extend configuration for ticket lifecycle testing only.

| Resource | Value |
| --- | --- |
| Ruleset | `mahjong-test-rules` |
| Match shape | one alliance of exactly four players |
| Matching criteria | none (native default function) |
| Rebalance | disabled |
| Match pool | `mahjong-test-pool` |
| Match function | `default` (built-in) |
| Session template | `mahjong-test-none` |
| Ticket expiration | 300 seconds |
| Backfill ticket expiration | 300 seconds |
| Backfill proposal expiration | 30 seconds |
| Auto-accept backfill | false |
| Platform grouping | disabled |

This configuration is suitable for a one-player smoke because a ticket remains
queued until it is cancelled; it will not form a match until four compatible
players are present.

## Confirmed AGS Metadata

- Matchmaking service exposes match pools, rule sets, match functions, and
  match tickets.
- Public ticket operations discovered:
  `GET /match2/v1/namespaces/{namespace}/match-tickets/me`,
  `GET /match2/v1/namespaces/{namespace}/match-tickets/{ticketid}`, and
  `DELETE /match2/v1/namespaces/{namespace}/match-tickets/{ticketid}`.
- The current CLI catalog does not expose a public ticket-create method;
  ticket creation must be verified through the installed/available browser SDK
  or the current AGS Matchmaking API contract before code changes.
- Admin pool and ruleset listing require namespace Matchmaking permissions and
  must use the operator/tooling path, never a browser service token.

## Discovery Result

- Title-level match-pool listing returned `data: null` before the mutation;
  `mahjong-test-pool` now reads back successfully.
- Title-level ruleset listing returned `data: null` before the mutation;
  `mahjong-test-rules` now reads back successfully.
- Match-function listing exposed built-in names `basic` and `default`, but a
  detail lookup for `default` returned `520308 Match function not found`; no
  configured function endpoint was verified.
- Matchmaking service configuration read returned `20013` insufficient
  permission for the current operator role.
- The current CLI catalog exposes ticket read/get/delete but no public ticket
  create method. The create route/SDK must be verified during implementation.

The backend configuration prerequisite and one-player create/status/cancel
smoke are complete. Browser click-through remains for the final evidence step.

## Authorization Plan

| Field | Decision / evidence |
| --- | --- |
| Caller | Browser game client with the signed-in player's bearer token |
| Browser host | `https://gameswithout-mahjong.prod.gamingservices.accelbyte.io` |
| Namespace | `gameswithout-mahjong` |
| Player read | `NAMESPACE:{namespace}:MATCHMAKING:TICKET [READ]` |
| Player delete | `NAMESPACE:{namespace}:MATCHMAKING:TICKET [DELETE]` |
| Player create | Not exposed by the current CLI catalog; discover and verify before implementation |
| Admin discovery | Operator profile against the title-level host, with credentials kept outside the repo |
| Token handling | In-memory player token only; no persistence or raw response logging |

Any 401/403/configuration failure is surfaced honestly. A confidential client
or AGS operator token must never be bundled into the browser.

## Non-Goals

- Matchmaking Override or Extend implementation.
- Ranked eligibility, rating bands, dodge cooldowns, or recent-opponent rules.
- Session creation beyond the pool's configured template.
- AMS claims, dedicated-server readiness, NAT, travel, or game connection.
- Mahjong table/rules runtime.

## Affected Areas (after configuration and approval)

- New typed `client/matchmaking.ts` adapter for ticket create/status/cancel.
- `client/App.tsx` queue controls, match-found handling, and explicit Session
  join action. **Done.**
- `client/styles.css` queue panel and safe error states. **Done.**
- Browser runtime configuration for the owner-approved pool name. **Done.**
- Unit tests for payload mapping, status mapping, cancel, timeout, and
  stale-request cleanup. **Done for adapter/error mapping.**
- Live and manual game-flow evidence.

## Completion Contract

### Success

- A configured pool is discovered and its session template is verified.
- Player selects **Find a table** and receives a ticket or a documented
  configuration/permission result.
- Ticket status can be refreshed without leaking IDs/tokens.
- Player can cancel the ticket and returns to an idle queue state.
- A formed match is shown only when AGS supplies one.

### Error

- Missing pool/ruleset/match function is a setup error before ticket creation.
- Unauthorized, full/closed, expired, malformed, and network outcomes map to
  stable safe codes.
- No raw ticket payload, client secret, or operator credential is rendered.

### Evidence

- Pool/ruleset/match-function discovery and configuration are recorded.
- One-player create/status/cancel and four-player match-found/session
  join/roster/leave smokes are recorded in the evidence document.
- Browser flow is manually verified from Lobby through cancellation.

## Approval Gate

The user authorized AGS configuration mutations. The mutation created only the
ruleset and pool above; no custom Matchmaking Override, match formation, AMS
allocation, or dedicated-server work was performed.
