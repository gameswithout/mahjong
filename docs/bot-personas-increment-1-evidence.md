# Bot Personas — Increment 1 Evidence

- Product: Mahjong
- Ruleset: Taiwanese 16-tile v1.1
- Proposal: [Bot Playing-Style Research and Persona Proposal](bot-playing-style-personas.md)
- Date: 2026-08-14
- AI version: `v1.1.0` · Persona version: `v1.0.0`

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
| Swift Sparrow | 12.8% | 14.0% | 12.2% | 92.5% | 100.0% |
| Stone Lion | 68.4% | 40.0% | 82.8% | 13.0% | 0.0% |
| Jade Dragon | 24.4% | 24.7% | 24.3% | 85.6% | 51.3% |
| Thunder Tiger | 14.8% | 28.7% | 7.8% | 99.3% | 93.3% |
| Silent Crane | 64.1% | 14.7% | 89.2% | 0.0% | 0.0% |

Directions match the cards: Rush calls more than the reference, Guard and
Concealed call far less, Concealed is the roster's lowest caller, and Pongs &
Kongs takes a larger share of the Pongs it is offered than of the Chows.

### Where this falls short of §9.2

The proposal's §9.2 gate asks each specialist to differ from River Scholar on
at least 15% of style-relevant decisions. Four of six clear it. **Swift Sparrow
(12.8%) and Thunder Tiger (14.8%) do not.**

The cause is worth recording rather than tuning away. Both differ from the
reference mainly in *degree* along an axis the neutral evaluator already
optimises — speed — so their best-scoring action often coincides with its own.
The reference itself accepts ~88% of the claim opportunities in this sample,
which leaves a rush persona almost no room above it. Closing that needs the
reference to price an open hand's lost concealed value properly; today
`potentialValueProxy` applies no openness penalty before tenpai, and the flat
concealment constant is a poor stand-in for it.

Every scale setting tried that widened the gap also pushed Stone Lion into
never claiming at all, which contradicts §6.3. The shipped setting keeps the
shared openness cost modest and lets each persona's `claim_bias` carry its own
reluctance; the automated floor is set at 10% with §9.2's 15% left as the
tuning-pass target.

## Not measured here

§9.3's strength gates need at least 10,000 same-seed seat-rotated hands per
persona against the same-difficulty population, reporting first-place share,
average raw Tai, deal-in rate and expected Tai paid, plus the full round-robin
matrix. None of that is run here, so **nothing in this document says the roster
is balanced** — only that the personas are real and point the way their cards
promise. The §9.2 classifier check and the blind recognition playtest are also
outstanding.

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
