# Game Flow Plan — M2.5 Practice Loop Complete

- Date: 2026-07-24
- Status: Game-flow integrated locally; fresh hosted click-through pending
- Approved feature: turn the existing AI Practice vertical slice into one
  complete, player-facing loop

## Confirmed context

- The browser already signs players in through the existing AGS Public client,
  connects Lobby, and creates AGS game sessions with the player access token.
- `Practice vs Bots` creates a Session carrying
  `attributes.ai_practice = "true"`.
- The deployed Mahjong Service Extension reads that Session, pads its roster
  with three permanent bot seats, and owns the authoritative hand.
- The browser already renders the live table, legal server-computed actions,
  reconnect states, settlement math, and the hand result.
- A live AI Practice hand was recorded on 2026-07-20. At planning time, the
  player path still required a second `Connect test hand` action and exposed
  Session/runtime implementation details.
- M2.5 was recommended in the 2026-07-24 repository audit and the user
  explicitly asked to proceed autonomously.

## Goal

A signed-in player can choose Practice once, enter a solo hand against three
bots without seeing developer-oriented setup, finish the hand, understand that
the result is non-persistent Practice scoring, and either immediately start a
fresh Practice hand or return to the lobby.

## Non-goals

- Four-human matchmaking or private-room productization.
- Persistent Jade wallet/ledger writes.
- Statistics, XP, achievements, missions, ratings, or leaderboards.
- Multi-hand Full Rotation lifecycle.
- Changes to IAM clients, permissions, Session templates, Matchmaking pools, or
  the deployed Extend service.
- Replacing the existing local developer controls; they remain available behind
  a collapsed developer-tools disclosure.

## Affected areas

- `client/App.tsx`: one-action Practice orchestration, replay lifecycle, and a
  product-facing Practice card.
- `client/HandResultScreen.tsx`: Practice-safe settlement copy plus Play Again
  and Return controls.
- `client/styles.css`: Practice card, developer disclosure, and result actions.
- Client tests: result semantics and Practice lifecycle orchestration.
- `README.md` and this evidence plan: player path and verification record.

## AGS modules

- IAM: unchanged player login and in-memory user access token.
- Lobby: unchanged connection prerequisite before Session actions.
- Session: existing create/leave calls are composed into the Practice and Play
  Again paths.
- Matchmaking is not used by AI Practice and remains deferred.
- The custom Mahjong Service Extension remains the authoritative gameplay
  service.

## Service Selection

- AGS Session remains the purpose-built owner of the game-session wrapper and
  player membership.
- The Mahjong Service Extension remains the rules/runtime owner because AGS has
  no native Taiwanese Mahjong match engine.
- The settlement returned by the rules engine is presented as non-persistent
  Practice points. AGS Wallet is deliberately not invoked in M2.5.
- Cloud Save is rejected. This slice adds no persisted player data, and the
  authoritative hand already uses the Extend service's ordered PostgreSQL event
  store.

## Authorization Plan

```text
Authorization preflight

  Caller:                Browser game client; backend Service Extension
  Environment:           AGS Shared Cloud
  Environment evidence:  .env.example targets
                         gameswithout-mahjong.prod.gamingservices.accelbyte.io
  Token source:          Player user access token in the browser; managed
                         confidential service token in the Extend app
  IAM client type:       Public browser client; Confidential backend client
  Secret location:       None in browser/repository; Extend-managed server secret
  AGS calls:             Existing IAM login, Lobby connection, Session create/
                         leave, and backend Session game-session read
  Permission discovery:  Existing repository plans and recorded live evidence;
                         no new AGS operation is introduced
  Required permissions:  No new browser permission; backend Session /
                         Game Session READ remains unchanged
  Shared Cloud groups:   Session / Game Session / READ for the backend
  Verified access:       Previously live-verified; no live permission mutation
                         or re-verification required for local M2.5 edits
```

## Implementation steps

1. Refactor Practice Session creation so a successful create immediately joins
   the Mahjong runtime without relying on a second UI action.
2. Add a replay path that leaves the completed Session, creates a fresh
   `ai_practice` Session, and immediately enters the next hand.
3. Replace primary developer-oriented Session/runtime controls with a clear
   Practice card; retain diagnostics inside a collapsed developer disclosure.
4. Make the result screen explicitly non-persistent in Practice, label transfers
   as Practice points, and expose Play Again and Return to Lobby.
5. Add focused tests for Practice detection, result copy/actions, and
   orchestration helpers.
6. Run TypeScript build/tests, the root and Service Extension Go suites, and the
   compact match-table validation.
7. Update player instructions and record service/game-flow evidence separately.

## Verification

- `npm run test:practice` — PASS, 37 tests across Practice orchestration,
  Session/runtime behavior, launch UI, and result semantics.
- `npm test` — PASS, 97 tests across 14 client test files.
- `npm run build` — PASS, TypeScript and Vite production build.
- `go test ./...` — PASS for rules engine, bots, server match, auth, and
  protocol packages.
- `(cd mahjong-match-service && go test ./...)` — PASS for the Service
  Extension, contract, Session, storage, and service packages.
- `git diff --check` — PASS.
- Compact browser validation and the fresh hosted click-through are pending:
  the in-app browser connector reported no available browser runtime. The
  component tests and production build are the current client evidence; no
  standalone browser fallback was used.
- Live AGS calls are not required to validate the local orchestration changes;
  the existing recorded live hand remains service evidence until a fresh hosted
  click-through is performed.

## Implementation evidence

- `client/practice-flow.ts` owns fresh-hand lifecycle and derives Practice from
  the authoritative `is_bot` projection. Session cleanup is idempotent when a
  retry discovers that the previous leave already succeeded.
- `client/App.tsx` composes Session leave/create with an immediate runtime join,
  preserves retry context, blocks a new hand while failed Session cleanup is
  outstanding, retries the bounded post-create propagation window, and returns
  cleanly to the lobby.
- `client/App.practice.test.tsx` clicks through guest sign-in, one-action
  Practice, Play Again, and Return to Lobby with mocked AGS boundaries; it also
  proves that a failed leave cannot create a replacement (or any other table)
  until retry succeeds.
- `client/PracticeLaunchCard.tsx` makes Practice a single player-facing action;
  an active/stranded Session can be left without opening developer tools, while
  manual Session/runtime diagnostics remain under developer disclosure.
- `client/HandResultScreen.tsx` labels bot-hand settlement as non-persistent
  Practice points, shows the winning tile, attributes Dealer Tai to the actual
  dealer, and exposes Play Again plus Return to Lobby.
- `client/styles.css` removes game-shell padding at the certified 640×360
  landscape floor so the integrated table does not exceed the isolated
  wireframe's viewport budget.
- `README.md` documents the one-action loop and the new focused
  `npm run test:practice` command is available for CI or local regression.

## Status block

```text
Service Integration: Verified (existing recorded live AI hand; no new AGS call)
Game Flow:          Integrated locally (hosted click-through pending)
Evidence:           37 focused client tests; 97 total client tests;
                    production build; root and Service Extension Go suites
```

## Risks and open questions

- A failed or ambiguous leave is now surfaced, blocks every new table, and can
  be retried; an already-missing Session is treated as successfully cleaned up.
- React state updates are asynchronous. Runtime connection must accept the newly
  created Session explicitly instead of reading stale component state.
- A natural hand does not deterministically exercise every claim type. Unit and
  rules-engine coverage remain the deterministic evidence for rare actions.
- Browser automation availability may limit game-flow evidence to component and
  layout tests in this environment.

## Deferred Requested Integrations

- [ ] Four-human Bamboo queue and four-client end-to-end harness (tracked in
      the separate four-human online-hand plan; outside M2.5).
- [ ] Persistent Jade reserve, settlement, and conservation evidence.
- [ ] Mobile foreground/background resume matrix and reconnect p95 measurement.
- [ ] XP, history, achievements, missions, and progression.
- [ ] Full Rotation multi-hand dealer/round lifecycle.

## Next step

Deploy the client and perform one fresh hosted Practice click-through: launch,
finish, Play Again, and Return to Lobby. That promotes M2.5 from locally
integrated to game-flow verified. Continue the independently tracked
four-human work without expanding this milestone into persistence or economy.
