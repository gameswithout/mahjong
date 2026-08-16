# Bot Personas — Increment 1 Evidence

- Product: Mahjong
- Ruleset: Taiwanese 16-tile v1.1
- Proposal: [Bot Playing-Style Research and Persona Proposal](bot-playing-style-personas.md)
- Date: 2026-08-14
- AI version: `v1.1.0` · Persona version: `v1.1.0`

## What shipped

Steps 1-4 of the proposal's §10 delivery order, taken end to end so a Practice
table faces three visibly different, named opponents.

| Proposal step | State |
| --- | --- |
| 1. Specification change | Done — §11.4 now defines persona as a dimension separate from difficulty |
| 2. Evaluator foundation | Done — `bots/evaluate.go` |
| 3. Core contrast set | Done — River Scholar, Swift Sparrow, Stone Lion, Jade Dragon |
| 4. Shape set | Done as data — Thunder Tiger, Silent Crane (tuning deferred) |
| 5. Selection UX, telemetry, paired simulator, blind test | Not started |
| 6. Experimental personas | Not started |

### Evaluator foundation

`effectiveDrawCount` is precise but reads zero for every hand that is not
already tenpai, because `rulesengine.WinningTiles` finds no candidate earlier
and `rulesengine.EvaluateHand` refuses any tile count other than an exact
five-melds-plus-pair shape. A Speed or claim persona therefore had no signal
for most of a hand. `bots/evaluate.go` adds, over tile-type counts:

- `deficiency` — distance to a legal 17-tile hand, meaningful from the opening
  hand. `-1` complete, `0` tenpai.
- `liveAcceptance` — unseen copies that reduce that distance, budgeted through
  the existing `VisibleCounts`/`unseenBudget` pair so it inherits the §11.2
  boundary.
- `patternFit` / `patternDeficiency` / `patternFeasible` — the commit and
  abandon thresholds §6.4 requires so "Big Hand" means a plausible route
  rather than hoarding a suit.
- `blockShape` — pair-shaped versus sequence-shaped blocks, which is what lets
  a triplet persona *keep* differently and not only *claim* differently.

`deficiency` is cross-checked against the authoritative evaluator rather than
against hand-written expectations: over 300 constructed winning hands and 400
real shuffles, `deficiency == 0` exactly when `rulesengine.WinningTiles`
reports a wait, and `-1` exactly when `CanWin` holds.

### Persona model

Each persona is two hand-authored files under `bots/personas/<id>/`, the same
split the chess project's Gambit Gus and Fortress Fiona use — `persona.md` for
prose identity, `style.json` for bounded weights. Adding a personality is a
data change. The files are embedded with `go:embed` rather than read from disk,
because §11.4 requires a decision to replay from (rules version, AI version,
difficulty, persona, observation, seed): the weights travel with the AI version.

The loader rejects unknown keys, out-of-range weights, missing prose, and
unknown pattern targets, so a slipped decimal fails the build instead of
shipping a persona that ignores its own score.

## Measured style fidelity

`RunPersonaFidelity`, 150 seeded positions per persona at Hard, each persona
answering the identical position from the identical seed as River Scholar, so
any difference is a difference of preference rather than of luck.

Pong and Chow opportunities are counted separately on purpose: a random
sixteen-tile hand can Chow far more often than it can Pong, and pooling them
reports the shuffle's shape mix as if it were the persona's preference. An
earlier pooled measurement made Thunder Tiger look like a Chow specialist.

| Persona | Divergence | Discard | Claim | Pong taken | Chow taken |
| --- | ---: | ---: | ---: | ---: | ---: |
| River Scholar (reference) | 0.0% | 0.0% | 0.0% | 89.0% | 88.0% |
| Swift Sparrow | 20.6% | 38.0% | 11.8% | 92.5% | 98.7% |
| Stone Lion | 68.4% | 40.0% | 82.8% | 13.0% | 0.0% |
| Jade Dragon | 24.4% | 24.7% | 24.3% | 85.6% | 51.3% |
| Thunder Tiger | 16.6% | 36.7% | 6.4% | 100.0% | 88.7% |
| Silent Crane | 64.1% | 14.7% | 89.2% | 0.0% | 0.0% |

All six clear §9.2's proposed 15% divergence gate, and directions match the
cards: Rush calls more than the reference, Guard and Concealed call far less,
Concealed is the roster's lowest caller, and Pongs & Kongs takes a larger share
of the Pongs it is offered than of the Chows.

### Two personas that were names before they were styles

Swift Sparrow and Thunder Tiger first measured at 12.8% and 14.8%, under the
gate. Both had a real defect their own cards had already described and their
weights had not.

**Swift Sparrow weighted completion and acceptance equally — the same 1:1
ratio as the reference.** A ranking is unchanged by scaling, so setting both to
1.8 against the reference's 1.0 produced a louder River Scholar rather than a
different player. Its card promises "builds wide waits", which is acceptance
*over* completion; weighting acceptance to twice completion expresses that, and
took its discard divergence from 14.0% to 38.0%.

**Thunder Tiger paid less for a Chow than the reference did.** `chow_bias` is
summed with `claim_bias`, so −1.0 against +0.8 netted to −0.2: a cost of 14
where the neutral reference paid 30. It took *more* Chows than the reference,
the exact opposite of the high Chow threshold on its card. At −1.8 the sum
finally runs the right way.

### The claim-rate ceiling, and one thing that did not work

Claim acceptance is dominated by whether a claim takes a whole step off the
hand's distance, which is worth 100 in this evaluator. Bias constants below
that barely move it, which has two consequences worth recording.

The reference itself accepts ~88% of claim opportunities in this sample. That
is probably close to right for this ruleset — Taiwanese 16-tile rewards calling
far more than Riichi does — but it means §6.2's hypothesis that Rush should
accept "at least 20 percentage points" more than the reference is not reachable
arithmetically. Swift Sparrow is already at 92.5% and 98.7%. Its identity has
to live in its discards, and now does.

Raising `personaClaimScale` from 40 to 70 to give shape preferences more
authority **was tried and reverted**. It moved Thunder Tiger's Chow rate by
less than two points while pushing Stone Lion from 13% Pong acceptance back to
never claiming at all, contradicting §6.3. Thunder Tiger's Chow rate therefore
remains at parity with the reference rather than above its promised threshold.
Expressing that properly needs the claim evaluation to grade *how much* a claim
advances the hand, not a larger constant — the same family of evaluator work as
pricing an open hand's lost concealed value, which `potentialValueProxy` still
does not do before tenpai.

## A measurement bug found on the way

Two 2,000-hand strength runs with identical inputs disagreed. Replaying
single hands found 2 of 60 came out differently on the same seed, in-process
and sequential.

The cause is §11.4's decision budget. It races a policy against a 250ms wall
clock and substitutes the neutral Medium policy's answer when it loses, so
whether a decision misses the budget depends on machine load rather than on
the seed. One missed budget silently swaps a persona's move for Medium's, the
hand diverges from there, and the aggregate moves. The two requirements in
§11.4 genuinely conflict — a live table must not stall, and an offline
measurement must repeat — so the budget is now explicit at the call site:
production keeps the guard, offline analysis runs without it.

What this does and does not invalidate:

- **The fidelity numbers above are unaffected.** `RunPersonaFidelity`
  compares decisions by calling the policies directly and never goes through
  the budget wrapper, so no measurement in that table could have been
  substituted.
- **Strength numbers measured before the fix are void**, including an early
  Jade Dragon reading that appeared to sit just outside the §9.3 band. It was
  not a finding; it was the harness.
- **The pre-existing §11.4 Easy/Medium/Hard calibration is affected too**,
  since it runs Hard through the same wrapper. The effect there is smaller —
  those policies are far cheaper than a persona, so they miss the budget less
  often — but the recorded bands were measured on a harness that did not
  strictly repeat.

The regression test replays each seed and compares the settled hand, which is
what caught this and what would have caught it earlier.

## Live deployment

Deployed to AGS Extend 2026-08-15 as image tag `personas-02d2462`
(deployment `f44f4304-f611-4324-a4aa-49adddc3d578`, status
`deployment-running`). The `mahjong-match-service` deployment record is
updated in the same change.

Two things were verified rather than assumed.

**The personas are actually in the shipped binary.** They are embedded with
`go:embed` through a module that is vendored into the service, and the vendor
directory is not checked in — three places the files could have silently
failed to travel. Grepping the compiled `linux/amd64` binary in the pushed
image finds all six by name.

**The live service names the seats.** Driving the same three calls the browser
client makes — guest device login, create an `ai_practice` game session, join
the match — against the deployed URL returns:

```text
seat  isBot  persona           tag        glyph
E     true   Swift Sparrow     Rush       雀
S     true   Stone Lion        Guard      獅
W     false                               
N     true   Jade Dragon       Big Hand   龍
```

The human drew seat W in that session, so the bots took E, S and N and the
mixed lineup was assigned across them in table order, which is what
`PersonaAssignments` specifies. The human seat carries no persona fields, as
does any disconnect takeover.

What this does **not** establish is that the table renders them. The adapter
and badge are unit-tested and the wire contract is now verified live, but no
human has looked at a Practice table yet, and the §9.2 blind recognition test
— can a player match each bot to its Rush/Guard/Big Hand description after
three hands — remains unrun. That is the question the deployment exists to
make answerable, not one it answers.

## Strength results

`RunPersonaStrength`, 2,000 seed-rotated hands per persona at Medium against
three River Scholars, on the fixed (post-budget-fix) harness — this run took
13.7 hours real time, which is itself the corrected throughput estimate from
`scripts/run-persona-strength.sh`'s header. Not §9.3's full 10,000-hand
sample; a 2,000-hand run gives a 95% interval of roughly ±1–2 percentage
points, which is tight enough to place a persona relative to the ±4pp band
with confidence, not tight enough to claim the precise number.

| Persona | First place | Draws | Avg winning Tai | Deal-in | In §9.3 band? |
| --- | ---: | ---: | ---: | ---: | :---: |
| River Scholar (reference) | 27.18% ± 2.08% | 245 | 3.07 | 17.89% | — |
| Jade Dragon | 22.38% ± 1.97% | 275 | 3.13 | 18.61% | yes |
| Thunder Tiger | 23.22% ± 1.97% | 243 | 3.02 | 20.43% | yes |
| Swift Sparrow | 15.73% ± 1.73% | 296 | 2.82 | 20.89% | **no** |
| Silent Crane | 9.02% ± 1.40% | 393 | 3.88 | 16.37% | **no** |
| Stone Lion | 4.27% ± 1.01% | 455 | 3.65 | 12.88% | **no** |

Band is population first-place rate within ±4 percentage points of the
neutral 25% share, i.e. [21%, 29%]. `TestPersonaStrengthSuite` fails under
`MAHJONG_PERSONA_HANDS` for exactly this reason — three of six personas are
outside it, by margins their confidence intervals do not come close to
closing.

### The pattern is coherent, not noise or a bug

The two personas that stay in band are the ones whose card commits to a
single axis while leaving the evaluator's other terms close to neutral:
Jade Dragon raises `tai_weight` but keeps `completion_weight` and
`risk_weight` near River Scholar's; Thunder Tiger raises its claim biases
but its completion and risk weights are likewise unremarkable. The three
that fail are exactly the three whose card is built around *maximizing* one
axis at real cost to the others — and they fail in the order their card
commits:

- **Stone Lion** (`risk_weight` 2.6, the roster's highest; `claim_bias` -0.9,
  the most call-averse) is worst at 4.27%. Its draw count (455 of 2,000
  hands, more than double the reference's 245) is the direct mechanism: a
  persona built to fold rather than push simply produces more hands nobody
  wins, and every one of those is a hand it didn't win either.
- **Silent Crane** (`concealment_value` 2.6, the roster's highest) is next
  at 9.02%, with the second-highest draw count (393) for the same reason —
  refusing ordinary calls costs it the tempo needed to finish hands before
  the wall runs out. Its average winning Tai (3.88, the roster's highest)
  confirms it is winning the hands its style predicts; there are just far
  fewer of them.
- **Swift Sparrow** (`acceptance_weight` 2.4 against completion's 1.2, the
  most lopsided ratio on the roster) is the mildest failure at 15.73%.
  Unlike the other two its draw count is close to baseline (296) — it does
  finish hands at a normal rate. Its deal-in rate (20.89%, the roster's
  highest) is where the cost actually shows: racing for tempo means taking
  more marginal claims, and here that converts into feeding opponents more
  often than it converts into winning first.

This is the tension the proposal's own §9.3 names in advance: *"If a persona
cannot stay in the difficulty band without losing its identity, label it as
a special challenge opponent rather than misrepresenting it as
equivalent."* Per the standing instruction for this investigation, these
weights are reported rather than retuned — bringing Stone Lion or Silent
Crane into band would mean diluting the exact axis their fidelity numbers
(§ above) already confirm they express faithfully, and deciding how much of
that identity is worth trading for population balance is a product call, not
one implicit in a weight file.

## Not measured here

§9.3 also asks for the full round-robin matrix (every persona pair, not just
each against three River Scholars) — not run here. The §9.2 classifier
check and the blind recognition playtest are likewise still outstanding.

## Rules and fairness

Covered by tests in `bots/`:

- every persona declares every legal Win, at every difficulty;
- every persona discards a legal tile, never a Flower;
- decisions replay exactly from observation, seed, and persona;
- `Decision` records `Persona` and `PersonaVersion`; a bare difficulty policy
  leaves both empty, so a takeover is never mistaken for a chosen style;
- a persona over Medium is budget-guarded like Hard, because it reports Medium
  while running the full evaluator — measured at roughly 20 ms per discard
  against the §11.4 250 ms budget, falling back to the neutral Medium policy on
  timeout rather than to a half-computed style;
- a disconnect takeover keeps the neutral Medium policy and is never given a
  persona, in the driver, in the projection, and on the wire.

## Seating

AI Practice pads unfilled seats with `bot:<session>:<n>` user IDs. The
recommended §5 mixed lineup is assigned across those seats in table order —
Swift Sparrow, Stone Lion, Jade Dragon — as a pure function of the persisted
seating. Nothing extra is stored and no snapshot schema changed, so a replay
re-derives exactly the personas that played. Player-chosen personas will need
real persistence, and arrive with the §8 picker.

The table shows the persona's name in place of "Bot" and its plain-language
style tag on the bot badge (`Bot · Rush`). §11's requirement that bots stay
visibly bots is why the tag rides on the badge instead of replacing it. Any
seat without persona fields — an older match, a takeover — falls back to the
previous labels.
