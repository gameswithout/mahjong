# Mahjong Match Service

Authoritative Taiwanese Mahjong match runtime implemented as an AccelByte
Extend Go Service Extension.

The service owns six authenticated RPCs:

- `JoinMatch` creates or restores a match from a fixed AGS game-session roster.
- `GetMatchState` returns only the authenticated player's private projection.
- `SubmitMatchCommand` durably applies an idempotent draw, discard, or claim.
- `GetJadeAccount` creates or loads the caller's authoritative Jade account.
- `ReserveJade` and `ReleaseJade` gate the staked public queue.
- State and command requests lazily restore persisted matches on any replica;
  load-balancer session affinity is not required.
- Per-match locks preserve command order without serializing unrelated tables,
  and replicas check the persisted event head before serving cached state.

The generated REST surface is mounted below `/mahjong`:

```text
POST /v1/namespaces/{namespace}/sessions/{session_id}/matches/{match_id}/join
GET  /v1/namespaces/{namespace}/sessions/{session_id}/matches/{match_id}
POST /v1/namespaces/{namespace}/sessions/{session_id}/matches/{match_id}/commands
GET  /v1/namespaces/{namespace}/jade
POST /v1/namespaces/{namespace}/jade/reservation
DELETE /v1/namespaces/{namespace}/jade/reservation
```

## Architecture

```text
Browser → gRPC-Gateway → bearer auth → match service
                                           ├─ AGS Session roster resolver
                                           ├─ single-writer match actor
                                           ├─ PostgreSQL events + seats
                                           ├─ PostgreSQL Jade ledger
                                           └─ AGS Wallet balance mirror
```

- Caller identity is derived from the validated bearer token, never from a
  request body.
- The initial four-member AGS Session roster is hashed and persisted.
- Player-to-seat assignments are randomized once and immutable.
- The browser receives its own concealed hand, public tiles, and other-player
  hand counts. It never receives wall order or another concealed hand.
- Events are appended transactionally before a command is acknowledged.
- Duplicate request IDs return the previously committed result.
- Bamboo Courtyard reserves the 300 Jade maximum loss before matchmaking.
- Completed four-human settlements update all four balances in one PostgreSQL
  transaction. An append-only journal and runtime-derived idempotency key make
  repeated result reads safe.
- PostgreSQL is the gameplay authority. A retrying target-balance worker
  reconciles committed balances to the namespace's zero-decimal `JADE`
  virtual currency in AGS Wallet.
- AI Practice is free and never creates a Jade reservation or settlement.

## Requirements

- Go 1.24 or newer
- Docker with Compose
- For AGS-backed mode, a confidential service client with Session game-session
  read access
- For browser calls, a valid AGS user access token from the
  `gameswithout-mahjong` namespace

Copy `.env.template` to `.env`. Never commit `.env` or a client secret.

The project configuration uses:

```text
AB_BASE_URL=https://gameswithout-mahjong.prod.gamingservices.accelbyte.io
AB_NAMESPACE=gameswithout-mahjong
BASE_PATH=/mahjong
JADE_CURRENCY_CODE=JADE
JADE_WALLET_MIRROR_ENABLED=true
```

Set `JADE_WALLET_MIRROR_ENABLED=false` only for isolated local testing. The
authoritative local ledger still runs; only AGS Wallet reconciliation is
disabled.

## Fully local test mode

Start PostgreSQL:

```shell
docker compose up -d postgres
```

Run the service without contacting AGS:

```shell
PLUGIN_GRPC_SERVER_AUTH_ENABLED=false \
AB_BASE_URL=https://gameswithout-mahjong.prod.gamingservices.accelbyte.io \
AB_NAMESPACE=gameswithout-mahjong \
BASE_PATH=/mahjong \
MATCH_TEST_ROSTER=local-east,local-south,local-west,local-north \
MATCH_TEST_USER_ID=local-east \
SQLDB_HOST=127.0.0.1:5432 \
SQLDB_USERNAME=postgres \
SQLDB_PASSWORD=postgres \
SQLDB_DATABASE_NAME=mahjong_match \
go run .
```

`MATCH_TEST_ROSTER` and `MATCH_TEST_USER_ID` are test-only switches. The process
refuses to combine `MATCH_TEST_USER_ID` with enabled authentication.

Open Swagger UI:

```text
http://127.0.0.1:8000/mahjong/apidocs/
```

Join a local match:

```shell
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://127.0.0.1:8000/mahjong/v1/namespaces/gameswithout-mahjong/sessions/local-session-1/matches/local-match-1/join
```

## AGS-backed local mode

Leave `MATCH_TEST_ROSTER` and `MATCH_TEST_USER_ID` empty. Set:

```text
PLUGIN_GRPC_SERVER_AUTH_ENABLED=true
AB_CLIENT_ID=<dedicated confidential service client>
AB_CLIENT_SECRET=<secret supplied outside git>
```

The service logs in with client credentials for AGS Session lookups. Browser
requests must include `Authorization: Bearer <user-access-token>`. The Session
must contain exactly four non-terminal members, and the caller must be one of
them.

## Tests

Run unit and contract tests:

```shell
GOCACHE=/tmp/mahjong-match-service-go-cache go test ./...
```

Run race detection:

```shell
GOCACHE=/tmp/mahjong-match-service-go-race-cache \
go test -race ./pkg/common ./pkg/match ./pkg/service ./pkg/session ./pkg/storage
```

Run PostgreSQL integration tests after starting the sidecar:

```shell
TEST_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/mahjong_match?sslmode=disable' \
GOCACHE=/tmp/mahjong-match-service-go-cache \
go test -tags=integration ./pkg/storage -v
```

## Protobuf workflow

The API source is `pkg/proto/service.proto`. Regenerate checked-in Go bindings,
the REST gateway, and Swagger with:

```shell
make proto
```

Do not hand-edit files under `pkg/pb`.

## Standalone image dependency bundle

The shared rules engine remains canonical in the parent Mahjong module and is
consumed locally through:

```text
replace github.com/gameswithout/mahjong => ../
```

The service checks in Go's generated `vendor/` dependency bundle so the
standalone Extend image can build without resolving the parent directory.
Refresh it whenever the service dependencies or the canonical rules engine
change:

```shell
make vendor
```

The Docker build uses `-mod=vendor`; do not edit vendored source by hand.
Publishing the parent module as an immutable version remains a future cleanup,
but is no longer required to build and test the standalone image.

## Deployment

Deployed to AGS Extend (`gameswithout-mahjong` namespace, app
`mahjong-match-service`, service-extension scenario) via `extend-helper-cli
image-upload` + `deploy-app`, backed by an AGS Extend-provisioned SQL
cluster (AWS RDS Aurora Postgres). See `IMPLEMENTATION_PLAN.md`'s
"Deployment record" for the current image tag, service URL, and what has
and hasn't been verified against the live deployment (Session-read
permission and append latency against the real cluster are still
unverified). Live AGS permission changes remain outside this phase.

The deployed base path is platform-assigned
(`/ext-gameswithout-mahjong-mahjong-match-service`), not the `/mahjong`
value used for local dev above — do not assume the two match when wiring a
client at the live deployment.
