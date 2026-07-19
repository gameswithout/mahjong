# Matchmaking Ticket Lifecycle Evidence — 2026-07-17

- Status: Implemented — four-player match/join/roster/leave API flow verified; browser click-through pending
- Plan: [Matchmaking ticket lifecycle plan](./2026-07-17-matchmaking-ticket-lifecycle.md)
- Namespace: `gameswithout-mahjong`
- Pool: `mahjong-test-pool`
- Browser host: `https://gameswithout-mahjong.prod.gamingservices.accelbyte.io`

The request shape follows AGS's documented Matchmaking ticket endpoint and
lifecycle: [ticket create payload](https://docs.accelbyte.io/gaming-services/modules/multiplayer/matchmaking/opt-in-opt-out-join-in-progress/)
and [ticket lifecycle](https://docs.accelbyte.io/gaming-services/modules/multiplayer/matchmaking/match-ticket-lifecycle/).

## Implementation

- Added a typed browser adapter in `client/matchmaking.ts` for ticket creation,
  detail polling, and cancellation.
- Added safe error mapping for configuration, authorization, not-found,
  conflict, malformed response, network, and unknown outcomes.
- Added a Lobby-connected **Find a table** panel with queue, search, cancel,
  match-found, explicit **Join table**, retry, and queue-unavailable states.
- Added `ACCELBYTE_MATCH_POOL` to browser runtime configuration.
- Match-found displays the returned session ID and offers an explicit Session
  join action. It does not claim AMS or network travel.

## Live API smoke

The smoke used a fresh public Device ID guest token and did not persist or log
the token, device ID, or ticket ID.

```text
POST /match2/v1/namespaces/gameswithout-mahjong/match-tickets  -> 201
  response keys: matchTicketID, queueTime
GET  /match2/v1/namespaces/gameswithout-mahjong/match-tickets/{id} -> 200
  response keys: sessionID, matchFound, isActive
DELETE /match2/v1/namespaces/gameswithout-mahjong/match-tickets/{id} -> 204
```

The ticket remained unmatched with one player, as expected for the four-player
test ruleset. A title-level queue read-back confirmed the smoke tickets were
inactive after cancellation; no active smoke ticket remains.

## Four-player match smoke

Four fresh public Device ID guest identities submitted tickets to the same test
pool. All four create calls returned `201`; polling returned `matchFound: true`
and one shared Session ID for every ticket. The generated session later became
unavailable after the smoke clients did not complete a browser join, so no
player state was left running.

```text
4 × POST match ticket -> 201
4 × GET match ticket  -> 200, matchFound=true, shared session ID
title queue read-back -> all four tickets IsActive=false
```

## Four-player Session handoff smoke

A second four-player run completed the full handoff. Every player joined the
returned Session, every roster read returned four members, and every player
left successfully.

```text
4 × POST match ticket -> 201
4 × GET match ticket  -> 200, matchFound=true, shared session ID
4 × POST session join -> 200
4 × GET session       -> 200, roster size 4 for every player
4 × DELETE session leave -> 204
```

## Local verification

```text
npm run test  -> 18 tests passed across 5 files
npm run build -> succeeded (Vite reports the existing >500 kB bundle warning)
git diff --check -> clean
```

The repeatable four-player smoke is available as:

```bash
npm run smoke:matchmaking
```

It reads the browser-safe values from `.env`, keeps guest tokens in memory, and
leaves the generated Session (or cancels queued tickets on timeout).

Latest run: four tickets created, match found after two polls, four-player
roster verified, and all players left successfully.

## Remaining scope

- Manually click through `Lobby connected` → `Find a table` → `Cancel`, plus
  `Match found` → `Join table` → roster refresh, in a running browser session.
  No AMS or dedicated-server behavior is claimed here.
