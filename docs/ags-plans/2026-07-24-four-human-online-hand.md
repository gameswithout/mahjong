# Game Flow Plan — Four-Human Online Hand

- Date: 2026-07-24
- Status: Complete — live four-browser game flow verified
- Approved feature: four distinct human guests use the existing player-facing
  **Find a table** action, enter one shared AGS Session and deployed Mahjong
  runtime automatically, play one complete hand from private seat views, and
  return cleanly to the lobby
- Approval: the user explicitly asked Codex to work autonomously on the
  four-human loop on 2026-07-24

## Confirmed context

- This is a React/Vite browser game using the AGS TypeScript SDK.
- Browser callers authenticate with a Public IAM client and keep each player's
  user access token in memory. No client secret is shipped to the browser.
- Device ID guest login, Lobby connection, Matchmaking ticket lifecycle,
  four-player match formation, Session join/roster/leave, and the deployed
  Extend match service have already been smoke-verified independently.
- A four-player API smoke previously produced one shared Session, four
  successful joins, four-member roster reads, and four successful leaves.
- AI Practice has already reached the deployed runtime through a real AGS
  Session.
- The remaining product gap is the browser handoff: **Find a table** currently
  stops at a manual **Join table** button, and a loaded Session stops at the
  debug-labelled **Connect test hand** button.
- The deployed match service resolves authoritative seats from the AGS Session
  roster, returns a different redacted view to every player, and supports
  reconnect to the same seat.
- AGS CLI authentication is healthy for `gameswithout-mahjong`. The runtime
  title host and publisher tooling host intentionally differ; no namespace
  mutation is required for this slice.

## Goal

Make **Find a table** the single player action that drives the existing online
journey:

```text
guest login
  -> Lobby connected
  -> Find a table
  -> Matchmaking ticket
  -> shared AGS Session
  -> automatic Session join
  -> wait for four-member roster
  -> automatic deployed-runtime join
  -> private playable seat
  -> complete hand/result
  -> Return and leave the Session
```

The UI must keep visible queue, cancel, joining, waiting-for-players,
runtime-joining, live-table, recoverable-error, result, and return states.

## Non-goals

- Persistent Jade wallet settlement or economy grants.
- Ranked MMR, leaderboards, achievements, or analytics rollout.
- Parties, invitations, friends, voice, chat, or play-again rematch.
- Matchmaking ruleset, pool, Session template, IAM permission, or Extend
  deployment changes.
- Replacing the existing rules engine, seat resolver, or persistence model.
- Claiming production launch readiness from a local four-browser run.

## Affected areas

- `client/App.tsx`: automatic Matchmaking-to-Session-to-runtime orchestration
  and player-facing progress/retry states.
- `client/MatchTable.tsx` and `client/HandResultScreen.tsx`: stable accessible
  selectors only where the four-client test needs them.
- `client/App.test.ts`: orchestration-policy unit coverage.
- `scripts/`: repeatable isolated four-browser game-flow verification.
- `package.json`: the four-human verification command.
- `docs/ags-plans/`: implementation and evidence record.

## AGS modules

- IAM: issues a separate user access token for each browser guest.
- Lobby: establishes the connected player state before queueing.
- Matchmaking: creates and polls four tickets in `mahjong-test-pool`.
- Session: supplies the shared Session ID and authoritative four-member roster.
- Extend Service Extension: hosts the existing Mahjong match runtime and reads
  Session membership through its server-side Confidential IAM client.

## Service selection

- AGS IAM is the purpose-built identity service.
- AGS Lobby, Matchmaking, and Session remain the purpose-built online
  orchestration services.
- The deployed Extend service remains the custom authoritative Taiwanese
  Mahjong runtime because AGS has no native Mahjong rules service.
- Cloud Save is rejected. Match tickets, membership, private seat state,
  ordered commands, reconnect ownership, and hand results require their
  purpose-built services and transactional runtime behavior, not generic
  key/value blobs.
- Statistics, Leaderboards, Achievements, Wallet, and Entitlements are rejected
  for this slice because no persistent progression or economy write is being
  added.

## Authorization Plan

| Field | Decision |
| --- | --- |
| Caller | Browser game client for player actions; deployed backend service for authoritative Session roster lookup |
| Environment | AGS Shared Cloud |
| Environment evidence | Browser config uses `gameswithout-mahjong.prod.gamingservices.accelbyte.io`; CLI is authenticated to the publisher tooling host for namespace `gameswithout-mahjong` |
| Token source | Player user access token in each browser; service token in the deployed backend |
| IAM client type | Public browser client; Confidential backend client |
| Secret location | None in browser; backend credential remains in server-side AGS/Extend configuration |
| AGS calls | Existing Device ID login, Lobby connect, Matchmaking ticket create/read/cancel, Session join/read/leave; backend Session lookup; custom runtime join/state/command calls |
| Permission discovery | Existing approved plans and live IAM/Matchmaking/Session/runtime evidence; no new AGS operation or permission is introduced |
| Required permissions | Existing user-scoped public flow; existing backend Session read permission |
| Shared Cloud groups | No permission-group change in this slice |
| Verified access | Yes for all independent service paths; combined player journey is the verification target |

## Implementation steps

1. Add a small online-entry policy that distinguishes manual Session tools,
   AI Practice, and four-human matchmaking.
2. Automatically join the Session returned by a matched ticket, guarding
   against duplicate joins and preserving visible retry/error behavior.
3. Poll the joined Session roster and automatically enter the deployed runtime
   once all four human members are present.
4. Replace debug handoff wording with player-facing queue/join/wait/enter
   states while retaining manual Session controls for development.
5. Add unit tests for automatic-start readiness and accessible selectors for
   deterministic game controls.
6. Add a four-isolated-browser script that signs in four guests, queues them,
   proves a shared match and four distinct private seats, drives legal actions
   to a hand result, exercises one reconnect, returns, and verifies cleanup.
7. Run TypeScript tests/build, Go service tests, the live four-human flow, and
   diff hygiene checks; fix in-scope failures.

## Verification

- `npm test`
- `npm run build`
- `go test ./...` from `mahjong-match-service`
- `npm run test:four-human`
- Four browser contexts reach the match table from **Find a table** without
  clicking an intermediate join/runtime button.
- All four contexts report the same match ID and four distinct seats.
- Each context exposes only its own hand identities while opponent hands stay
  concealed.
- Legal draw, discard, and claim/pass actions advance one hand to the result
  screen.
- Reloading one context restores the same seat.
- **Return** leaves the Session for all four contexts; no active smoke ticket
  remains.
- `git diff --check`

## Risks and open questions

- Matchmaking and Session roster propagation are eventually consistent, so
  the handoff must wait and retry without issuing duplicate joins.
- A full untuned hand can be long. The test needs bounded legal-action driving
  and must capture enough state to distinguish a product failure from a test
  timeout.
- Browser guest identity persistence must be isolated per context; otherwise
  AGS may treat multiple contexts as one member.
- Reload-based reconnect depends on the current browser IAM persistence
  behavior. If a hard reload creates a new guest, the repeatable test will
  exercise transport reconnect in the same authenticated page instead and
  record the exact limitation.
- Live verification depends on the existing pool, Session template, and
  deployed Extend service remaining available. No configuration mutation is
  authorized or needed.

## Deferred Requested Integrations

- [ ] Persistent Jade settlement through the selected AGS economy services.
- [ ] Ranked MMR/statistics and leaderboard progression.
- [ ] Achievements and analytics for completed online hands.
- [ ] Party invites, friends, social presence, and rematch/play-again.
- [ ] Production rollout observability, load, and failure-injection testing.

## Next step

Implement the automatic player journey, then run the isolated four-browser
flow against the live namespace and deployed runtime. Report service evidence
and player-flow evidence separately.
