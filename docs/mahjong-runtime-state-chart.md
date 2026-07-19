# Match turn state chart (E1.F4 contract draft)

This is the normative transition contract for the rules engine. The current
repository implements setup, wall, deal, Flower replacement, turn/claim
transitions, structural evaluation, and the E2 match-actor boundary. Commands
are reduced on a cloned engine, appended to the event store before the actor
swaps state, and exposed through a per-seat redacted projection.

## States

| State | Owner | Meaning |
| --- | --- | --- |
| `InitialReplacement` | server | East, South, West, North are processed in order; Flowers are exposed and replaced until playable or the reserve boundary. |
| `AwaitingDraw` | active seat | The active seat must draw from the front of the deque. |
| `OfferPending` | active seat | The server may offer Eight Flowers, Heavenly Hand, or another explicitly defined special win; timeout/pass never auto-declares it. |
| `AwaitingDiscard` | active seat | The active seat has a playable tile and must submit one legal discard or a server timeout produces the canonical auto-discard. |
| `ClaimWindow` | eligible seats | Eligible Win/Pong/Kong/Chow responses are collected privately until every response arrives or the authoritative deadline expires. |
| `ReplacementChain` | active seat | A successful Kong or drawn Flower requires a back draw; chained Flowers remain server-controlled. |
| `ExhaustiveDraw` | server | The next mandatory draw would cross the 16-tile reserve; the hand ends without drawing into the reserve. |
| `HandComplete` | server | A legal win, Eight Flowers, or exhaustive draw has been recorded and no further commands are accepted. |

## Transitions

```text
InitialReplacement
  -> OfferPending       when an explicit initial offer exists
  -> AwaitingDiscard    after replacement completes with no pending offer;
                        East already has the dealer's seventeenth tile

AwaitingDraw
  -> OfferPending       after a draw/replacement creates an explicit offer
  -> AwaitingDiscard     after a playable front draw
  -> ReplacementChain    when the draw is a Flower or a Kong replacement is due
  -> ExhaustiveDraw      when a front draw would leave only the reserve

OfferPending
  -> AwaitingDiscard     when the player passes or the offer lapses
  -> HandComplete        when the player explicitly accepts a legal win

AwaitingDiscard
  -> ClaimWindow          after a discard is appended to the public discard log
  -> HandComplete         when a legal self-draw win is explicitly accepted

ClaimWindow
  -> HandComplete         when one or more legal Win claims resolve
  -> AwaitingDiscard      when a Pong/Kong claim resolves for its claimant
  -> AwaitingDraw         when the window resolves with no claim (next seat)
  -> AwaitingDraw         when a server timeout selects Pass (no deliberate-pass lock)

ReplacementChain
  -> AwaitingDiscard      after a playable back draw and chained Flowers finish
  -> ExhaustiveDraw       when the mandatory replacement reaches the reserve boundary
```

## Invariants

- Every accepted command includes a match `state_version` and action ID. A
  stale version, duplicate action ID, or late deadline is rejected without a
  state mutation.
- Claim responses remain private until resolution. Resolution precedence is all
  legal Wins, then one Pong/Kong by counter-clockwise proximity, then Chow by
  the next seat. The server automatically appends the resolution transition
  when every eligible seat has responded; no client can submit it.
- A deliberate discard-Win Pass creates the temporary win lock described in
  §5.8. A timeout/disconnect-selected Pass does not create that lock.
- The 16-tile reserve is never drawn. If a mandatory replacement is required
  at the boundary, the hand ends as an exhaustive draw.
- Every transition is replayable from the seeded setup plus the ordered event
  log; no client-supplied user ID, hand, wall position, or legality result is
  authoritative.
- `match.created` stores the initial snapshot. Later command events carry the
  command, resulting state hash, and periodic state snapshot; recovery replays
  after the newest snapshot and rejects a hash mismatch before serving a seat.
- A seat view contains its own concealed hand, public exposed zones, and only
  counts for other concealed hands. The unrevealed wall and other seats'
  concealed tile IDs are never serialized; unresolved claim responses expose
  only the requesting seat's own response.
