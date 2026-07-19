# Match actor and projection evidence

- Date: 2026-07-18
- Scope: E2.F1 append-before-ack actor, E2.F2 per-seat projection, and
  authenticated WebSocket command integration
- Status: local implementation, recovery tests, and live AGS-authenticated
  smoke complete

## Contract

`rulesengine.MatchActor` owns one `TurnEngine` and serializes commands under a
mutex. The actor clones the engine, applies the command, computes the resulting
state hash, and appends a `MatchEvent` before swapping the live engine or
returning a successful result. A failed append therefore cannot acknowledge a
state change. `ErrHandComplete` is a committed terminal transition and is
recorded with `error_code: "hand_complete"`.

Each match starts with a `match.created` event containing the initial deal and
turn snapshot. Command events contain the request ID, typed command, resulting
state version/hash, and the typed result. A snapshot is embedded every 30
events or after 30 seconds. Recovery loads the newest snapshot, replays later
commands, and rejects a state-hash mismatch.

`MemoryEventStore` is deterministic test infrastructure. `FileEventStore` is a
local JSONL adapter that opens in append mode and calls `fsync` (`Sync`) before
acknowledgement. AGS/Extend app-owned storage remains the production adapter
decision from the capability-mapping spike; it must preserve this interface's
ordering and idempotency guarantees.

## Hidden-information boundary

`TurnEngine.ProjectSeat` returns:

- the requesting seat's concealed hand;
- all public exposed tiles and the latest public discard;
- hand counts, meld counts, and wall counters for every seat;
- only the requesting seat's own unresolved claim response.

It never returns another seat's concealed tile IDs, unrevealed wall tiles, or
other seats' unresolved response types/selected IDs. `MatchActor.View` is the
actor-owned entrypoint for this projection.

## Verification

```text
go test ./server/... ./rulesengine — passed
go test -race ./server/... ./rulesengine — passed
go vet ./server/... ./rulesengine — passed
git diff --check — passed
```

The actor tests cover append failure without state mutation, request-id
deduplication, file-backed recovery with identical projections, replay hash
verification, and concealed-hand/wall/claim-response redaction.

The WebSocket integration tests additionally cover stable seat assignment,
active-seat command authorization, safe subprotocol selection without
credential echo, actor recovery across runtime reconstruction, and distinct
redacted broadcasts to two connected seats. Four live Device ID guests
completed IAM verification, joined as E/S/W/N, advanced through East's
17-tile opening discard and three Pass responses, then observed the
server-resolved South draw.
