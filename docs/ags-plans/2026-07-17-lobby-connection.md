# Game Flow Plan — Lobby Connection and Presence

- Date: 2026-07-17
- Status: Complete
- P1 slice: authenticated Lobby WebSocket connection and connection-state UI

## Approved Feature

The IAM/browser bootstrap P0 is complete. The next player-facing slice is to
connect the signed-in Mahjong browser client to AGS Lobby and expose the
connection lifecycle. The existing **Continue as Guest** action remains the
player trigger; a successful IAM session immediately starts Lobby connection.

This plan intentionally stops at the Lobby transport and connection-state
proof. Party creation, invitations, chat, matchmaking, Session, and AMS remain
deferred.

## Confirmed Context

- Repository: React + TypeScript PWA using Vite.
- Browser/game-title base URL: `https://gameswithout-mahjong.prod.gamingservices.accelbyte.io`.
- Tooling/API base URL: `https://gameswithout.prod.gamingservices.accelbyte.io`.
- Namespace: `gameswithout-mahjong`.
- Browser IAM client: Public client `dc7a13b683c44822905797a8d1df39e7`.
- IAM P0 is complete: live Device ID token issuance and authenticated
  current-user proof pass, and the user confirmed the browser click-through.
- Installed AGS core SDK: `@accelbyte/sdk` 4.3.2.
- Installed IAM SDK: `@accelbyte/sdk-iam` 6.3.5.
- Lobby SDK: `@accelbyte/sdk-lobby` 5.2.7, compatible with core SDK 4.3.2.
- The AGS CLI operator profile is authenticated and exposes Lobby metadata and
  the public presence operation with no client permissions.
- The user confirmed that Lobby is active in the Admin Portal. The title-level
  host passes the live Lobby smoke; the publisher-level host returns
  `20030 subdomain mismatch`.

## Goal

After the player reaches `Signed in`, the app connects the authenticated user
to AGS Lobby and shows one of these explicit states:

- `Connecting to Lobby`
- `Lobby connected`
- `Lobby disconnected` with reconnect behavior
- `Lobby connection failed` with a safe Retry action

The player token remains in memory and is never rendered, persisted, or logged.

## Non-Goals

- Party creation, invites, or party membership.
- Chat or direct messages.
- Friends graph or social profile enrichment.
- Matchmaking, Session, dedicated-server travel, or AMS.
- Lobby configuration mutations in the Admin Portal.
- Persisting tokens or Lobby connection state in `localStorage`.

## Affected Areas

- `package.json` and `package-lock.json` for the Lobby SDK.
- `client/iam.ts` to retain the authenticated SDK/token in memory behind a
  module boundary usable by Lobby.
- New `client/lobby.ts` adapter with injectable connection lifecycle.
- `client/App.tsx` and `client/styles.css` for visible Lobby states.
- Unit tests for connection, disconnect/retry, cleanup, and redaction.
- P1 evidence and verification documentation.

## AGS Modules

- IAM (existing prerequisite only).
- Lobby / WebSocket connection.

## Service Selection

**Selected:** AGS Lobby WebSocket.

Lobby is the purpose-built AGS service for the continuous player connection,
presence, party, chat, and invitations. Cloud Save is not applicable: no
generic game data is being stored, and it must not emulate Lobby state.

## Authorization Plan

Authorization preflight:

| Field | Decision / evidence |
| --- | --- |
| Caller | Game client: browser-based PWA |
| Environment | Shared Cloud |
| Environment evidence | Browser `.env` uses the title-level host; CLI/MCP tooling uses the publisher-level host; both target namespace `gameswithout-mahjong` |
| Token source | Authenticated player's in-memory user access token from IAM Device ID login |
| IAM client type | Public; `dc7a13b683c44822905797a8d1df39e7` |
| Secret location | None; no client secret in the browser |
| AGS calls | `Lobby.WebSocket(sdk)`; WebSocket open/message/close lifecycle |
| Permission discovery | `ags describe lobby presence list --format json`; public operation exposes no client permissions |
| Required permissions | No separate client permission is exposed in the current TypeScript Lobby guidance; the WebSocket uses the player's bearer token |
| Shared Cloud permission groups | N/A for the discovered public presence operation |
| Verified access | Yes on the title-level browser host; publisher-level Lobby host returns `20030 subdomain mismatch` |

The Public client is used only for the browser/player flow. No service token or
confidential client is introduced.

## Required AGS Setup Before Implementation

No new third-party provider is required. The title-level browser host is now
confirmed for IAM, presence, and Lobby. Keep the publisher-level host for CLI /
MCP tooling unless the account owner directs otherwise.

## Player Entry And UI Surface

- Trigger: existing **Continue as Guest** button.
- Existing path: `client/App.tsx` calls `BrowserIam.loginAsGuest()`.
- New path: successful IAM proof starts Lobby connection automatically.
- Visible states: signed in, connecting, connected, disconnected/reconnecting,
  and recoverable error.
- Retry: reuses the same in-memory authenticated session and device identity.
- Cleanup: disconnect the WebSocket when the app/session unmounts or the user
  explicitly leaves the online flow.

## Completion Contract

### Success

- A player token is already issued and proved by IAM.
- The Lobby WebSocket opens for that authenticated player.
- The UI shows `Lobby connected`.
- The smoke harness receives at least one valid Lobby message/event after open.

### Error

- The UI shows a stable safe Lobby error code and Retry.
- Raw WebSocket frames, tokens, device IDs, and secrets are not shown.
- Abrupt close is distinguishable from a connection refusal without leaking
  credentials.

### Service Evidence

- `Lobby.WebSocket(sdk)` opens with the IAM player token.
- At least one expected Lobby message/event is received.
- Close/reconnect behavior is exercised once.

### Game-Flow Evidence

- Player selects **Continue as Guest**.
- UI advances through IAM success to `Connecting to Lobby` and
  `Lobby connected`.
- A recoverable disconnect or Retry path is manually exercised.

## Implementation Steps

1. Re-authenticate the AGS CLI operator profile before relying on live
   permission/catalog discovery.
2. Install and pin `@accelbyte/sdk-lobby` at a version compatible with the
   installed core SDK.
3. Add an in-memory authenticated SDK boundary that does not expose the token
   to React rendering or persistence.
4. Add a typed Lobby WebSocket adapter with reconnect settings, lifecycle
   callbacks, cleanup, and safe error mapping.
5. Connect the adapter to the existing signed-in UI and add explicit Lobby
   states.
6. Add unit tests for lifecycle transitions, retry/cleanup, and redaction.
7. Run build/tests and a live Lobby smoke test, then manually verify the
   player-facing flow.
8. Record service and game-flow evidence before planning Session or
   Matchmaking.

## Verification

- `npm run build` succeeds.
- `npm test` passes.
- No token, secret, or confidential tooling client ID appears in `dist`.
- Live Lobby WebSocket opens after IAM and receives an expected event/message.
- Browser flow shows `Continue as Guest` → `Signed in` → `Connecting to Lobby`
  → `Lobby connected`.
- Retry and disconnect cleanup do not create duplicate WebSockets.

## Risks And Open Questions

- The publisher-level Lobby host returns HTTP 404 / AGS error `20030`
  (`subdomain mismatch`).
- The title-level host passes the live player-token, presence, WebSocket-open,
  and `connectNotif` checks.
- Manual browser click-through is confirmed on the title-level host.
- The installed SDK confirms `connectNotif` as the expected connection event.

## Next Step

The Lobby SDK and client adapter are implemented and locally verified. The
browser runtime config uses the title-level host, and the user confirmed the
visible `Lobby connected` state. Session membership/roster lookup is now also
complete; Session create/join is implemented and awaiting browser evidence.

## Deferred Requested Integrations

- [ ] Party creation and invitations.
- [ ] Chat and presence detail UI.
- [x] Session membership and roster lookup.
- [x] Session create/join lifecycle (browser evidence pending).
- [ ] Matchmaking ticket submission and match-found handling.
- [ ] AMS dedicated-server claim/travel verification.
