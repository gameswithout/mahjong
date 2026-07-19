# Game Flow Plan — Session Create and Join

- Date: 2026-07-17
- Status: Implemented — browser confirmation pending
- P1 slice: create one Mahjong game session, join by session ID, and render the
  authoritative roster

## Proposed Feature

The IAM, Lobby, and read-only Session lookup slices are complete. The next
player-facing slice would let a signed-in player create a Mahjong table from a
verified AGS Session configuration template, then let another signed-in player
join that table by its session ID. The UI would refresh the authoritative
roster after each operation.

This plan deliberately stops at Session membership. It does not submit
matchmaking tickets, claim an AMS server, or start game travel.

## Configuration Gate — Satisfied

AGS Session creation requires a configuration name plus topology and capacity
decisions. The project owner authorized creation of the test template
`mahjong-test-none` and selected the non-DS defaults below. The template was
created through the title-level AGS host; the CLI profile was then restored to
the publisher-level tooling host.

## Required Game Decisions

| Decision | Current requirement |
| --- | --- |
| Session topology | Selected test default: `NONE` (no DS provisioning or travel) |
| Configuration template | `mahjong-test-none` |
| Joinability | Selected test default: `OPEN` |
| Capacity | Selected test default: `maxPlayers: 4`, `minPlayers: 1` |
| Client version | `web-0.0.0` |
| Leave/cleanup | Confirm whether the creator leaves explicitly or the test table is allowed to expire |

The project owner selected the non-DS test defaults: `NONE` topology,
`maxPlayers: 4`, `minPlayers: 1`, `OPEN` joinability, template
`mahjong-test-none`, and client version `web-0.0.0`.

## Confirmed Context

- Browser/game-title host:
  `https://gameswithout-mahjong.prod.gamingservices.accelbyte.io`.
- Tooling/API host:
  `https://gameswithout.prod.gamingservices.accelbyte.io`.
- Namespace: `gameswithout-mahjong`.
- Browser IAM client: public client `dc7a13b683c44822905797a8d1df39e7`.
- The player token remains in memory only.
- The current live Session `list-my` smoke returns HTTP 200 with no active
  sessions.
- CLI metadata identifies the public create and join operations, but the
  publisher-level template list is blocked by `20030 subdomain mismatch`.
- A read-only template listing against the title-level host returned an empty
  list; no Session template currently exists for this namespace.
- The authorized template create succeeded on the title-level host; its
  resulting configuration is `NONE` / `OPEN` / 4 max players / 1 min player,
  with 60-second invite and inactive timeouts.

## Goal

After `Lobby connected`, the UI exposes:

- **Create table**: creates one session using the owner-approved template and
  renders a safe session ID plus the creator's membership.
- **Join table**: accepts a session ID, calls AGS join, and renders the updated
  roster.
- **Refresh roster** and **Leave table**: read/leave the same authoritative
  session without duplicating WebSockets or persisting credentials.

Recoverable errors must identify configuration, authorization, not-found, full,
or network failures without rendering raw AGS responses.

## Non-Goals

- Matchmaking queues, tickets, backfill, or reservations.
- Dedicated-server provisioning, AMS claims, NAT, or game travel.
- Lobby party/invite/chat UI.
- Session template mutation unless separately authorized and planned.
- Match actor, Mahjong rules, or persistent game state.

## AGS Operations and Authorization

| Operation | Endpoint | CLI-discovered permission |
| --- | --- | --- |
| Create | `POST /session/v1/public/namespaces/{namespace}/gamesession` | `NAMESPACE:{namespace}:SESSION:GAME [CREATE]` |
| Join | `POST /session/v1/public/namespaces/{namespace}/gamesessions/{sessionId}/join` | `NAMESPACE:{namespace}:SESSION:GAME:PLAYER [CREATE]` |
| Leave | `POST /session/v1/public/namespaces/{namespace}/gamesessions/{sessionId}/leave` | Verify with `ags describe` before implementation |
| Roster | `GET /session/v1/public/namespaces/{namespace}/gamesessions/{sessionId}` | `NAMESPACE:{namespace}:SESSION:GAME [READ]` |

All player calls use the in-memory player bearer token and title-level host.
The confidential CLI client or service token must not be used in the browser.
Any 403 is surfaced as an authorization/configuration outcome, not bypassed.

## Affected Areas (after approval and configuration)

- Extend `client/session.ts` with typed create/join/leave request and response
  mapping, or install a compatible first-party browser Session SDK if one is
  confirmed.
- Add the create/join/leave controls and session lifecycle states to
  `client/App.tsx`.
- Add safe input validation for session IDs and explicit configuration errors.
- Add unit tests for request payloads, mapping, full/not-found/forbidden
  responses, retry, and cleanup.
- Record live service and browser game-flow evidence.

## Completion Contract

### Success

- The owner-approved template and topology are verified.
- A signed-in player creates a session and sees a safe session ID.
- A second player joins that session by ID.
- Both clients can refresh and see the authoritative roster.
- Leave/cleanup is explicit and does not leak credentials.

### Error

- Missing template/configuration is shown as a setup error before any create
  request is attempted.
- Full, not-found, forbidden, expired, and network responses map to stable safe
  codes.
- No raw token, client secret, operator credential, or response body is logged
  or rendered.

### Evidence

- Read-only template/configuration evidence is recorded before code changes.
- A live create, join, roster refresh, and leave smoke is recorded with IDs and
  credentials redacted.
- Browser flow is manually verified from Lobby through roster membership.

## Implementation Gate

The project owner approved the defaults, authorized template creation, and
confirmed the browser create/join/roster flow. Matchmaking and AMS remain
separate plans.

## Implementation Result

- Added typed create, join, leave, and roster operations in
  `client/session.ts`.
- Added browser controls for **Create test table**, **Join**, and **Leave
  table**, using the configured template and client version.
- Added automatic three-second roster refresh plus a manual **Refresh roster**
  action so existing session views observe later joins.
- Added `ACCELBYTE_SESSION_TEMPLATE` and
  `ACCELBYTE_SESSION_CLIENT_VERSION` to the browser runtime configuration.
- Added request/response/error tests; `npm test` passes 13 tests.
- `npm run build` and `git diff --check` pass.
- Live player-token create/detail/leave smoke passed with statuses `201` /
  `200` / `204`; see the [Session create/join evidence](./2026-07-17-session-create-join-evidence.md).
- Status: Complete.
