# M3B Staked Bamboo Quick Play — Verification Evidence

- Date: 2026-07-24
- Stall investigation:
  [2026-07-25 four-human diagnosis and resolution](./2026-07-25-four-human-stall-evidence.md)
- Scope: authoritative Jade ledger, public-queue reservation, four-seat
  settlement, player UI, and AGS Wallet reconciliation worker
- Result: implementation, live four-account gameplay, and AGS Wallet
  convergence verified

## Live AGS configuration

- Namespace: `gameswithout-mahjong`
- Currency: `JADE`
- Symbol: `玉`
- Type: virtual
- Decimal places: `0`
- Created: `2026-07-24T16:14:12.795Z`
- Verification: the service credential created the currency and the AGS CLI
  returned it from the namespace currency list.

Only disposable verification-player balances were mutated during live
verification. The direct one-Jade credit/debit probe was restored to zero, and
the completed four-player journey conserved the 20,000 Jade aggregate.

## Automated verification

| Check | Result |
| --- | --- |
| Client unit/component suite | 23 files, 185 tests passed |
| Client production build | Passed; 433 modules transformed |
| Root Go suite | Passed |
| Match Service Go suite | Passed across service, contract, economy, match, session, and storage packages |
| PostgreSQL Jade integration | Passed against PostgreSQL 17 |
| Four-human script syntax | Passed |
| Local container build | Passed |

Commands:

```shell
npm test -- --run
npm run build
go test ./...
cd mahjong-match-service && go test ./...
TEST_DATABASE_URL='postgres://postgres:postgres@localhost:5432/mahjong_match?sslmode=disable' \
  go test -tags=integration ./pkg/storage -run JadeReservation -count=1 -v
node --check scripts/test-four-human.mjs
cd mahjong-match-service && docker compose build app
git diff --check
```

## PostgreSQL proof

`TestPostgreSQLStorage_JadeReservationAndSettlementAreAtomicAndIdempotent`
proves:

- separate account and onboarding grants total 5,000 Jade per new player;
- a 300 Jade reserve reduces available balance without changing total balance;
- four bound reservations are required before settlement;
- one transaction posts all four deltas and consumes all four reservations;
- player deltas sum to zero and each before/delta/after equation holds;
- retrying the same runtime settlement returns the original rows without a
  second journal;
- journal and posting rows reject updates;
- an unbalanced journal is rejected at transaction commit.

## Local HTTP smoke

With the container connected to the PostgreSQL sidecar and AGS Wallet mirroring
disabled:

1. `GET /jade` returned balance `5000` and `eligible: true`.
2. `POST /jade/reservation` returned reserved `300` and available `4700`.
3. `DELETE /jade/reservation` returned reserved `0` and available `5000`.

## Browser journey assertions

The four-human Playwright script now records each player's starting balance and
requires all four result views to:

- expose the same non-empty settlement journal ID;
- conserve the starting and ending total Jade supply;
- sum personal deltas to zero;
- satisfy `before + delta = after` per player;
- expose the stable `data-wallet-sync-status="synced"` contract and the
  user-facing `AGS Wallet synced` status;
- show the same settled balance again after returning to the lobby.

The service now performs a post-write AGS Wallet readback and reports `synced`
only when the observed balance exactly equals the authoritative ledger target.

## Closed live release gate

1. ~~Deploy the new `mahjong-match-service` image.~~ **Done** — image
   `wallet-verify-20260725`, deployment
   `749f038b-ba2e-4cf6-a90c-8da6db0e8fe6`, immutable manifest
   `sha256:ddb33ef8798bebc2875f557c788cd435f08d17a8312c7eba9df1dffeeb83626a`.
2. ~~Confirm the runtime IAM client can read, credit, and debit `JADE`
   wallets.~~ **Done** — live IAM readback shows Platform Store / Wallet Read
   + Update on runtime client `72498bf13af54deabafdcba90d1ce497`.
   A reversible one-Jade production probe verified credit and debit and was
   restored to zero.
3. ~~Run the four-human browser journey against the deployed base path.~~
   **Done** — four distinct guest accounts entered one real Session, passed
   seat privacy and reconnect checks, and completed 123 legal actions.
4. ~~Record the shared settlement journal and four converged wallet
   balances.~~ **Done** — journal
   `settlement:c1c083794fa8d7553b1c3ffa7df1672d8adf13b3ba897af233397f2c2ef0d0a8`;
   Wallet status `synced` for all four seats; returned balances 5,000 each;
   total before and after 20,000.

The PostgreSQL ledger path and the AGS Wallet mirror are separate release
questions. Reaching the shared result proves the authoritative match and
ledger path; only a green post-write Wallet readback proves convergence.

## Wallet convergence diagnosis (2026-07-25)

The deployed Extend runtime client is
`72498bf13af54deabafdcba90d1ce497`
(`extend-mahjong-match-service`, Confidential). A live IAM read showed:

- `clientPermissions: []`;
- `m_session / g_game_session [READ]`;
- `m_session / g_session_storage [READ]`;
- no Platform Store / Wallet permission.

The three generated SDK operations used by reconciliation are:

- `QueryUserCurrencyWalletsShort` — Wallet Read;
- `CreditUserWalletShort` — Wallet Update;
- `DebitUserWalletByCurrencyCodeShort` — Wallet Update.

The pinned AGS Go SDK specification resolves the protected resource to
`ADMIN:NAMESPACE:{namespace}:USER:{userId}:WALLET [READ, UPDATE]`. In Shared
Cloud, the predefined Admin Portal permission is **Platform Store / Wallet**
with **Read + Update**. The
[official AGS backend Wallet example](https://docs.accelbyte.io/gaming-services/modules/foundations/extend/override/entitlement-revocation/get-started-entitlement-revocation/)
uses that same group and action pair.

```text
Authorization preflight

  Caller:                backend service
  Environment:           shared cloud
  Environment evidence:  gameswithout-mahjong.prod.gamingservices.accelbyte.io
  Token source:          service/server token
  IAM client type:       confidential
  Secret location:       Extend server-side secret injection
  AGS calls:             Wallet summary, credit, debit, post-write readback
  Permission discovery:  AGS CLI operation discovery + pinned SDK spec
  Required permissions:  Wallet READ and UPDATE
  Shared Cloud groups:   Platform Store / Wallet / Read + Update
  Verified access:       yes — runtime client readback shows Wallet [READ,
                         UPDATE], and live credit/debit/readback succeeded
```

After the permission was granted, the remaining production failure was not an
authorization issue. The pinned generated SDK emits uppercase `SYSTEM` for the
balance-origin enum and validates it case-insensitively, while the live Wallet
API rejects that value with error `20018` and accepts `System`. The service now
constructs both credit and debit requests with the live API's mixed-case
value, with a regression test protecting both request shapes.

Image `wallet-reconcile-20260725-r3` is running in deployment
`f9fee13c-2aa5-40ad-99cf-570d1c7443df`. Its per-target reconciliation timeout
prevents one slow Wallet from consuming the whole batch, pending targets are
processed before stale failures, and the client exposes truthful
pending/syncing/error/synced status without leaking backend error details.

## Four-human stall — root cause (2026-07-25)

The stall that blocked item 3 was the Jade economy tearing the table down at
the moment the hand ended. Chain, confirmed end to end:

1. `GetMatchState` calls `economy.Bind` on **every** poll for any non-Practice
   match (`pkg/service/match_service.go`). Practice is exempt, which is why
   only the four-human online journey ever stalled.
2. Settlement marks that match's reservations `consumed`
   (`SettleJadeMatch`, `pkg/storage/jade.go`).
3. `BindJadeReservation` only accepted `active` or `bound`, so from the first
   post-settlement poll onward it returned `ErrReservationMissing`.
4. `rpcError` maps that to `FailedPrecondition` → **HTTP 400**.
5. The client's `errorCodeForStatus` maps any such 4xx to `protocol`, which is
   absent from `MATCH_RUNTIME_RETRYABLE_CODES`, so every client left `joined`
   and unmounted the table — all four at once, with no recovery path.

Clients poll precisely because they are showing the result screen, so this
fired every time, for everyone, immediately after the hand it was meant to
settle.

Fixed on both sides:

- **Server** — `BindJadeReservation` treats a reservation already consumed by
  *this* match as success. A player who never reserved is still rejected;
  covered by `TestPostgreSQLStorage_JadeReservationAndSettlementAreAtomicAndIdempotent`,
  which reproduces the exact live error without the fix.
- **Client** — a failed poll no longer tears down a live table. The last
  authoritative view stays on screen behind a "Reconnecting" notice while
  polling retries, and only escalates to the manual error panel after
  `STALLED_TABLE_GRACE_MS`. This makes the whole class of transient
  server-side error survivable, not just this one.
