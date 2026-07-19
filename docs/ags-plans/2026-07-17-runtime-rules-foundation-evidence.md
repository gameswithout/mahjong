# P0/P1 Evidence — Match Runtime and Deterministic Rules Foundation

- Date: 2026-07-18
- Features: authenticated WebSocket walking skeleton; tile/state model; seeded
  wall/deal; turn and claim transition core; evaluator/scoring; browser
  runtime adapter; append-before-ack match actor; per-seat projections
- Status: Rules, local match actor, authenticated commands, and per-seat
  broadcasts implemented; automated and live service verification complete

## Implemented artifacts

- `server/auth`: AGS IAM bearer verification through
  `/iam/v3/public/users/me`; no user ID supplied by the
  browser is trusted.
- `server/match`: authenticated WebSocket upgrade, localhost origin guard,
  actor registry, seat-authorized commands, per-seat broadcasts, typed
  `server.ready`, `pong`, and stable protocol error envelopes.
- `server/cmd/walking-skeleton`: `/healthz` and `/ws` local service entrypoint.
- `server/protocol` and `protocol/envelope.ts`: protocol version 1 envelope
  definitions shared by the Go boundary and TypeScript client work.
- `rulesengine/turn.go`: versioned draw/discard cycle, private claim window,
  physical Pong/Kong/Chow validation, injected Win validation, claim priority,
  deliberate-pass lock, deadline handling, and replacement/exhaustive-draw
  transitions.
- `client/match-runtime.ts`: browser WebSocket adapter that offers a fixed
  `ags.bearer` protocol and a separate base64url credential protocol, waits for
  `server.ready`, and exposes typed join/command/state envelopes without
  logging credentials. The server selects only the fixed protocol.
- `rulesengine/evaluator.go` and `rulesengine/scoring.go`: canonical normal
  hand decomposition, waiting-tile enumeration, default structural Win
  validation, and deterministic Tai pattern selection. Details and explicit
  boundaries are recorded in `docs/mahjong-rules-evaluator-evidence.md`.
- `rulesengine/eventlog.go`: `MatchActor`, append-only `MatchEvent` records,
  periodic embedded snapshots, request-id idempotency, file-backed JSONL
  storage with `Sync`, and deterministic recovery/hash verification.
- `rulesengine/projection.go`: `SeatView` redaction with own-hand access,
  public zones, other-hand counts, and claim-response privacy.
- `rulesengine`: stable 144-tile catalog and SHA-256 catalog hash; deterministic
  seeded shuffle; 72 two-tile stack layout; dice break selection; front/back
  wall draws; 16-tile replacement reserve; four-pass deal plus East's extra
  tile; mandatory initial and chained in-play Flower replacement; state
  snapshot and hash.

## Verification

```text
GOCACHE=/tmp/mahjong-go-cache GOMODCACHE=/tmp/mahjong-go-mod go test ./server/... ./rulesengine
ok  server/auth
ok  server/match
ok  server/protocol
ok  rulesengine
npm test — 24 tests passed
npm run build — passed (Vite emitted the existing large-chunk warning)
go test -race ./server/... ./rulesengine — passed
go vet ./server/... ./rulesengine — passed
```

The tests cover authenticated ping, unauthenticated rejection, protocol error
handling, non-echoing subprotocol token extraction, fake IAM verification,
seat authorization, typed join/command/state routing, per-seat broadcasts,
automatic all-response claim resolution, actor restart recovery and duplicate
requests, stable JSON,
catalog counts and IDs, deterministic state hashes, no duplicate dealt tiles,
65 dealt / 79 wall / 63 drawable, front/back reserve counters, exhaustive
initial Flower replacement ordering, reserve-boundary rejection, draw/discard
versioning, claim priority, deliberate-pass locks, late/duplicate action
  rejection, Kong-at-boundary termination, browser adapter handshakes, actor
  append failure rollback, request idempotency, JSONL recovery, replay hash
  verification, and hidden-information projection checks.

## Decisions and assumptions

- Browser WebSocket authentication uses a fixed selectable `ags.bearer`
  protocol and a separate unselected `ags.token.<base64url-token>` offer
  because browser WebSocket constructors cannot set an arbitrary
  `Authorization` header. The credential is never logged or echoed as the
  selected subprotocol.
- The local service accepts empty origins and `localhost`/`127.0.0.1` origins.
  A deployed origin allowlist and TLS termination are still required before
  exposing this endpoint outside local development.
- The verifier uses AGS's title-level current-user endpoint. The AGS IAM
  public client remains browser-only; no confidential tooling secret is read by
  or compiled into this service.
- `FlattenStacks` preserves a deterministic seeded sequence and the specified
  dice-side formula. Physical right-edge coordinate mapping is deliberately
  isolated for the next wall-geometry review, so replacing it later does not
  change the protocol or state model.
- The initial deal models the spec's 65 consumed tiles and 16-tile reserve.
- `TurnEngine` still accepts an injected `WinValidator` only for tests or an
  alternate ruleset; production construction installs the structural default.
- `FileEventStore` is intentionally a local recovery adapter. The production
  Extend/AGS app-owned store must implement the same append-before-ack contract
  and is subject to the capability-mapping and latency/durability spike.
- The actor stores public event metadata and state hashes, never AGS client
  secrets. Event snapshots are server-side recovery data and are not browser
  payloads.

## Run locally

```bash
set -a; source .env; set +a
AGS_BASE_URL="$ACCELBYTE_BASE_URL" AGS_NAMESPACE="$ACCELBYTE_NAMESPACE" \
  MATCH_RUNTIME_ADDR=:8081 go run ./server/cmd/walking-skeleton
curl http://127.0.0.1:8081/healthz
```

Live verification used four fresh Device ID guests and confirmed IAM
current-user verification, the fixed selected WebSocket protocol, E/S/W/N
assignment, East's 17-tile initial view, an accepted initial discard, three
private Pass responses, server-owned claim resolution, and South's next draw.
The next implementation boundary is an AGS Session-authoritative seat resolver
and the production AGS/Extend app-owned event store. The turn/claim contract is
recorded in `docs/mahjong-runtime-state-chart.md`.
