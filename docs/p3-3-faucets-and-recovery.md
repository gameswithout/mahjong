# P3.3 Faucets and Recovery — Completion Evidence

- Date: 2026-07-26
- Scope: daily Jade play grants, anti-lockout welfare, and lobby recovery
- Result: implemented locally; not deployed by this change

## Player loop

A public human hand now earns 250 Jade for the first completion of the UTC day
and another 500 Jade at three completions. Repeated result polling cannot pay a
hand twice.

When a balance falls below Bamboo Courtyard's 1,000-Jade minimum, the lobby
states the recovery requirement:

1. finish one free AI Practice hand that UTC day;
2. claim the exact amount needed to return to 1,000 Jade;
3. re-enter Bamboo once the authoritative account becomes eligible.

The grant sets the balance to the floor rather than adding a fixed amount. It
cannot be claimed with an open reservation or more than once per UTC day.
Refused claims return a stable reason code and do not use an error response for
an ordinary eligibility outcome.

## Ledger and idempotency

- `jade_hand_participation` is keyed by player and runtime, so a completed
  hand counts once even though `GetMatchState` continues polling it.
- `jade_daily_grants` is keyed by player, UTC day, and grant kind.
- Every grant is a balanced double-entry journal against the Jade issuance
  treasury and queues the new authoritative balance for AGS Wallet mirroring.
- Welfare eligibility is decided again inside the account transaction after
  expired reservations are released and the account row is locked.

## Verification

```shell
npm test -- --run
npm run build
GOCACHE=/tmp/mahjong-p33-go-cache go test ./...
TEST_DATABASE_URL='postgres://…' \
  GOCACHE=/tmp/mahjong-p33-go-cache \
  go test -tags=integration ./pkg/storage -v
git diff --check
```

The PostgreSQL suite reaches a production-valid lockout by settling actual
four-seat hands rather than mutating balances, then verifies the Practice
prerequisite, one welfare claim per UTC day, first/third-hand grants, Practice
non-payment, migration concurrency, and whole-ledger conservation.

## Remaining boundary

The migration, RPC, Swagger contract, browser client, and UI are ready to ship,
but this commit does not deploy the Extend service or run a live authenticated
claim against AGS. Deployment should apply migration `004_jade_faucets.sql`
before the browser begins relying on the new welfare fields.
