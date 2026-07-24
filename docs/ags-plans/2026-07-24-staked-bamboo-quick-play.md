# Game Flow Plan — M3B Staked Bamboo Quick Play

- Date: 2026-07-24
- Status: Implemented and locally verified; live service rollout pending
- Approved feature: signed-in players with enough Jade can reserve the maximum
  Bamboo loss, queue through the existing **Find a table** action, play one
  four-human hand, and see one durable, idempotent Jade settlement
- Approval: the user explicitly asked Codex to work autonomously on M3B and
  not pause for approval on 2026-07-24

## Confirmed context

- M3A already supplies a verified four-browser journey from guest login through
  AGS Matchmaking, Session, the deployed Extend runtime, a completed hand,
  reconnect, result, and Session cleanup.
- The authoritative rules engine already calculates Bamboo settlement at
  `10 Jade / Tai`, with a `300 Jade` maximum loss per player.
- The React/Vite browser uses a Public IAM client and in-memory player access
  tokens. No confidential credential is shipped to the browser.
- The Go Service Extension uses PostgreSQL for authoritative match state and a
  Confidential IAM client for server-to-server AGS calls.
- The selected AGS currency code is `JADE`, virtual, zero decimals. A new
  account receives separate idempotent 3,000 account and 2,000 onboarding
  grants, producing the playable 5,000 Jade balance.
- AGS CLI authentication and operation discovery are healthy. The live service
  credential can list namespace currencies, but permission-catalog output does
  not expose concrete operation permissions in this environment.

## Goal

Deliver one safe, understandable quick-play economy loop:

```text
sign in
  -> receive/load 3,000 account + 2,000 onboarding Jade
  -> see Bamboo rules and available balance
  -> reserve the 300 Jade maximum loss
  -> queue and join one four-human hand
  -> calculate rules settlement
  -> commit all four balances once in one database transaction
  -> show personal delta and before/after balance
  -> reconcile the authoritative balance to AGS Wallet
```

## Non-goals

- Real-money currency, purchases, refunds, cash-out, or marketplace behavior.
- Ranked MMR, leaderboards, achievements, quests, or analytics rollout.
- Multi-hand tables, rematch stakes, side bets, gifting, or player-to-player
  arbitrary transfers.
- Changing Bamboo scoring, Tai calculation, the 300 Jade loss cap, matchmaking
  rules, Session templates, or the match engine.
- Letting clients submit balance changes or trust a client-calculated result.

## Affected areas

- `mahjong-match-service/pkg/economy/`: eligibility, reservation, atomic
  settlement, account projection, and AGS Wallet reconciliation.
- `mahjong-match-service/pkg/storage/`: Jade account, journal, reservation,
  settlement, and wallet-sync persistence.
- `mahjong-match-service/pkg/service/` and protobuf contract: authenticated Jade
  endpoints and economy fields on private match projections.
- `mahjong-match-service/main.go`: economy wiring and background wallet mirror.
- `client/`: Jade API client, queue gate, stake copy, and result balance UI.
- `scripts/test-four-human.mjs`: balance conservation and idempotency evidence.
- `docs/ags-plans/`: implementation and live evidence.

## AGS modules

- IAM identifies the player and protects all player-scoped calls.
- Lobby, Matchmaking, and Session continue to own online orchestration.
- Extend Service Extension owns the custom Mahjong economy boundary and
  authoritative PostgreSQL transaction.
- Store/Wallet supplies a portal-visible per-player `JADE` wallet mirror.

## Service selection

- PostgreSQL is the authoritative Jade ledger because a Mahjong settlement
  changes four balances and must commit atomically and idempotently.
- AGS Wallet is the external, player-scoped balance mirror. A target-balance
  reconciliation worker reads the current wallet and credits or debits only the
  difference to the committed ledger balance.
- Direct AGS Wallet settlement is rejected as the authority: the available API
  performs per-user calls and does not expose one atomic four-wallet operation
  or a caller-provided idempotency key.
- AGS Statistics is rejected because currency requires ledger semantics.
- Cloud Save is rejected because balances, reservations, and settlements need
  transactional constraints and an auditable journal.
- Entitlements are rejected because Jade is fungible currency, not ownership of
  a durable item.

## Authorization Plan

| Field | Decision |
| --- | --- |
| Caller | Browser game client for Jade reads/reservations; deployed backend for settlement and Wallet synchronization |
| Environment | AGS Shared Cloud |
| Environment evidence | Runtime URLs use `*.prod.gamingservices.accelbyte.io`; namespace is `gameswithout-mahjong` |
| Token source | Player user access token in browser; Confidential service token in backend |
| IAM client type | Public browser client; Confidential backend client |
| Secret location | None in browser; service credential remains only in Extend environment configuration |
| Browser calls | Custom Service Extension `GET /jade`, `POST /jade/reservation`, and `DELETE /jade/reservation` |
| Backend AGS calls | Currency administration during one-time setup; Wallet read, credit, and debit for reconciliation |
| Permission discovery | `ags describe` confirms Currency and Wallet operations; the operator permission catalog was unavailable; the service credential successfully listed currencies |
| Required permissions | Player authentication on custom routes; backend namespace Currency setup plus Wallet read/credit/debit |
| Shared Cloud groups | No group assignment is assumed; live mutation verification will prove effective access |
| Verified access | Live `JADE` currency create/read verified; Wallet read/write remains a deployment verification target |

## Implementation steps

1. Add a migration for Jade accounts, append-only journal entries, one active
   reservation per player, per-match settlements, and Wallet sync targets.
2. Create/load an account with separate idempotent 3,000 account and 2,000
   onboarding grants.
3. Reserve 300 Jade before ticket creation; require at least 1,000 total Jade
   and 300 available Jade. Release an unbound reservation on queue cancel or
   ticket failure.
4. Bind the player's reservation to the authoritative match runtime on join.
   Reconnects to the same runtime reuse the binding.
5. On a completed all-human hand, validate balanced rules output and commit all
   four deltas, journal entries, reservation consumption, and Wallet targets in
   one transaction. Duplicate projections return the prior settlement.
6. Keep AI Practice free: bot-containing matches neither reserve nor persist
   Jade settlement.
7. Reconcile each committed target to AGS Wallet by reading the current balance
   and applying only the difference; retain retry status and error detail.
8. Show balance, availability, stake rules, eligibility, and settlement
   before/delta/after in the existing player journey.
9. Add unit, integration, and four-browser evidence for eligibility,
   conservation, caps, idempotency, Practice isolation, and cleanup.

## Verification

- `npm test`
- `npm run build`
- `go test ./...` from `mahjong-match-service`
- PostgreSQL integration tests prove one-time grant, reservation exclusion,
  atomic four-seat settlement, zero-sum conservation, and duplicate safety.
- Four browsers start with eligible balances, reserve before queueing, complete
  one shared hand, display four matching durable settlements, and conserve the
  total Jade supply.
- Re-reading a completed match does not post a second journal entry.
- Cancelling matchmaking restores available Jade.
- Practice reaches a result without creating a reservation or Jade journal.
- The `JADE` currency exists and a backend Wallet read/write smoke converges a
  test account to the authoritative target.
- `git diff --check`

## Risks and open questions

- AGS Wallet does not provide an atomic four-player mutation, so temporary
  mirror lag is expected and visible as sync status; PostgreSQL remains the
  gameplay authority.
- A process can stop after a Wallet credit/debit but before marking sync
  complete. Target reconciliation re-reads the wallet, making retry convergent
  rather than duplicating the change.
- Matchmaking and runtime joins are eventually consistent. Unbound
  reservations expire after ten minutes; bound reservations remain until the
  authoritative hand settles.
- A player leaving mid-hand can be taken over by the existing bot behavior. The
  original human's bound seat still settles because the wager was accepted
  before the match.
- If live Currency or Wallet mutation permission is absent, the complete local
  ledger remains playable while mirror status records the exact AGS blocker.

## Deferred Requested Integrations

- [ ] Ranked MMR and leaderboard progression, after Jade proves stable.
- [ ] Achievements for first win, high-Tai hands, and streaks.
- [ ] Analytics events for reservation, settlement, and Wallet-sync latency.
- [ ] Multi-hand table stakes and explicit rematch acceptance.
- [ ] Live-ops grants, sinks, store catalog items, and economy dashboards.
- [ ] Load, recovery, and forced Wallet-failure drills before production launch.

## Next step

Deploy the verified image, run the upgraded four-browser journey against the
live Service Extension, and capture one settlement journal plus AGS Wallet
convergence for all four players.
