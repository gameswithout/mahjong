# P1 Onboarding and Repeat Play — Completion Evidence

- Date: 2026-07-26
- Scope: P1.1 tutorial vertical slice, P1.2 player-facing lobby hub,
  P1.3 session closure
- Branch: `worktree-p1-loop`, merged to `main`
- Result: implemented and covered by unit, component, and App-level
  integration tests

The P0 pass made a single hand legible. P1 is about the ring around it: how a
player learns the game, chooses what to play, and gets back into another hand
without returning to a development console.

## P1.3 Session closure

Play Again existed only in Practice. After a staked Bamboo hand the sole exit
was Return to Lobby and a manual re-queue, so the mode the product is built
around was the one that dead-ended. The specification is explicit that this is
wrong: §8.3 states that "Play Again returns the player to a fresh queue; it
does not preserve opponents or seats."

Staked Play Again now runs a three-step sequence, and the order carries the
correctness:

1. **Release the seat.** `leaveTable` reports whether the seat actually came
   free. A failed leave stops the requeue rather than taking a second Jade
   reservation while the finished table still holds the first.
2. **Re-read eligibility.** The balance is fetched immediately before
   committing, because settlement for the hand just played may still have been
   landing when the leave refreshed it.
3. **Queue a fresh ticket** through the existing staked matchmaking path.

An ineligible balance is reported in the lobby with the player's own numbers
and *without* a retry button — retrying could only queue the same rejection.
The requirement message distinguishes a player who is short from one whose Jade
is reserved behind another table; a player holding 5,000 Jade is never told
they are short of 1,000.

The Play Again button carries the stake it is about to commit
(`10 Jade per Tai · 300 Jade maximum loss`), derived from the server's own
per-Tai and cap values so the lobby, the result screen, and the table cannot
quote different numbers for the same tier.

Only a table entered through matchmaking offers this requeue. A manually
created or joined developer table returns to the lobby instead of silently
turning its result into a staked public-queue entry.

## P1.2 Player-facing lobby hub

The signed-in entry screen led with `Signed in`, a raw account UUID, and
`Lobby connected`. That is three lines of debug output above the two things a
player came for.

- **Header** answers who they are, what they can spend, and which ruleset they
  are about to play. Reserved Jade is disclosed beside the spendable balance
  rather than silently included or subtracted. The raw account ID moved into
  the existing developer-tools disclosure, where support can still reach it.
- **Connection state** earns a line only when it is not healthy. A permanent
  "connected" badge is status for its own sake.
- **Locked tiers.** Sparrow Pavilion, Wind and Cloud Lounge, and Dragon's Den
  now appear with their minimum, stake, cap, and the reason each is shut.
  Visibly inert — no buttons — so none of them reads as broken. Bamboo was
  previously the only table the lobby admitted existed, which made the economy
  look like a single room rather than a ladder.
- **Rules version** is printed from a client constant. That is only honest
  because `client/rules-version.test.ts` reads `economy.RulesVersion` out of the
  Go source and fails if the two ever drift.

### Queue health

Specification §8.7 requires that public queues, which need four humans and
never backfill with bots, offer a way out at 90 seconds. This was absent. The
queue now:

- reports its own elapsed clock rather than AGS's per-poll `queueTime`;
- escalates its wording at the §2.5 targets (30s, 90s);
- past 90 seconds offers a Practice hand instead, cancelling the ticket and
  releasing the Jade **before** starting the free hand, so a hand that costs
  nothing never sits on a reservation it does not need.

The ordinary Practice and developer-session controls are also disabled while
matchmaking owns the session transition. If ticket cancellation succeeds but
Jade release fails, the lobby stays blocked and offers **Retry releasing Jade**;
it cannot start another table until release is confirmed. If cancellation
itself cannot be confirmed, **Retry leaving queue** retries the original ticket
instead of creating a second one.

No queue message quotes a wait estimate. The client cannot see queue depth, and
an invented number is the one players would hold us to — `queue-health.test.ts`
asserts that no message contains a digit at all.

The specification also offers "a lower eligible Jade tier" at this point. This
build configures a single match pool, so that option is deliberately omitted
rather than rendered as a button that cannot work.

## P1.1 Tutorial vertical slice

Three chapters, on the real table:

1. **Five sets and one pair** — the winning shape, and shedding a tile that
   belongs to nothing.
2. **Chow, Pong, Kong** — claiming a discard, the upstream-only restriction on
   Chow, and claim priority.
3. **Ting, and what to discard** — reading the waits panel, choosing a safe
   discard from the discard rivers, and completing a hand.

It renders `MatchTable` — the component live play uses — fed scripted
`MatchTableState` fixtures. Not a diagram of the table, and not a second
implementation that would drift from it.

Steps are either *read* or *do*. A do step names the exact tile or button that
satisfies it and refuses anything else; a tutorial that accepts any input
teaches nothing. A wrong move re-states the goal rather than scoring the
attempt. Every step has a skip path, a replay path, and an analytics event.

The fixtures are versioned (`TUTORIAL_SCRIPT_VERSION`) so a completion marker
can eventually name *which* tutorial was completed. Every step is untimed, per
§5.10 — nothing here punishes a player for reading slowly.

Analytics events are emitted through an injectable sink that defaults to a
no-op, since E15 does not exist yet. The call sites and event shape are the
expensive part to retrofit; the transport is not.

### Fixtures tested as data

`client/tutorial/script.test.ts` treats the script as a data structure with
invariants, not as prose:

- unique step ids;
- every expected action is one the step's own table can actually accept;
- every failable step has a hint;
- every step is untimed;
- no hand exceeds the four-copy tile supply, and no physical tile appears in
  two places at once.

That last check earned its keep on first run: it caught a red dragon sitting in
both East's and South's discard rivers in chapter 1, step 3.

## Verification

```shell
npx vitest run          # 32 files, 238 tests passed
npx tsc -p tsconfig.app.json --noEmit
npm run build           # production build passed
go test ./...            # root Go suite passed
(cd mahjong-match-service && go test ./...)  # service Go suite passed
git diff --check
```

New coverage:

| Area | File |
| --- | --- |
| Staked requeue, queue escape hatch | `client/App.onlineRequeue.test.tsx` |
| Entry requirement wording | `client/jade-entry.test.ts` |
| Queue health thresholds and wording | `client/queue-health.test.ts` |
| Lobby header | `client/LobbyHeader.test.tsx` |
| Tier table and locked cards | `client/LockedTiers.test.tsx` |
| Rules-version drift against Go | `client/rules-version.test.ts` |
| Tutorial fixtures | `client/tutorial/script.test.ts` |
| Tutorial interaction, skip, replay, analytics | `client/tutorial/TutorialScreen.test.tsx` |

## Open follow-ups

- **No rendered captures.** The P0 documents carry headless-Chromium evidence
  produced by `scripts/capture-result-evidence.mjs`. Nothing equivalent was
  produced here, so the lobby, queue, and tutorial screens are verified by
  component and integration tests but not by a rendered capture at the
  certified 640px minimum width. That is the honest gap in this document.
- **Account level and progression** are absent from the lobby header. P1.2 asks
  for them, but XP and levels are P2.1 and the server cannot award them yet.
  Inventing a level display would have been the wrong kind of complete.
- **Sparrow Pavilion** is open in the specification but locked here, because
  this build has a single match pool. Its card says "Opens once its queue is
  running" rather than claiming a product decision that was not made.
- **Tutorial completion is not persisted.** Finishing it sets no marker, so the
  lobby cannot yet stop offering it or route a first-time player into it
  automatically.
