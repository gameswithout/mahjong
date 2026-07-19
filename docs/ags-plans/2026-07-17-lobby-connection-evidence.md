# P1 Evidence — Lobby Connection and Presence

- Date: 2026-07-17
- Feature: authenticated Lobby WebSocket connection
- Status: Complete

## Configuration

- Browser/game-title base URL: `https://gameswithout-mahjong.prod.gamingservices.accelbyte.io`
- Tooling/API base URL: `https://gameswithout.prod.gamingservices.accelbyte.io`
- Namespace: `gameswithout-mahjong`
- IAM client: Public client `dc7a13b683c44822905797a8d1df39e7`
- Lobby SDK: `@accelbyte/sdk-lobby` 5.2.7
- Core SDK: `@accelbyte/sdk` 4.3.2
- Secret handling: no client secret in browser config, source, or build output
- Token handling: the player token remains in memory behind `BrowserIam`; it
  is never rendered, persisted, or logged

## Implementation Evidence

- `client/lobby.ts`: typed Lobby WebSocket lifecycle adapter with reconnect
  configuration, cleanup, and safe error mapping
- `client/iam.ts`: authenticated SDK boundary for the in-memory player token
- `client/App.tsx`: visible `Connecting to Lobby`, `Lobby connected`,
  reconnecting, and recoverable error states
- `client/lobby.test.ts`: lifecycle, message, cleanup, and error-redaction tests
- `npm test`: passed (5 tests)
- `npm run build`: passed
- `git diff --check`: passed
- Production bundle scan: confidential tooling client ID and secret absent from
  `dist`

## Authorization Evidence

- Caller: browser game client
- Token source: authenticated player access token from Device ID IAM
- IAM client type: Public
- AGS CLI status: authenticated with the configured tooling profile
- `ags describe lobby presence list --format json`: public GET operation,
  permissions `[]`
- Portal state: user confirmed Lobby is active

## Service Evidence

The live harness succeeds against the title-level browser host:

- IAM Device ID token issued and current user returned.
- `GET /lobby/v1/public/presence/namespaces/gameswithout-mahjong/users/presence`:
  HTTP 200.
- `Lobby.WebSocket(sdk)`: opened successfully and delivered `connectNotif`.

For comparison, the publisher-level host returns HTTP 404 / AGS `20030`
(`subdomain mismatch`) for Lobby operations.

No token, device ID, secret, or raw WebSocket frame was recorded.

## Game-Flow Evidence

- The existing **Continue as Guest** trigger now starts Lobby connection after
  IAM succeeds.
- UI source is wired for the required Lobby states.
- User confirmed the manual browser flow reaches `Lobby connected` on the
  title-level host.

## Next Action

Lobby is complete, and Session membership/roster lookup is now complete. The
next gated slice is Session create/join; keep Matchmaking and AMS deferred until
that configuration and evidence pass.
