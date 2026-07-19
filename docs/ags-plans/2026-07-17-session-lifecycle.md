# Game Flow Plan — Session Membership and Roster Lookup

- Date: 2026-07-17
- Status: Complete
- P1 slice: read-only Session membership/roster lookup after Lobby connection

## Approved Feature

The IAM and Lobby slices are complete. The next player-facing slice is a
read-only Session view for the signed-in browser player. After Lobby reaches
`connected`, the player can select **View my sessions** to query their current
AGS game-session memberships and inspect the roster for a returned session.

This slice is intentionally read-only. It does not create or join a session,
submit matchmaking tickets, claim an AMS server, or travel the game client.

## Confirmed Context

- Repository: React + TypeScript PWA using Vite.
- Browser/game-title base URL:
  `https://gameswithout-mahjong.prod.gamingservices.accelbyte.io`.
- Tooling/API base URL:
  `https://gameswithout.prod.gamingservices.accelbyte.io`.
- Namespace: `gameswithout-mahjong`.
- Browser IAM client: public client `dc7a13b683c44822905797a8d1df39e7`.
- Player access token is issued by Device ID login and kept in memory.
- Lobby is live-verified; the user confirmed the browser state `Lobby connected`.
- AGS CLI discovery identifies the public Session operations `list-my` and
  `get`. The CLI template listing was not used for mutation and returned
  `20030 subdomain mismatch` against the publisher-level host, so no Session
  template or other Admin Portal configuration is assumed.

## Goal

When the player is signed in and Lobby is connected, the UI exposes a visible
**View my sessions** action. The action shows one of these explicit outcomes:

- `Loading sessions…`
- `No active sessions`
- a session summary with membership status and a roster, when AGS returns one
- `Session lookup failed` with a safe Retry action

The UI must never render access tokens, client secrets, raw response bodies, or
untrusted session metadata without a typed/safe mapping.

## Non-Goals

- Creating a game session or requiring a Session configuration template.
- Joining, leaving, accepting an invite, or changing membership.
- Matchmaking ticket submission or match-found handling.
- Dedicated-server or P2P travel, AMS, NAT, or voice integration.
- Party/session chat or persistent game data.
- Admin Portal configuration mutation.

## Affected Areas

- New typed `client/session.ts` adapter for the player Session REST calls.
- `client/App.tsx` for the post-Lobby session trigger and visible result states.
- `client/styles.css` for the compact session/roster panel.
- Unit tests for success, empty result, safe error mapping, and cleanup/retry.
- Session evidence and verification documentation.
- First-party Session SDK dependency only if the installed SDK catalog exposes
  a compatible browser package; otherwise use a narrow typed `fetch` adapter
  over the documented public endpoints.

## AGS Modules

- IAM (existing prerequisite only).
- Lobby (existing prerequisite and UI gate).
- Session Management / Game Sessions.

## Service Selection

**Selected:** AGS Session Management public game-session endpoints.

Session Management owns game-session membership and roster state. Cloud Save
must not be used as a substitute for authoritative membership, and Lobby must
not be used to infer game-session rosters.

## Authorization Plan

| Field | Decision / evidence |
| --- | --- |
| Caller | Game client: browser-based PWA |
| Environment | Shared Cloud |
| Environment evidence | Browser uses the title-level host; CLI/MCP tooling uses the publisher-level host; both target `gameswithout-mahjong` |
| Token source | Authenticated player's in-memory IAM access token |
| IAM client type | Public; `dc7a13b683c44822905797a8d1df39e7` |
| Planned AGS call | `GET /session/v1/public/namespaces/{namespace}/users/me/gamesessions` |
| Optional detail call | `GET /session/v1/public/namespaces/{namespace}/gamesessions/{sessionId}` |
| Permission discovery | `ags describe session game-sessions list-my --format json`; `ags describe session game-sessions get --format json` |
| Required permissions | `list-my` exposes no separate client permission; `get` is documented with `NAMESPACE:{namespace}:SESSION:GAME [READ]` and must be verified with the player token on the title-level host |
| Client secret | None; no confidential credential enters the browser |

The implementation will use the existing player bearer token only. Any
permission failure is surfaced as a safe status and is not worked around with
an operator/service token.

## Required AGS Setup Before Implementation

No new Admin Portal mutation is required for the read-only `list-my` call. A
Session configuration template is only needed for a future create/join slice.
If AGS returns no memberships, the expected UI is `No active sessions`, not a
synthetic session.

## Player Entry And UI Surface

- Trigger: **View my sessions** appears only after `Lobby connected`.
- Loading: disable the trigger while the request is in flight.
- Empty: show `No active sessions` and a retry/refresh action.
- Success: show a safe session ID fragment, membership status, and roster names
  or IDs returned by the typed mapper; never show raw JSON.
- Error: show a stable `session_*` code and Retry without logging credentials.
- Cleanup: ignore late responses after the component unmounts or a newer lookup
  starts.

## Completion Contract

### Success

- IAM player token is already issued and proved.
- Lobby is connected.
- The player invokes **View my sessions**.
- `list-my` returns successfully and the UI renders either an empty state or a
  typed session/roster summary.

### Error

- Network, HTTP, and malformed-response failures map to safe error codes.
- No token, secret, confidential tooling client ID, or raw response body is
  rendered or logged.
- Retry does not create duplicate requests that can overwrite newer state.

### Service Evidence

- A live title-host request with the player access token reaches the Session
  `list-my` endpoint.
- The response status and safe shape are recorded without storing credentials.
- If a session is returned and `get` is authorized, its safe roster shape is
  recorded; otherwise the empty/permission outcome is documented honestly.

### Game-Flow Evidence

- Player selects **Continue as Guest**.
- UI reaches `Lobby connected`.
- Player selects **View my sessions**.
- UI shows loading, empty/success, or recoverable error state matching the live
  Session response.

## Implementation Steps (after approval)

1. Refresh AGS CLI authentication and perform a read-only title-host
   `list-my` smoke using a fresh player token; record only status and safe keys.
2. Confirm whether a compatible first-party browser Session SDK is available;
   otherwise implement the narrow typed REST adapter.
3. Add in-memory token access through the existing IAM boundary without adding
   persistence or logging.
4. Add the post-Lobby session trigger and typed loading/empty/success/error UI.
5. Add unit tests for response mapping, empty results, errors, retry, and stale
   response cleanup.
6. Run `npm test`, `npm run build`, `git diff --check`, and the live smoke.
7. Manually verify the visible game flow and record Session evidence before
   planning create/join or Matchmaking.

## Verification

- `npm test` passes.
- `npm run build` succeeds.
- `git diff --check` passes.
- No token, secret, or confidential tooling client ID appears in `dist`.
- Live title-host Session request returns a safe, documented outcome.
- Browser flow shows `Continue as Guest` → `Lobby connected` → `View my
  sessions` → an honest empty/success/error result.

## Risks And Open Questions

- No Session browser SDK dependency is currently installed; package/version
  compatibility must be checked before adding one.
- No configured Session template has been verified. This blocks create/join but
  does not block membership lookup.
- The publisher-level host has a known `20030 subdomain mismatch`; all browser
  player calls must use the title-level host.

## Approval Gate

Approved by the user on 2026-07-17. Approval authorizes only the read-only
membership/roster slice described above; create/join, matchmaking, and AMS
remain separate plans.

## Implementation Result

- Added the typed `client/session.ts` REST adapter using the authenticated AGS
  SDK transport; no browser token persistence or logging was introduced.
- Added the post-Lobby **View my sessions** trigger with loading, empty,
  success/roster, and safe error states.
- Added session mapping/error tests in `client/session.test.ts`.
- `npm test`, `npm run build`, and `git diff --check` pass.
- Live title-host smoke returned HTTP 200 with zero active sessions; see the
  [Session evidence](./2026-07-17-session-lifecycle-evidence.md).

The user confirmed the browser flow looks good after the Session slice was
implemented. No create/join or matchmaking work is included.
