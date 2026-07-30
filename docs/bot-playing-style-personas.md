# Bot Playing-Style Research and Persona Proposal

- Product: Mahjong
- Ruleset: Taiwanese 16-tile v1.1
- Research date: 2026-07-29
- Status: Product/design proposal for review; no implementation is included

## Recommended decision

Add **playing style as a separate choice from difficulty**.

- **Difficulty** answers: “How accurately does this bot execute its plan?”
- **Style** answers: “What plan does this bot prefer, and what risks does it accept?”

Launch with six working personas:

1. **River Scholar — Adaptive**
2. **Swift Sparrow — Rush**
3. **Stone Lion — Guard**
4. **Jade Dragon — Big Hand**
5. **Thunder Tiger — Pongs & Kongs**
6. **Silent Crane — Concealed**

The six cover the most legible and implementable strategic differences without
turning “style” into random mistakes. They should be available in AI Practice
and bot-filled private rooms. Disconnect takeover should continue to use a
neutral Medium/Adaptive bot, because a player did not choose a persona for that
competitive seat.

This requires an explicit product-spec change. The current specification caps
the seeded Speed, Value, or Caution style offset at 5%, and the current
implementation applies it only to tied discard choices. That is useful
background variation, but too subtle to support a player-facing promise of
meaningfully different opponents.

## 1. Research scope and confidence

There is no authoritative, universal list of Mahjong player types. Rules,
scoring, and even the meaning of a “safe” discard differ substantially by
variant. Public research is also concentrated on Japanese Riichi and Mahjong
Competition Rules (MCR), not this product’s Taiwanese 16-tile rules.

This proposal therefore uses three evidence layers:

| Evidence layer | What it contributes | How it is used |
| --- | --- | --- |
| This repository’s product specification and rules engine | Exact legal actions, scoring incentives, information boundary, and safety semantics | Authoritative for every proposed behavior |
| Mahjong AI and strategy research across variants | General decision concepts: distance to completion, live acceptance, value, opponent threat, push/fold, and style fidelity | Used only where the concept transfers; variant-specific heuristics do not |
| Game analytics and player-style research | How to define and measure behavioral style | Used for telemetry, calibration, and user testing |

Important transfer limitation: Riichi concepts such as permanent safety from an
opponent’s own discard or Riichi-specific `suji` must not be imported. Under
this product’s rules, an opponent’s prior discard does **not** make that tile
permanently safe. The existing public-state safety solver remains authoritative.

## 2. What the research says

### 2.1 Style is a pattern of choices, not a result label

Player-style research recommends clustering or describing players by how their
choices relate to game states and outcomes, rather than by outcomes alone. A
bot is not a “speed” bot merely because it happened to win early; it is a speed
bot when it repeatedly accepts calls, gives up value, and selects shapes that
reduce its completion distance or increase live improving tiles.

This distinction matters in Mahjong because short samples are dominated by
random deals and draws. Persona identity must be visible across many eligible
decisions even when the persona loses.

### 2.2 The central Mahjong trade-offs are multidimensional

The recurring strategic dimensions across the literature and implemented
Mahjong bots are:

- **Speed versus value:** finish a lower-value hand sooner or preserve a slower,
  higher-scoring route.
- **Push versus fold:** continue improving the hand or spend hand efficiency to
  reduce the chance and cost of dealing into a visible threat.
- **Open versus concealed:** call to gain certainty and tempo or retain
  flexibility, information concealment, and concealed-hand value.
- **Chow versus Pong/Kong shape:** favor connected sequences and broad
  acceptance or pairs, triplets, Honors, and Kong value.
- **Flexibility versus commitment:** keep several viable plans or commit early
  to a flush, Honor, or triplet family.
- **Broad versus selective waits:** maximize live winning tiles or accept a
  narrower route for value or lower inferred risk.
- **Static versus contextual play:** hold a persistent preference or change its
  weight with dealer status, continuation, remaining wall, and public threat.

These are axes, not mutually exclusive human “species.” A good persona is a
coherent bundle of several axes that produces recognizable choices.

### 2.3 Strength and style should be measured separately

Recent work on styled Mahjong agents explicitly treats policy similarity and
playing proficiency as different objectives. It shows that improving a bot
solely for reward can erase its source style, while style-preserving training
can retain characteristic behavior and still improve strength.

For this product, the same principle applies without requiring machine
learning: Easy, Medium, and Hard can share the same persona vector while using
different search depth, opponent modeling, mistake bands, and risk estimation.
A Hard Swift Sparrow should be a highly competent rush player; it should not
quietly turn into River Scholar whenever optimal play conflicts with the style.

### 2.4 Parameterized policies are a practical fit

A recent production write-up for a rule-based Mahjong game describes four
personalities—Balanced, Iron Wall, Speed, and Big Hand—implemented through
weights for offense, defense, calling, speed, and pattern pursuit. Its key
engineering lesson transfers well: use one explainable action evaluator with
persona parameters, apply phase and threat modifiers, and tune the result in a
headless simulator.

That model fits the existing deterministic Go policy architecture better than
six unrelated policy implementations.

### 2.5 Behavioral metrics make style observable

Competitive Mahjong statistics commonly expose:

- win rate;
- average value of winning hands;
- call/open-meld rate;
- deal-in rate;
- average value paid when dealing in.

Those outcome metrics should be supplemented here with state-aware choice
metrics—claim acceptance when eligible, fold decisions under a defined threat,
pattern commitment, live wait breadth, and Kong decisions—so luck does not
masquerade as style.

## 3. Product constraints from the current game

All personas must obey the existing non-negotiable rules:

- They see only their own concealed hand and public table state.
- They never inspect wall order, future random values, opponent hands, hidden
  claim responses, rating, or player profile.
- Mandatory Flowers are exposed immediately.
- Every legal Win is declared. A Big Hand persona never passes a legal Win to
  chase more Tai.
- Decisions remain deterministic from rules version, AI version, difficulty,
  persona, legal observation, and recorded seed.
- The 250 ms decision budget and fallback chain remain in force.
- A persona never delays a response to gain timing information.
- A persona cannot claim that a tile is certainly safe unless the existing
  public-state solver proves it under Taiwanese v1.1 rules.
- Bots remain visibly labeled as bots.

### 3.1 What exists today

The current bot layer already has:

- Easy, Medium, and Hard policies;
- a legal observation boundary;
- deterministic seeds and reaction intervals;
- a public-state safety solver;
- a calibration harness;
- Speed, Value, and Caution style offsets.

However, the current style wrapper:

- affects at most 5% of discard decisions;
- acts only where the base policy already considers two or more discards tied;
- does not change Chow, Pong, Kong, Pass, or fold behavior;
- is assigned from a seed rather than selected by the player;
- is not recorded as a first-class field on `Decision`.

That behavior should remain available as subtle within-persona variation, but
it cannot carry the new product feature by itself.

### 3.2 Evaluation capability needed for real personas

A persona-aware evaluator should score each legal action approximately as:

`completion chance + live acceptance + expected Tai - deal-in risk - expected loss + pattern fit + flexibility`

The persona changes the weights and thresholds; difficulty changes the quality
and depth of the estimates.

Two current implementation details will need strengthening before the personas
can feel honest:

1. The current `effectiveDrawCount` is non-zero only when the hand is already
   one tile from complete. Speed and claim personalities need a generalized
   Taiwanese 16-tile deficiency measure plus knowledge-aware live acceptance
   earlier in the hand.
2. The current Hard value proxy recognizes triplets and suit concentration,
   but a Big Hand persona needs explicit pattern feasibility and abandonment
   thresholds so it pursues plausible high-Tai hands rather than blindly
   hoarding one suit.

## 4. Proposed style model

Use one versioned `PersonaProfile` per bot:

| Parameter | Meaning |
| --- | --- |
| `completion_weight` | Preference for reducing distance to a legal 17-tile hand |
| `acceptance_weight` | Preference for more still-live improving/winning tiles |
| `tai_weight` | Preference for expected raw Tai conditional on winning |
| `risk_weight` | Penalty for estimated deal-in probability and expected Tai paid |
| `claim_bias` | General willingness to open the hand |
| `chow_bias` | Additional preference or penalty for Chows |
| `pong_bias` | Additional preference or penalty for Pongs |
| `kong_bias` | Additional preference or penalty for each legal Kong form |
| `concealment_value` | Value assigned to remaining concealed and flexible |
| `commitment` | How much evidence is required to adopt or abandon a target pattern |
| `safe_reserve_value` | Value of retaining at least one lower-risk exit tile |
| `context_sensitivity` | Strength of dealer, continuation, wall, and threat modifiers |

These are utility preferences, not legality overrides. Each action is still
generated from the same legal action set.

## 5. Persona roster at a glance

The 1–5 ratings below describe intended decision preferences, not guaranteed
outcomes or difficulty.

| Persona | Pace | Tai pursuit | Caution | Calling | Concealment | Signature |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| River Scholar — Adaptive | 3 | 3 | 3 | 3 | 3 | Changes plan with hand, seat, wall, and threats |
| Swift Sparrow — Rush | 5 | 1 | 2 | 5 | 1 | Claims for tempo and maximizes live acceptance |
| Stone Lion — Guard | 2 | 2 | 5 | 1 | 4 | Keeps an exit tile and folds earlier |
| Jade Dragon — Big Hand | 2 | 5 | 2 | 2 | 4 | Commits to plausible high-Tai patterns |
| Thunder Tiger — Pongs & Kongs | 4 | 3 | 1 | 5 | 1 | Converts pairs into exposed pressure |
| Silent Crane — Concealed | 3 | 4 | 3 | 1 | 5 | Preserves a closed, flexible hand |

Recommended default mixed table:

- Swift Sparrow in South;
- Stone Lion in West;
- Jade Dragon in North.

That lineup creates the clearest first-session contrast: one opponent races,
one protects, and one builds value. River Scholar is the recommended default
for a uniform or neutral table. Thunder Tiger and Silent Crane add shape-based
variety once the player understands calls and concealment.

## 6. Persona cards

### 6.1 River Scholar — Adaptive

- **Player-facing tag:** Adaptive
- **One-line promise:** “Reads the whole table and changes course.”
- **Role:** Neutral reference and recommended first opponent

#### Strategic identity

River Scholar has no permanent favorite pattern. It begins flexible, compares
completion chance, live tiles, Tai, and risk, then changes priorities as public
evidence changes. It is the closest persona to a rational all-round policy.

#### Decision behavior

- **Discard:** keeps several viable blocks early; shifts toward the best
  expected-table-point route as the hand clarifies.
- **Chow/Pong:** claims only when the gain in completion chance or live
  acceptance justifies openness and value loss.
- **Kong:** models wait damage, replacement value, remaining wall, exposure,
  and added-Kong robbing risk.
- **Defense:** pushes good, live hands; folds weak hands against sufficiently
  visible threats.
- **Context:** reacts most strongly to dealer status, continuation, wall phase,
  and public opponent threat.

#### Recognition signals

- Neither the highest nor lowest caller over a large sample.
- More plan switches than the specialist personas.
- Outcome profile remains near the same-difficulty population average.

#### Weakness and counterplay

It has no deliberately exposed strategic weakness. Its purpose is to set the
quality baseline and teach context-sensitive play. Specialists should be more
predictable and sometimes exploit River Scholar in their favorable states.

#### Character expression

Calm, observant, and unhurried. Avoid “genius” or omniscient language; the bot
has exactly the same legal information as a player.

---

### 6.2 Swift Sparrow — Rush

- **Player-facing tag:** Rush
- **One-line promise:** “Calls early, builds wide waits, and races to finish.”
- **Role:** Fast-pressure opponent and beginner tempo lesson

#### Strategic identity

Swift Sparrow prioritizes reducing generalized deficiency and increasing the
number of still-live improving tiles. It accepts a lower Tai ceiling and more
openness when a Chow or Pong creates meaningful tempo.

#### Decision behavior

- **Discard:** preserves high-acceptance connected shapes and removes tiles
  that do not contribute to the quickest plausible hand.
- **Chow/Pong:** accepts calls that reduce deficiency or materially improve
  live acceptance, even when the call gives up concealed value.
- **Kong:** declares only when the replacement opportunity and value do not
  materially damage the current wait; it is fast, not recklessly Kong-happy.
- **Defense:** uses the same safety model but requires a stronger threat before
  abandoning a close, live hand.
- **Value:** treats incidental Wind, Dragon, Flower, and Kong Tai as a bonus,
  not a reason to slow down.

#### Recognition signals

- Earliest open melds and highest overall claim-opportunity acceptance.
- Fewer personal turns to a ready hand.
- Lower average raw Tai on wins than River Scholar.
- More fully exposed or low-pattern wins.

#### Weakness and counterplay

Opening early reduces flexibility and reveals much of the hand. The player can
read its likely remaining shapes more easily, and a slow initial hand gives the
persona less room to express its advantage.

#### Initial tuning hypotheses

Relative to River Scholar at the same difficulty and on paired seeds:

- claim-opportunity acceptance: at least 20 percentage points higher;
- median personal turns to ready: at least 10% lower;
- average raw Tai on wins: at least 15% lower.

#### Character expression

Bright, energetic, and decisive. The character should feel quick because of
its choices, not because it receives shorter hidden-information-aware timing.

---

### 6.3 Stone Lion — Guard

- **Player-facing tag:** Guard
- **One-line promise:** “Protects its hand, keeps an exit, and refuses bad risks.”
- **Role:** Defensive opponent and push/fold trainer

#### Strategic identity

Stone Lion assigns the highest cost to dealing into a visible threat. It
prefers to keep at least one lower-risk exit tile while the hand remains
distant, and it is willing to worsen hand efficiency to reduce expected loss.

#### Decision behavior

- **Discard:** among reasonably close choices, favors the tile with the lowest
  public-state risk and values retaining a future exit.
- **Chow/Pong:** calls rarely because an open hand loses flexible defensive
  inventory; it calls when the resulting hand becomes genuinely close and
  remains defensible.
- **Kong:** conservative, especially for added Kongs that expose robbing risk or
  when few drawable tiles remain.
- **Defense:** folds earlier when an opponent has several exposed melds, a
  visible suit/Honor concentration, or another supported threat signal.
- **Late wall:** increases its safety weight faster than every other persona.

#### Recognition signals

- Lowest deal-in rate and expected Tai paid through own discard.
- More efficiency-losing safe discards under a defined public threat.
- Lower call rate, lower win rate, and more hands ending without its win.

#### Weakness and counterplay

It sometimes abandons a recoverable hand and can be outpaced by a low-risk
rush. “Guard” must not be presented as “never deals in”: Taiwanese hidden
information means most tiles retain non-zero risk.

#### Initial tuning hypotheses

Relative to River Scholar at the same difficulty and on paired seeds:

- deal-in rate: at least 25% lower;
- safety-driven efficiency sacrifices under threat: at least twice as common;
- claim-opportunity acceptance: at least 15 percentage points lower.

#### Character expression

Steady, patient, and protective—not fearful. Avoid a taunting “coward” framing;
folding is a deliberate skill.

---

### 6.4 Jade Dragon — Big Hand

- **Player-facing tag:** Big Hand
- **One-line promise:** “Trades tempo for a realistic chance at heavy Tai.”
- **Role:** Value-pressure opponent and hand-reading lesson

#### Strategic identity

Jade Dragon pursues high-Tai routes only when the opening hand and live public
tiles make them plausible. Preferred families include Half/Full Flush,
Wind/Dragon sets, All Pongs, concealed-Pong progressions, and compatible Kong
value. It must use explicit feasibility and abandonment thresholds; “Big Hand”
must not mean blindly forcing a Full Flush.

#### Decision behavior

- **Discard:** preserves tiles supporting its chosen pattern even at a moderate
  completion cost.
- **Chow/Pong:** accepts pattern-compatible calls and rejects calls that destroy
  the chosen value route unless the speed gain is overwhelming.
- **Kong:** likes compatible Kongs for their Tai and replacement opportunity,
  but Hard still models wait damage and robbing risk.
- **Commitment:** adopts a target only after enough starting concentration,
  pairs/Honors, and live support; abandons it when required tiles become too
  depleted or the wall becomes too short.
- **Win:** always declares every legal Win. It never passes a completed smaller
  hand to chase a storybook result.

#### Recognition signals

- Highest average and upper-quartile raw Tai on wins.
- Highest incidence of Flush, Honor, All Pongs, and concealed-Pong pattern
  families.
- More early off-suit discards after committing to a suit.
- Slower ready time and fewer wins than River Scholar.

#### Weakness and counterplay

Commitment makes its plan more readable from exposed melds and discarded
suits. Depletion of the target suit or Honor family can strand the hand.

#### Initial tuning hypotheses

Relative to River Scholar at the same difficulty and on paired seeds:

- average raw Tai on wins: at least 30% higher;
- target-pattern persistence after commitment: at least 50% higher;
- median personal turns to ready: at least 10% higher.

#### Character expression

Ambitious and composed, with satisfaction in craftsmanship rather than
gambling bravado.

---

### 6.5 Thunder Tiger — Pongs & Kongs

- **Player-facing tag:** Pongs & Kongs
- **One-line promise:** “Turns pairs into pressure and interrupts the table.”
- **Role:** Call-priority and triplet-shape trainer

#### Strategic identity

Thunder Tiger favors pairs, triplets, scoring Honors, All Pongs, and Kong
opportunities. Unlike Swift Sparrow, it is not simply choosing the fastest
claim: it may pass an available Chow yet take a later Pong that better fits its
shape.

#### Decision behavior

- **Discard:** retains pairs and isolated scoring Honors longer, and breaks
  sequence fragments more readily than other personas.
- **Chow:** uses a high threshold and accepts mainly when it rescues a poor hand
  or creates immediate readiness.
- **Pong:** uses the lowest Pong threshold of the roster, especially for seat
  Wind, prevailing East, Dragons, or a plausible All Pongs route.
- **Kong:** most willing persona, while still distinguishing concealed,
  exposed, and robbable added Kongs.
- **Defense:** continues pushing visible triplet value longer than River
  Scholar; Hard still folds when expected loss clearly dominates.

#### Recognition signals

- Highest Pong and Kong opportunity acceptance.
- Lowest Chow-to-Pong ratio.
- Highest exposed triplet count and All Pongs/Kong pattern incidence.
- More interruptions of normal draw order and more readable exposed structure.

#### Weakness and counterplay

Sequence-heavy deals give it fewer good calls. Its exposed triplets narrow the
set of plausible concealed shapes, and added-Kong aggression creates a visible
robbing risk.

#### Initial tuning hypotheses

Relative to River Scholar at the same difficulty and on paired seeds:

- Pong/Kong opportunity acceptance: at least 1.75 times higher;
- Chow-to-Pong accepted-claim ratio: at most half as high;
- All Pongs or any Kong scoring incidence: at least twice as high.

#### Character expression

Bold and direct. Its pressure comes from legal claims and table interruption,
not artificial intimidation or hidden knowledge.

---

### 6.6 Silent Crane — Concealed

- **Player-facing tag:** Concealed
- **One-line promise:** “Keeps its plan hidden and waits for the hand to come.”
- **Role:** Closed-hand and flexibility trainer

#### Strategic identity

Silent Crane strongly values remaining concealed, broad internal flexibility,
and the product’s Concealed/Concealed Zimo scoring. It is not passive: it
should still make efficient concealed discards and may declare a concealed
Kong because that does not open the hand.

#### Decision behavior

- **Discard:** preserves connected, multi-use blocks and plausible concealed
  triplets while minimizing early commitment.
- **Chow/Pong:** rejects ordinary calls and accepts only a large completion
  gain, immediate readiness, or an unusually valuable scoring set.
- **Kong:** favors safe concealed Kongs; is reluctant to expose or add a Kong.
- **Defense:** has more uncommitted tiles available for defense than an open
  persona and uses that flexibility when threats emerge.
- **Win:** always accepts a legal discard Win. Its higher Zimo share should
  emerge from staying concealed, never from illegally passing wins.

#### Recognition signals

- Lowest open-meld and accepted Chow/Pong rate.
- Highest concealed-hand share at resolution.
- Higher Concealed/Concealed Zimo pattern incidence.
- More concealed Kongs as a share of all its Kongs.

#### Weakness and counterplay

It declines acceleration and can be raced off the table. Poor closed shapes
may remain poor for longer because the persona refuses marginal rescue calls.

#### Initial tuning hypotheses

Relative to River Scholar at the same difficulty and on paired seeds:

- open-meld incidence: at least 60% lower;
- Concealed or Concealed Zimo incidence on wins: at least 1.5 times higher;
- ordinary Chow/Pong opportunity acceptance: at least 20 percentage points
  lower.

#### Character expression

Quiet, precise, and self-contained. Do not equate concealed play with secret
access to opponents’ tiles.

## 7. Styles not recommended for the first release

### Pure All Chows / sequence specialist

This can be visually distinctive, but the product’s exact All Chows pattern is
fragile: any Flower disqualifies it, it requires a discard win, and it cannot
stack with several other patterns. A sequence preference can live inside
Silent Crane and Swift Sparrow without promising a persona whose headline goal
is frequently invalidated by a random Flower.

Revisit after telemetry shows that Chow-versus-Pong behavior alone is
recognizable and competitive.

### Pure trap-wait specialist

A persona that accepts narrow, unusual waits could feel clever on reveal, but
its identity is largely invisible until a hand ends and can easily collapse
into arbitrary weak play. It also needs a more mature model of public tile
availability and opponent inference.

Revisit as an advanced “Trickster” only after live-wait and decision-explanation
instrumentation exists.

### Pure chaos or random persona

Randomness is not a strategic identity. Intentional mistakes belong to Easy
difficulty and its calibrated divergence band. A chaotic persona would make
the style promise difficult to learn, explain, and balance.

### Human-countering or adaptive-to-player persona

The current specification forbids adapting difficulty to the human, reading
rating, or rubber-banding after wins and losses. A bot may respond to public
actions in the current hand, but it should not secretly build a profile of the
player and counter it. Such a feature would also make fixed persona descriptions
unreliable.

## 8. Player-selection experience

Recommended flow:

1. Choose **difficulty**: Easy, Medium, or Hard.
2. Choose a **table style preset**:
   - **Mixed personalities** — Swift Sparrow, Stone Lion, Jade Dragon;
   - **Balanced table** — three River Scholars with seeded micro-variation;
   - **Choose each seat** — any persona per opponent.
3. Show each seat as `Bot · Hard · Rush` or equivalent throughout loading,
   table, and replay views.

Each persona card should show:

- working name and plain-language style tag;
- one-sentence behavior promise;
- five small bars: Pace, Value, Caution, Calling, Concealment;
- one strength and one weakness;
- no claim about guaranteed wins, safety, or human identity.

The plain-language tag is more important than the fantasy name. Names and
Traditional Chinese localization require the project’s normal zh-TW cultural
review before release.

Persona should not change reaction-time bounds. Players should recognize a
style from decisions, not use response timing as an unintended tell about the
bot’s hand.

## 9. Calibration and acceptance plan

### 9.1 Record the right data

For every bot decision, record or derive:

- `persona_id`, persona version, difficulty, AI version, rules version, and
  deterministic seed;
- legal actions and selected action;
- action utility components before persona weighting;
- applied persona weights and context modifiers;
- generalized deficiency and live acceptance before/after;
- expected raw Tai and active target pattern, if any;
- public threat/risk estimate;
- whether the action opened the hand, folded, or changed pattern;
- elapsed calculation time and fallback use.

No telemetry should include opponent concealed tiles or wall order.

### 9.2 Style-fidelity gates

Use same-seed, seat-rotated paired simulations so the comparison is about
choices rather than luck.

Initial gates:

- Each specialist must differ from River Scholar on at least 15% of
  **style-relevant** legal decisions while remaining within legality and
  difficulty-quality bounds.
- A simple classifier using only behavioral metrics should identify the six
  personas at least 80% of the time from a 20-hand sample; chance is 16.7%.
- In a blind playtest, after three hands against a three-persona mixed table,
  at least 70% of players should correctly match each bot to the displayed
  Rush, Guard, or Big Hand description.
- Specialists must meet their relative metric hypotheses in Section 6 with
  confidence intervals that exclude the neutral result.

The 15%, 80%, and 70% figures are proposed product gates, not published
Taiwanese-Mahjong norms. They should be revised after the first internal
playtest.

### 9.3 Strength gates

Style should create matchups, but one persona must not become the secretly
correct choice at every table.

For each difficulty:

- run at least 10,000 same-seed, seat-rotated hands for every persona against
  the same-difficulty population;
- report first-place/win share, average placement where applicable, average raw
  Tai, deal-in rate, expected Tai paid, exhaustive draws, and compute time;
- target population-average Elo within ±75 of River Scholar and population
  first-place rate within ±4 percentage points;
- keep confidence intervals and publish failures rather than tuning against a
  single seed;
- test the full round-robin matrix, because specialist matchups may be
  non-transitive even when population strength is balanced.

If a persona cannot stay in the difficulty band without losing its identity,
label it as a special challenge opponent rather than misrepresenting it as
equivalent.

### 9.4 Rules and fairness gates

Every persona must pass:

- the existing observation-boundary and hidden-information tests;
- legal action and always-Win fixtures;
- mandatory Flower and all Kong-form fixtures;
- Taiwanese safety adversarial fixtures;
- deterministic replay including `persona_id` and persona version;
- p99 decision-budget and fallback tests;
- a scan proving no persona changes public-queue, Jade, rating, or takeover
  policy.

## 10. Suggested delivery order

1. **Specification change:** make selectable persona an explicit Practice and
   private-room feature; retain 5% seeded offsets as micro-variation inside a
   persona or replace that clause with measurable style-fidelity gates.
2. **Evaluator foundation:** generalized 16-tile deficiency/live acceptance,
   pattern feasibility, and first-class persona/version recording.
3. **Core contrast set:** River Scholar, Swift Sparrow, Stone Lion, Jade
   Dragon.
4. **Shape set:** Thunder Tiger and Silent Crane.
5. **Selection UX, telemetry, paired simulator, and blind recognition test.**
6. **Only then consider experimental sequence or trick-wait personas.**

## 11. Sources and how they informed the proposal

### Product-authoritative sources

- [Mahjong Product Specification](mahjong-product-specification.md) — Sections
  5, 6, and 11 define Taiwanese v1.1 rules, Tai incentives, permitted bot
  information, difficulty, safety, determinism, and the current 5% style cap.
- [Current style wrapper](../bots/style.go) — establishes the implemented
  Speed/Value/Caution tie-break behavior.
- [Current bot heuristics](../bots/heuristics.go) and
  [Hard policy](../bots/hard.go) — establish current completion, value, and
  risk capabilities and their documented limits.

### External research and industry references

- Li, Lu, Wang, and Li,
  [“Policy Improvement with Style-Specific Demonstrations”](https://arxiv.org/html/2506.16995v4)
  (2026) — supports treating style fidelity separately from proficiency and
  measuring behavioral policy distance.
- Takagi,
  [“Implementing a Mahjong AI with Rule-Based Logic”](https://aduce.jp/en/lab/rule-based-game-ai-mahjong)
  (2026) — production example of parameterized Balanced, Defensive, Speed, and
  Big-Hand personalities with phase-aware offense/defense weights and
  simulator tuning. Its Riichi-specific safety categories are deliberately not
  transferred.
- Yan, Li, and Li,
  [“A Fast Algorithm for Computing the Deficiency Number of a Mahjong Hand”](https://arxiv.org/abs/2108.06832)
  (2021) — supports knowledge-aware completion distance and tile availability
  as general-purpose Mahjong AI primitives.
- Mizukami and Tsuruoka,
  [“Building a Computer Mahjong Player Based on Opponent Models and Monte Carlo Simulation”](https://www.logos.t.u-tokyo.ac.jp/~tsuruoka/papers/cig2015mizukami.pdf)
  (2015) — models opponent readiness, winning tiles, and winning score, and
  describes the need to balance winning, folding, and “fence-sitting.”
- Normoyle and Jensen,
  [“Bayesian Clustering of Player Styles for Multiplayer Games”](https://ojs.aaai.org/index.php/AIIDE/article/view/12805)
  (2015) — supports defining style through state-conditioned choices and
  allowing coherent hybrid styles rather than using outcome-only labels.
- [M.League official statistics](https://m-league.jp/stats/) — demonstrates
  player-facing and analyst-facing use of win rate, average winning value,
  call rate, and deal-in rate as observable Mahjong behavior metrics. These
  are measurement examples, not Taiwanese target values.

## Assumptions

- The product specification v1.2 and Taiwanese 16-tile ruleset v1.1 remain the
  source of truth.
- The request is for research and reviewable persona design, not implementation
  in this task.
- Persona selection is intended for voluntary AI Practice and bot-filled
  private rooms, not public matchmaking, tournaments, or undisclosed takeover.
- Working persona names and character expression are placeholders; final art,
  names, and zh-TW localization will receive separate cultural review.
- Difficulty remains Easy/Medium/Hard and is orthogonal to persona.
