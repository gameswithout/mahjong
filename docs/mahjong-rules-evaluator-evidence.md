# Rules evaluator evidence

- Date: 2026-07-18
- Status: structural evaluator, waits, and deterministic scoring implemented

## Delivered

- `rulesengine/evaluator.go`
  - validates physical tile uniqueness and meld shape;
  - finds all normal five-meld-plus-pair decompositions;
  - chooses a canonical decomposition key for replay stability;
  - returns one available physical representative per winning tile type;
  - provides `DefaultWinValidator`, now installed by `TurnEngine` by default.
- `rulesengine/scoring.go`
  - scores Base Win, concealed/Zimo variants, Chow/Pong/Kong patterns,
    All Chows, All Pongs, Fully Exposed, Dragon/Wind sets, flushes, honors,
    Flower patterns, Eight Flowers, and event patterns supplied through
    `ScoreContext`.
- `rulesengine/evaluator_test.go` and `scoring_test.go`
  - named structural, wait, invalid-input, validator, scoring, and
    deterministic decomposition goldens.

## Verification

```text
go test ./server/... ./rulesengine — passed
go test -race ./server/... ./rulesengine — passed
npm test — 22 passed
npm run build — passed
git diff --check — passed
```

## Deliberate boundaries

- `ScoreContext` carries event facts such as Zimo, replacement, last tile,
  Heavenly/Earthly Hand, and Single Wait. The actor will derive those facts
  from the event log once durable match events exist; the browser cannot set
  them authoritatively.
- Settlement/Jade transfer, cap allocation, and rating are not part of this
  evaluator slice.
- The scorer accepts the current flattened `PlayerState.Melds` model. The
  actor's per-seat projection must redact hidden tiles before sending it to a
  client.
