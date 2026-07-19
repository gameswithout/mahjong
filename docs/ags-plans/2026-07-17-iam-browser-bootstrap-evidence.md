# P0 Evidence — IAM Browser Bootstrap

- Date: 2026-07-17
- Feature: IAM / browser guest bootstrap
- Status: Complete

## Configuration

- Base URL: `https://gameswithout.prod.gamingservices.accelbyte.io`
- Namespace: `gameswithout-mahjong`
- IAM client: Public client `dc7a13b683c44822905797a8d1df39e7`
- Secret handling: no client secret in browser config, source, or build output
- Device identity: generated once and persisted under
  `mahjong.ags.device-id`; AGS tokens remain in memory only

## Implementation Evidence

- AGS TypeScript SDK: `@accelbyte/sdk` 4.3.2
- AGS IAM module: `@accelbyte/sdk-iam` 6.3.5
- `npm run build`: passed
- `npm test`: passed (3 tests)
- `git diff --check`: passed
- Production bundle scan: confidential tooling client ID absent from `dist`
- Browser control: unavailable in this environment, so interactive click
  evidence is not available here
- Follow-up browser attempt: browser runtime discovery returned no available
  browser backends.
- Player-flow confirmation: user confirmed the manual `Continue as Guest` →
  `Signed in` click-through.

## Service Evidence

The live smoke harness sends an ephemeral Device ID to:

`POST /iam/v4/oauth/platforms/device/token`

After Device ID activation, the Public client receives a player token and the
authenticated proof call succeeds:

`GET /iam/v3/public/users/me`

Sanitized result: `tokenIssued: true`, `currentUserReturned: true`, namespace
`gameswithout-mahjong`. No token, device ID, or secret was recorded.

## Next Action

Start the next approved game-flow slice: Lobby connection and presence. Keep
Matchmaking, Session, and AMS deferred until Lobby evidence is captured.
