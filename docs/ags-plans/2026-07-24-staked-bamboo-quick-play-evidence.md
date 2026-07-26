# M3B Staked Bamboo Quick Play — Verification Evidence

- Date: 2026-07-24
- Scope: authoritative Jade ledger, public-queue reservation, four-seat
  settlement, player UI, and AGS Wallet reconciliation worker
- Result: implementation and live four-account gameplay verified; AGS Wallet
  permission and convergence remain the final release gate

## Live AGS configuration

- Namespace: `gameswithout-mahjong`
- Currency: `JADE`
- Symbol: `玉`
- Type: virtual
- Decimal places: `0`
- Created: `2026-07-24T16:14:12.795Z`
- Verification: the service credential created the currency and the AGS CLI
  returned it from the namespace currency list.

No live player balance was mutated during local verification.

## Automated verification

| Check | Result |
| --- | --- |
| Client unit/component suite | 44 files, 334 tests passed |
| Client production build | Passed; 430 modules transformed |
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
- expose `data-wallet-sync-status="synced"` and the exact
  `AGS Wallet synced` status;
- show the same settled balance again after returning to the lobby.

The service now performs a post-write AGS Wallet readback and reports `synced`
only when the observed balance exactly equals the authoritative ledger target.

## Remaining live release gate

1. ~~Deploy the new `mahjong-match-service` image.~~ **Done** — image
   `wallet-verify-20260725`, deployment
   `749f038b-ba2e-4cf6-a90c-8da6db0e8fe6`, immutable manifest
   `sha256:ddb33ef8798bebc2875f557c788cd435f08d17a8312c7eba9df1dffeeb83626a`.
2. Confirm the runtime IAM client can read, credit, and debit `JADE` wallets.
   **Blocked by a confirmed permission gap:** the client has only Session
   groups and lacks Platform Store / Wallet Read + Update.
3. Run the four-human browser journey against the deployed base path.
   **Gameplay portion done:** four distinct guest accounts created a real
   four-member Session, joined, passed seat privacy and reconnect checks,
   played 125 authoritative actions, and reached the shared result. The
   overall release script correctly remains red at the Wallet assertion.
4. Record the shared settlement journal and four converged wallet balances.
   **Open until item 2 is granted and the journey is rerun.**

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
  Verified access:       no — permission absent on the live runtime client
```

The configured `ags_api` MCP server completed its browser OAuth flow
successfully. MCP uses a dynamically registered public OAuth client for its
PKCE callback; the supplied `373617a151fe4d3f92be11f4a045cba5` remains the
separate Confidential CLI/tooling identity and is not exposed to the browser.
The current Codex session cannot hot-load tools authenticated after startup, so
the permission was not mutated. Reload Codex, grant Read + Update through the
authenticated MCP path, restart/redeploy the app once for a fresh
client-credentials token, then run `npm run test:four-human`.

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
