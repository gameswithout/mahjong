# Full Rotation (§8.4) — playable mode complete

- Date: 2026-07-30
- Status: **implemented, configured, tested, and released as a playable public
  mode.** The remaining Elo, seasonal leaderboard, placement statistics, and
  rotation-achievement counters are the P2.4 competitive-progression slice,
  not prerequisites for playing a rotation.

## What §8.4 actually asks for

One East round in which every player is scheduled to deal once, subject to
§5.11 continuations and a 60-minute limit. Three things about it are easy to
get wrong, and all three drove the design:

**It uses no Jade.** "Public Full Rotation is ranked and uses no Jade." It
scores in *table points*: everyone starts at 0, transfer is winner raw Tai plus
applicable Dealer Tai, no cap and no stake multiplier, and totals may go
negative. Table points are not an account currency, so none of the Jade
machinery — reservations, the debit cap, the ledger, welfare — applies. This
removes a great deal of expected work rather than adding it.

**A continuation is not progress.** The round ends when every seat has *dealt*,
which §5.11 lets a winning dealer postpone indefinitely. A match therefore ends
on the hand where the fourth dealership finally passes on, not on the fourth
hand.

**The 60-minute limit is a distinct ending.** At the limit the current hand
finishes and the match ends even with the rotation incomplete. §8.4 calls such
a match "structurally asymmetric" and makes the share of them a mandatory
telemetry metric, so the two endings cannot be recorded as one.

## What landed

`rulesengine/rotation.go` — the pure domain, no I/O:

- `RotationState`: dealer, continuations, per-seat tallies, start time. A value,
  not a mutable object, so replaying the same hands lands in the same place.
- `ApplyHand`: settles table points, updates tie-break counters, advances the
  dealer, and decides whether the match ended and why.
- `FinalPlacement`: ranks by net table points with §8.4's display-only
  tie-break — fewer deal-ins, more Zimo wins, greater raw Tai won, then the
  randomized initial seat order.

Two deliberate reuses rather than reimplementations:

- **Table points go through `SettleHand`** at stake 1 with the cap lifted.
  §8.4 says they follow "the same payer and multiple-winner rules as Jade but
  with no cap and no stake multiplier" — that *is* `SettleHand`. A parallel
  implementation would drift on exactly the rules hardest to get right
  (multiple winners, three-opponent Zimo, dealer Tai).
- **Dealer sequencing goes through `NextDealerState`**, the §5.11 table Quick
  Play already uses.

`mahjong-match-service/pkg/progression/rotation_xp.go` — §12.1 scoring: a flat
50 per hand and 400/250/150/100 on final placement. Kept separate from `HandXP`
because the modes share almost nothing; a Full Rotation hand must not pay Quick
Play's win, Zimo, or Tai bonuses, and a test pins that.

`RatingTie` travels on every placement. §8.4 makes equal table points a genuine
rating tie even though the podium displays an order, so whatever computes Elo
must not read `Position` as a clean result.

## Playable implementation

- **Schema and sequencing** — migration 007 stores the rotation and its hand
  history. The runtime opens each next hand above the existing per-hand actor,
  turns player winds with the dealership, preserves continuations, and ends
  after all four players have dealt or after the hand in progress at the
  60-minute limit.
- **Server-owned mode selection** — the AGS Session template carries
  `full_rotation: true`; clients select only the dedicated match pool. A client
  cannot turn a Quick Play session into a rotation by changing a request body.
- **Scoring and progression** — hands settle only in table points, never Jade.
  Per-hand and final-placement XP are awarded idempotently.
- **Player experience** — the linked-account-only lobby entry, mode-specific
  queue/cancel/retry flow, running standings, inter-hand countdown, final
  podium, and Full-Rotation Play Again flow are wired. Guest accounts never
  receive the queue action.
- **Timing** — new Full Rotation hands use the ranked 12-second turn and
  5-second interception preset. Bamboo Quick Play is separately pinned to its
  intended 15-second/10-second beginner preset; Practice remains untimed.
- **Operations** — `mahjong-full-rotation-pool` points at
  `mahjong-full-rotation`, which mirrors the proven Quick Play template except
  for its name and server-consumed mode attribute. The production Pages bundle
  receives this pool through `ACCELBYTE_ROTATION_MATCH_POOL`.
- **Observability** — completed hands identify `full_rotation`; one
  `rotation_completed` event records the completion reason, hands played, and
  seats dealt without player identifiers.

Release verification and authorization evidence are recorded in
[`ags-plans/2026-07-30-full-rotation-player-flow-evidence.md`](ags-plans/2026-07-30-full-rotation-player-flow-evidence.md).

## What this unblocks

- **P2.4 competitive progression** — Elo is Full-Rotation-only (§12.4) and has
  no mode to attach to today.
- **Four §12.3 achievements** — Full Rotation Regular, Clean Defense, Rotation
  Master, Podium Regular.
- **The statistics dashboard's placement half**, which currently renders a
  "waiting on Full Rotation" message rather than an empty panel.

## Assumptions made

- `TablePointTier` uses `math.MaxInt32` as its cap because `SettleHand`
  requires a positive one. The largest hand §7.3 can produce is far below it,
  so no real settlement can reach it — but it is a bound, not a true absence,
  and worth knowing.
- A seat is recorded as having dealt when its hand *completes*, not when it
  begins, so an abandoned match does not credit a deal that was never played
  out.
- The time limit is evaluated at hand end only. §8.4 says the current hand
  finishes, so nothing checks the clock mid-hand.
