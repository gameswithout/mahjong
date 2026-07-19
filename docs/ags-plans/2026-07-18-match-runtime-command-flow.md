# Game Flow Plan — Match Runtime Commands and Seat Views

- Date: 2026-07-18
- Status: Implemented and live-smoke verified; manual browser click-through
  remains
- Approved feature: connect an authenticated browser session to the local match
  actor, submit typed gameplay commands, and receive per-seat redacted state

## Confirmed context

- The browser already authenticates with AGS IAM through the Public client and
  keeps the player access token in memory.
- AGS Lobby, Session, and Matchmaking browser slices already exist.
- The local Go WebSocket verifies that player token through the installed IAM
  SDK's `GET /iam/v3/public/users/me` operation.
- `rulesengine.MatchActor` already provides append-before-ack commands, replay,
  idempotency, and per-seat projections.
- The intended player trigger for this increment is the active AGS Session
  panel in the existing React bootstrap UI.

## Goal

After joining or creating an AGS Session, a signed-in player can connect that
Session ID to the local match runtime, see their assigned test seat and
redacted state, discard East's dealt seventeenth tile, draw on later turns, and
Pass during an eligible claim window. Accepted commands broadcast a different
projection to every connected seat.

## Non-goals

- Production Extend deployment or app-owned database provisioning.
- Treating first-connection order as production seat authority.
- Full table rendering, bots, deadlines, takeover, settlement, or Jade.
- Mutating AGS namespace configuration.

## Affected areas

- `server/match`: actor registry, local seat binding, WebSocket routing.
- `server/protocol` and `protocol/envelope.ts`: typed command/view payloads.
- `server/cmd/walking-skeleton`: local runtime construction and event-log path.
- `client/match-runtime.ts`: typed join/command helpers and view parsing.
- `client/App.tsx` / `client/styles.css`: visible local test controls and states.

## AGS modules

- IAM: supplies and verifies the player user token.
- Session: its Session ID is the match ID used by the local runtime.
- Lobby remains connected but is not used as the local state-push transport in
  this increment.

## Service selection

- AGS Session remains authoritative for the production membership lifecycle.
- The custom Mahjong actor owns rules state because AGS has no purpose-built
  Taiwanese Mahjong rules service.
- Cloud Save is rejected: ordered append-before-ack events, private claim
  collection, and deterministic replay are not generic save-blob behavior.
- `FileEventStore` is local evidence only. The production app-owned
  AGS/Extend storage adapter remains deferred.

## Authorization Plan

| Field | Decision |
| --- | --- |
| Caller | Browser game client connecting to the custom Go runtime |
| Environment | AGS Shared Cloud (`gamingservices.accelbyte.io`) |
| Token source | AGS player user access token, kept in memory |
| IAM client type | Public browser client |
| Secret location | None in browser or runtime; tooling secret is unrelated |
| AGS calls | Existing Device ID login and `GET /iam/v3/public/users/me`; gameplay commands call the custom runtime only |
| Permission discovery | Existing IAM/Lobby/Session plans and live evidence; no new AGS operation is introduced |
| Required permissions | No new client permission; runtime authentication uses the existing user-token current-user call |
| Verified access | Yes for IAM verification and AGS Session create/join/roster flows |

## Implementation steps

1. Define match join, command, accepted, and seat-view payload types.
2. Add an actor registry with local first-come seat assignment for four unique
   verified user IDs and deterministic reconnect to the same seat.
3. Route `match.join`, `match.sync`, and authorized `match.command` messages.
4. Broadcast redacted views to each connected seat after accepted commands.
5. Add browser helpers and a minimal visible runtime panel.
6. Add Go and TypeScript protocol/flow tests.
7. Update local run/evidence documentation.

## Verification

- `go test ./server/... ./rulesengine` — passed
- `go test -race ./server/... ./rulesengine` — passed
- `go vet ./server/... ./rulesengine` — passed
- `npm test` — 6 files / 24 tests passed
- `npm run build` — passed; existing Vite large-chunk warning remains
- Live AGS smoke — Device ID login, current-user verification, safe WebSocket
  handshake, four-seat join, East discard, three private Pass responses,
  automatic claim resolution, South draw, and redacted broadcasts passed
- Manual browser click-through — pending because no controllable browser was
  available in this environment

## Risks and open questions

- Local first-come seats do not survive process restart and are not acceptable
  production authority. The production resolver must read AGS Session
  membership and an authoritative seat order.
- The local WebSocket broadcasts directly. Production may publish each
  per-seat payload through AGS Lobby notifications depending on the Extend
  hosting/latency spike.
- A one-player local table can exercise East's initial discard but needs more
  connected players or bots to resolve the claim window. The four-player live
  smoke verified the next-seat draw path.

## Deferred Requested Integrations

- [ ] AGS Session-authoritative seat resolver.
- [ ] Extend app-owned durable event store and deployment.
- [ ] Lobby notification transport for production per-seat pushes.
- [ ] Bot fill for empty local test seats.

## Next step

Run the manual multi-browser click-through, then replace local first-connection
seat assignment with an AGS Session-authoritative resolver and select the
production Extend event store. The proposed boundary and its approval gate are
recorded in
[the production seating/durability spike](./2026-07-18-production-seat-durability-spike.md).
