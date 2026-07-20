# mahjong-match-service — Implementation Plan

## Target

A Go Service Extension providing the authoritative Mahjong match API.

Owned RPCs:

- `JoinMatch`
- `GetMatchState`
- `SubmitMatchCommand`

Server-internal transitions such as initial Flower replacement and claim
resolution will not be exposed as client RPCs.

REST surface:

- `POST /v1/namespaces/{namespace}/sessions/{session_id}/matches/{match_id}/join`
- `GET /v1/namespaces/{namespace}/sessions/{session_id}/matches/{match_id}`
- `POST /v1/namespaces/{namespace}/sessions/{session_id}/matches/{match_id}/commands`

`JoinMatch` conditionally creates the match from the fixed AGS Session roster,
persists one randomized seat assignment, and returns only the caller's
projection.

## Proto provenance

- `pkg/proto/service.proto` — owned by this project; replace the template's
  Guild example with the versioned Mahjong API.
- `pkg/proto/permission.proto` — retained from the official template.
- No AGS event or Override proto is consumed.
- Generated files under `pkg/pb/` must only be regenerated through the
  template's `make proto` workflow.

## Files to create

- `pkg/match/runtime.go` — match registry and single-writer actor ownership.
- `pkg/match/runtime_test.go` — concurrent initialization, authorization,
  retry, and recovery tests.
- `pkg/session/resolver.go` — AGS Session roster resolver interface.
- `pkg/session/ags_resolver.go` — confidential-client Session lookup adapter.
- `pkg/session/fake_resolver.go` — deterministic local/test roster resolver.
- `pkg/storage/migrations/001_match_runtime.sql` — match, seat-assignment,
  event, and snapshot schema.
- `pkg/storage/match_repository.go` — conditional match creation and seat
  persistence.
- `pkg/storage/event_store.go` — ordered transactional append-before-ack
  adapter.
- `pkg/storage/event_store_test.go` — sequence, concurrency, rollback, and
  recovery tests.
- `pkg/service/match_service.go` — implementations of the three owned RPCs.
- `pkg/service/match_service_test.go` — gRPC authorization and redaction tests.

## Files to modify

- `pkg/proto/service.proto` — replace Guild RPCs/messages and Cloud Save
  permissions.
- `main.go` — register the Mahjong service, resolver, actor registry, and
  PostgreSQL repositories.
- `pkg/storage/storage.go` — remove temporary `GuildProgress`; retain
  PostgreSQL pool construction.
- `docker-compose.yaml` — retain PostgreSQL and add only non-secret local
  configuration.
- `.env.template` — document Session resolver and SQL settings with
  placeholders.
- `go.mod` — replace the template's `extend-custom-guild-service` module
  identity.
- Root Go module — decide how the existing rules engine is shared without
  copying divergent implementations.
- README and Swagger assets — replace Guild instructions and generated API
  documentation.

## Storage contract

The SQL adapter must provide:

- conditional match creation keyed by namespace/session/match;
- canonical roster hash;
- immutable player-to-seat assignment;
- ordered per-match event sequence;
- unique request/idempotency keys;
- event append and actor acknowledgement ordering;
- periodic snapshots;
- replay hash verification;
- transaction rollback without state acknowledgement.

Cloud Save will not be used for gameplay events.

## External AGS APIs called

- IAM client-credentials/token flow used by the official Service Extension
  template.
- IAM token validation performed by the template interceptor.
- AGS Session detail lookup for the exact game-session roster.

The implementation uses the generated AGS Go SDK
`GameSessionService.GetGameSessionShort` operation and extracts the fixed
non-terminal member roster from `ApimodelsGameSessionResponse.Members`.

## Authorization preflight

```text
Caller:                Backend Service Extension
Environment:           AGS Shared Cloud
Environment evidence:  gameswithout-mahjong.prod.gamingservices.accelbyte.io;
                       namespace gameswithout-mahjong
Token source:          Confidential service/server token
IAM client type:       Confidential, dedicated per app
Secret location:       Extend deployment secret configuration only
AGS calls:             IAM bootstrap/token validation; Session detail lookup
Permission discovery:  Completed through the AGS client/permission catalog
Required permissions:  Session game-session READ
Shared Cloud groups:   Session / Game Session
Verified access:       Dedicated client created and client login verified;
                       live user smoke test now needs a fresh auth-code login
```

**Deployed runtime client differs from the discovery client above.** The
live Extend deployment (see "Deployment record" below) runs under an
AGS-platform-provisioned confidential client
(`AB_CLIENT_ID=72498bf13af54deabafdcba90d1ce497`, managed as an Extend app
secret, not the manually created `e411a963a6bc42239dc27e39e3a03440` client
referenced in local `.env`). Its Session game-session READ permission has
**not yet been live-verified** — first sign it's missing/wrong will be
`JoinMatch` failing at runtime. Verify before relying on this deployment for
a real match.

Browser players continue authenticating with the existing Public client and
user access token. No confidential credential enters the browser, repository,
image, event log, or public payload.

## Open prerequisites

- [ ] Rotate the unrelated confidential credential exposed by Compose
  interpolation.
- [x] Create a dedicated confidential IAM client for
  `mahjong-match-service`.
- [x] Run live Session-operation and Shared Cloud permission-group discovery.
- [x] Confirm the dedicated client has only IAM bootstrap and Session-read
  permissions.
- [x] Decide the inbound player permission annotations for the custom RPCs:
  bearer validation is required, while no unverified custom AGS permission
  resource is fabricated.
- [x] Provision the managed SQL resource and obtain its Aurora CA path.
  Provisioned via AGS Extend's SQL cluster offering (AWS RDS Aurora
  Postgres, `extend-sql-gameswithout-prod` cluster, `us-east-2`), linked to
  the `mahjong-match-service` Extend app through the Admin Portal — not
  self-hosted Postgres. The platform auto-injects connection config
  (`SQLDB_HOST`/`SQLDB_DATABASE_NAME`/`SQLDB_USERNAME`/`SQLDB_PASSWORD`) and
  auto-mounts the CA bundle at `/srv/certs/sql/global-bundle.pem` as a
  non-editable app variable; these are not hand-provisioned or baked into
  the image.
- [x] Select a versioned migration mechanism: embedded ordered SQL migrations
  with a transactional `schema_migrations` ledger.
- [x] Keep the existing `rulesengine` as the single implementation used by
  both the local walking skeleton and Extend image. Local compilation consumes
  the canonical parent module through a Go `replace`; the checked-in Go vendor
  bundle supplies that same source to standalone image builds. Publish an
  immutable parent-module version as a future cleanup.
- [x] Keep v1 transport on REST commands plus state polling. Persistent Extend
  ingress is not required for P0; AGS Lobby notifications remain a later
  latency optimization.
- [ ] Benchmark synchronous append latency against the deployed Aurora
  cluster. Local PostgreSQL baseline on an Apple M1 Pro is 1.47–1.56 ms per
  transactional append (three 500-operation samples). **Still not repeated
  against the managed SQL from the deployed region** — the 2026-07-19 deploy
  (see "Deployment record" below) went ahead without this benchmark, on
  explicit user direction to proceed despite the gap. Append latency and the
  §15.5 command-ack targets are unverified in production; run this before
  trusting the deployment under real match load.
- [ ] Decide whether `mahjong-match-service` remains a separate repository or
  becomes a tracked directory in the parent repository.

## Verification

- [x] Concurrent `JoinMatch` calls create exactly one roster and seat
  assignment.
- [x] Four fixed Session members receive one E/S/W/N permutation.
- [x] Non-members and fifth players fail without creating state.
- [x] Seats remain identical after process restart.
- [x] Commands are durably appended before acknowledgement.
- [x] Duplicate requests return their original committed result.
- [x] Final-claim resolution recovers from a cross-replica sequence race, and
  a duplicate final response retries or returns the committed resolution.
- [x] Recovery produces byte-equivalent per-seat projections.
- [x] No concealed tiles, wall order, private claims, tokens, or secrets leak
  through the caller projection.
- [x] Unit, contract, race, PostgreSQL migration/concurrency, two-replica
  initialization, two-replica command, and local REST restart-recovery checks
  pass. The complete unit/contract suite also passes with the Dockerfile's
  exact Go 1.24.10 toolchain. The PostgreSQL two-replica suite passes 20
  consecutive runs, including simultaneous inserts that may conflict on
  either the match identity or deterministic runtime primary key. State and
  command requests also restore on a replica that never handled `JoinMatch`,
  and cached replicas refresh from the persisted event head before serving, so
  the service does not rely on load-balancer affinity or serve indefinitely
  stale projections. Runtime locking is keyed by match, preserving table order
  without serializing unrelated matches.
- [ ] Docker/Compose image build passes after replacing the parent-module
  `replace` directive with an immutable shared rules-engine version — the
  immutable-version replacement itself is still not done, so this box stays
  open. What **is** now confirmed (2026-07-19): the vendor-mode build
  (`-mod=vendor`, the exact build the Extend image uses) passes today as-is,
  still on the `replace` directive plus the checked-in vendor bundle.
  Protobuf/gRPC/gateway/OpenAPI generator versions are already pinned in the
  Dockerfile.
- [ ] AGS-backed Session smoke test (`JoinMatch` against a real four-member
  AGS Session) still not run. The 2026-07-19 deploy confirmed the service is
  reachable and enforces auth (unauthenticated request to the live URL
  returned 401), but that is not a substitute for an authenticated
  Session-roster smoke test. Also still needs a fresh `mahjong-admin`
  auth-code login.

## Deployment record

Deployed 2026-07-19 to AGS Extend, on explicit user direction to proceed
ahead of the append-latency benchmark and full Session smoke test above.

```text
App:            mahjong-match-service (service-extension scenario)
Namespace:      gameswithout-mahjong
Base URL:       https://gameswithout-mahjong.prod.gamingservices.accelbyte.io
Base path:      /ext-gameswithout-mahjong-mahjong-match-service
                (platform-assigned; NOT /mahjong — anything wiring a client
                at this service must use the real base path, not the local
                dev value from README/.env.template)
Service URL:    .../ext-gameswithout-mahjong-mahjong-match-service
Image tag:      cors-fix-1 (2026-07-19, supersedes 9eb21b7 and 43da5de-wip —
                see below for what changed in each)
Database:       AGS Extend SQL cluster — AWS RDS Aurora Postgres,
                extend-sql-gameswithout-prod, us-east-2
Verified:       Image push + deploy succeeded; app status
                deployment-running; unauthenticated request to the live
                REST surface returns 401 (service reachable, auth enforced);
                CORS preflight (OPTIONS) against the live URL confirmed
                returning Access-Control-Allow-Origin: * (2026-07-19); local
                end-to-end browser run (guest sign-in → real AGS Session →
                join → full match table render) verified against this same
                code running locally, including the new projection fields
                arriving over the wire with correct snake_case names
Not verified:   Runtime IAM client's Session-read permission against a real
                (non-test-mode) AGS Session; append latency against the real
                cluster; full authenticated JoinMatch smoke test against the
                live deployed URL specifically (only verified locally)
```

**Revision history:**
- `9eb21b7` — initial deployment (REST match service live).
- `43da5de-wip` — extended `MatchState` to feature parity with the client's
  `SeatView` (waits, melds, discards, turn_deadline, hand_result,
  settlement, next_dealer, claim.options with win preview), switched the
  gRPC-gateway JSON marshaler to `UseProtoNames` (snake_case wire format
  matching the client's existing types). Done to unblock retargeting the
  browser client from the undeployed `server/cmd/walking-skeleton` WS
  prototype to this REST service.
- `cors-fix-1` — added CORS middleware (`main.go`). Discovered via a real
  browser (Playwright) end-to-end test: the deployed service had no
  `Access-Control-Allow-Origin` handling at all, and neither does AGS's
  platform gateway in front of it — every browser call was silently blocked
  by CORS preflight. This was a hard blocker for the REST client, not a
  nice-to-have.

## Out of scope

- Live IAM permission mutation during implementation.
- Lobby notification transport.
- Matchmaking Override.
- Bots, settlement, Jade ledger, progression, ratings, or achievements.
- Regional failover and production capacity rollout.
- Reusing the unrelated tooling credential.
