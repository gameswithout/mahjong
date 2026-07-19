# Session Create/Join Evidence — 2026-07-17

- Status: Complete
- Plan: [Session create/join plan](./2026-07-17-session-create-join.md)
- Namespace: `gameswithout-mahjong`
- Browser/game-title host:
  `https://gameswithout-mahjong.prod.gamingservices.accelbyte.io`
- Template: `mahjong-test-none`

## AGS Configuration Evidence

The project owner authorized the following test configuration, which was
created successfully through the title-level AGS host:

```text
type: NONE
joinability: OPEN
maxPlayers: 4
minPlayers: 1
clientVersion: web-0.0.0
inactiveTimeout: 60
inviteTimeout: 60
textChat: false
persistent: false
```

The CLI profile was restored to the publisher-level tooling host after the
mutation. No client secret or operator token was written to the repository.

## Live Player-Token Smoke

A fresh public-client Device ID token exercised the browser-equivalent player
operations. The session ID and response bodies were not recorded.

```text
tokenIssued: true
createStatus: 201
createBodyKeys: matchPool, backfillTicketID, code, ticketIDs, isActive, isFull, version, id, namespace, createdAt, createdBy, updatedAt, leaderID, configuration, members, attributes, DSInformation, teams
sessionIdPresent: true
detailStatus: 200
detailBodyKeys: matchPool, backfillTicketID, code, ticketIDs, isActive, isFull, version, id, namespace, createdAt, createdBy, updatedAt, leaderID, configuration, members, attributes, DSInformation, teams
leaveStatus: 204
```

This verifies the public client has the required Session create/read/leave
access for the configured test template. Join is wired and covered by the
typed adapter tests.

A second two-player smoke also passed:

```text
firstTokenIssued: true
secondTokenIssued: true
createStatus: 201
joinStatus: 200
detailStatus: 200
memberCount: 2
memberKeys: id, status, statusV2, updatedAt, platformID, platformUserID
leaveSecondStatus: 204
leaveFirstStatus: 204
```

The roster mapper treats the AGS member `id` as the safe user identifier.

## Code Evidence

- `client/session.ts`: typed create/join/leave endpoints, safe request payload,
  roster mapping, and stable error mapping.
- `client/App.tsx`: visible create/join/leave controls appear only after
  `Lobby connected`, with automatic three-second roster refresh and manual
  refresh.
- `client/session.test.ts`: six tests covering list/detail mapping, empty
  results, configuration/forbidden/malformed errors, and create/join/leave
  request shapes.
- `client/config.test.ts`: two tests ensure missing optional Session settings do
  not crash IAM startup.
- `npm test`: 13 tests passed.
- `npm run build`: passed; Vite emitted only the existing bundle-size warning.
- `git diff --check`: passed.
- `dist` credential scan: clean.

## Browser Game-Flow Evidence

Manually verify:

1. `Continue as Guest` → `Lobby connected`.
2. **Create test table** → a session ID and one-member roster.
3. A second signed-in browser/device enters the ID → **Join** → two-member
   roster.
4. **Leave table** removes the player and returns to the empty state.

The user confirmed this flow works, including the existing session observing a
later join.

No Matchmaking or AMS behavior is included in this slice.
