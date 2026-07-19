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
- [ ] Provision the managed SQL resource and obtain its Aurora CA path.
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
- [ ] Benchmark synchronous append latency before choosing Extend over the
  self-hosted Postgres fallback. Local PostgreSQL baseline on an Apple M1 Pro
  is 1.47–1.56 ms per transactional append (three 500-operation samples);
  repeat against managed SQL from the deployed region before the production
  decision.
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
  `replace` directive with an immutable shared rules-engine version. Protobuf,
  gRPC, gateway, and OpenAPI generators are pinned; image generation no longer
  depends on moving `latest` tags.
- [ ] AGS-backed Session smoke test passes after refreshing the expired
  `mahjong-admin` auth-code login.

## Out of scope

- Production deployment or app registration.
- Live IAM permission mutation during implementation.
- Lobby notification transport.
- Matchmaking Override.
- Bots, settlement, Jade ledger, progression, ratings, or achievements.
- Regional failover and production capacity rollout.
- Reusing the unrelated tooling credential.
