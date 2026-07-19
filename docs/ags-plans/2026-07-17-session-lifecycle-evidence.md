# Session Membership/Roster Evidence — 2026-07-17

- Status: Complete
- Plan: [Session lifecycle plan](./2026-07-17-session-lifecycle.md)
- Namespace: `gameswithout-mahjong`
- Browser/game-title host:
  `https://gameswithout-mahjong.prod.gamingservices.accelbyte.io`

## Service Evidence

The approved read-only smoke used a fresh public-client Device ID player token
against the title-level host. The token and response body were not recorded.

```text
tokenIssued: true
currentUserReturned: true
sessionStatus: 200
sessionsCount: 0
bodyKeys: paging, data
```

This confirms the player can reach Session `list-my`. There are currently no
active memberships for the smoke player, so no detail/roster request was made
and no synthetic session was shown.

## Code Evidence

- `client/session.ts` maps the public `list-my` and `get` endpoints into safe
  typed summaries and maps HTTP/network/malformed responses to stable errors.
- `client/App.tsx` only exposes **View my sessions** after `Lobby connected` and
  renders loading, empty, typed roster, and safe retry states.
- `client/session.test.ts`: four tests covering list/detail mapping, empty
  results, forbidden errors, and malformed responses.
- `npm test`: 9 tests passed.
- `npm run build`: passed; Vite emitted only the existing bundle-size warning.
- `git diff --check`: passed.
- `dist` credential scan: clean; no confidential tooling client ID or secret.

## Game-Flow Evidence

- IAM → Lobby was previously live-verified and manually confirmed by the user:
  `Continue as Guest` → `Lobby connected`.
- The Session trigger is now wired behind that Lobby state.
- The user confirmed the browser flow looks good, completing the Session slice.

## Deferred

- Session create/join/leave and template configuration.
- Matchmaking ticket flow.
- AMS server claim and game travel.

## Completion

The Session membership/roster lookup slice is complete. The next dependency is
an explicit Session create/join flow backed by a verified Session configuration
template; no template mutation was performed in this slice.
