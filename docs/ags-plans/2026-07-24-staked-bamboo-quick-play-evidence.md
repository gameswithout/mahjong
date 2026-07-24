# M3B Staked Bamboo Quick Play — Verification Evidence

- Date: 2026-07-24
- Scope: authoritative Jade ledger, public-queue reservation, four-seat
  settlement, player UI, and AGS Wallet reconciliation worker
- Result: local implementation verified; live Service Extension deployment
  and four-human Wallet convergence remain the release gate

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
| Client unit/component suite | 19 files, 131 tests passed |
| Client production build | Passed; 426 modules transformed |
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
- show the same settled balance again after returning to the lobby.

These assertions are checked into `scripts/test-four-human.mjs` but cannot be
claimed as live evidence until the new Service Extension image is deployed.

## Remaining live release gate

1. Deploy the new `mahjong-match-service` image.
2. Confirm the runtime IAM client can read, credit, and debit `JADE` wallets.
3. Run the four-human browser journey against the deployed base path.
4. Record the shared settlement journal and four converged wallet balances.
