# Mahjong Product Specification Clarification Questionnaire - Resolved

Source reviewed: Mahjong Game Product Requirement Document, 7 pages

Review date: 2026-07-13

Resolution status: All 151 questions resolved on 2026-07-13.

Planning-authoritative answers are consolidated in the [Mahjong Product Specification](mahjong-product-specification.md). Each question ID maps to a resolution section through that document's Section 16.3. This questionnaire remains the audit trail for why each decision was required.

Neither document contains a development plan, implementation sequence, staffing estimate, or delivery estimate.

## How to use this resolved document

- P0 identified an item that blocked a coherent product specification or Taiwanese web Beta.
- P1 identified a launch-quality product decision.
- P2 identified a roadmap decision that could be explicitly deferred.
- Every item now has a final resolution, including deliberate exclusions and future deferrals.
- If a decision changes, update the product specification, rules version where applicable, and this audit trail in the same change.

The resolution link beneath each question is the answer. Detailed decision owners and source precedence are in Sections 1.1 and 1.2 of the product specification.

## Specification readiness gate

The readiness gate is satisfied for development planning because:

1. Every P0 question has a planning-authoritative answer.
2. A product-owned Taiwanese 16-tile ruleset and complete scoring baseline are defined.
3. Beta, Version 1, non-goals, and future scope are separated.
4. Every contradiction below is resolved in Product Specification Section 16.2.
5. Every P1 and P2 item is resolved or explicitly deferred.

## Highest-impact contradiction and ambiguity register

| Topic | PRD ambiguity or conflict | Resolve through |
| --- | --- | --- |
| Product scope | The document describes a broad live-service product, while the GTM section describes a free Taiwanese Quick Play web prototype. | SCP-01 to SCP-04 |
| Match terminology | "Single round," "4 rounds," four prevailing winds, dealer rotation, and final placement are used without defining hand/round/wind/match boundaries. | GOV-06, MOD-04, PRO-05 |
| Taiwanese authority | The exact regional Taiwanese rules and complete Tai table are absent. | GOV-01 to GOV-03, SCO-01 |
| Dealer continuation | The text calls scaling "exponential/compounding" but gives an additive Base Tai + (2k + 1) expression. | TWN-18, TWN-19, SCO-04 |
| Draw wording | "Tilted draws" appears to conflict with the later Ting-based draw rule. | GOV-05, TWN-17 |
| Flower automation | Flower replacement is described as immediate automation, but later appears as an optional automation toggle. | TWN-05, UX-08 |
| Timers | "3.0s mask / 10s total move limit" is not defined, and interception timing is separate from normal turns. | TWN-14, UX-09 |
| Currency identity | Tael, Jade Chips, 両, and Liǎng are presented as alternatives rather than one approved player-facing currency. | GOV-04, SCO-10 |
| Liability | Players must cover maximum liability, but Dragon's Den has no cap. | SCO-07 to SCO-09 |
| Rating | A four-player "zero-sum ELO Matrix" is described without an algorithm or a clear rating unit for Quick Play versus Full Game. | PRO-05 to PRO-08 |
| Bot role | AI tiers exist, but no mode says when bots replace or compete with humans or whether results affect currency and rating. | MOD-06, MOD-08, AI-01, AI-07 |
| Hong Kong scoring | Fan values, point conversion, limits, and the relationship between a blocked win and Chombo are internally unclear. | FUT-04 to FUT-06 |
| Riichi red fives | The PRD specifies four Akadora with two red 5-Wan, which must be confirmed as an intentional house rule. | FUT-07 |
| Spectator positioning | GTM calls the game spectator-friendly, but spectator and replay behavior are not specified. | MOD-12, OPS-15 |

---

## 1. Product scope, goals, and ownership

### SCP-01 - P0 - Which product does the first complete specification describe?

Should it describe only the free Taiwanese Quick Play web beta, a monetized Version 1 launch, or the complete long-term platform including Full Game, social, store, live operations, tournaments, Hong Kong, and Riichi? If it spans multiple releases, provide a feature-inclusion matrix for Beta, V1, and Future.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCP-02 - P0 - What is the exact beta scope?

The GTM section says the beta focuses "entirely" on Taiwanese Quick Play. Does beta include accounts, guest play, tutorial, human matchmaking, AI opponents, Tael stakes, lobby tiers, ELO, XP, friends, mail, store placeholders, analytics, and admin tools? Mark each explicitly in or out.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCP-03 - P0 - What is the primary product promise?

Choose and rank the core promise: highly accurate Taiwanese Mahjong, fast casual sessions, competitive ranked play, social play with friends, collectible customization, or live-service progression. What must a player say is uniquely better than alternatives?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCP-04 - P0 - Who is the primary launch audience?

Rank beginners, casual players who already know Mahjong, expert Taiwanese players, competitive digital board-game players, and diaspora/family groups. Which audience wins when accessibility and rules fidelity conflict?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCP-05 - P0 - What measurable outcomes define success?

Provide target values and measurement windows for tutorial completion, first-match completion, match fairness, rules accuracy, matchmaking wait, Day 1/7/30 retention, session length, crash-free sessions, payer conversion, or other product KPIs. Which are beta exit criteria?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCP-06 - P1 - What are the explicit non-goals?

Confirm whether the product excludes real-money gambling, cash-out, player-to-player currency transfer, user-generated content, voice chat, open text chat, offline multiplayer, three-player variants, or any other nearby feature that should not be inferred.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCP-07 - P0 - Who owns final decisions?

Name the product owner, Taiwanese rules authority, economy owner, UX approver, legal/privacy approver, and live-operations approver. Who breaks ties when traditional rule interpretations differ?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCP-08 - P1 - What reference products set the quality bar?

List specific games or prototypes for table readability, tutorial quality, timing, social flow, economy, live operations, and rules fidelity. State which behaviors should be emulated and which must be avoided.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCP-09 - P1 - What fixed business or product constraints must the specification respect?

Record any immovable budget, launch-window, market, platform, licensing, age-rating, staffing, hosting, or content-production constraints. These are constraints only, not a delivery plan.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

---

## 2. Platforms, markets, brand, and localization

### PLT-01 - P0 - Which platforms are in scope for Beta and V1?

For each milestone, specify desktop web, mobile web, PWA, iOS, Android, tablet, and desktop native. Is "mobile/web" a simultaneous requirement or a longer-term aspiration?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### PLT-02 - P1 - What is the supported device and browser matrix?

Define minimum OS versions, browsers, screen sizes, memory classes, GPU expectations, mouse/keyboard/touch support, and whether older or low-end devices receive a reduced-effects mode.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### PLT-03 - P0 - What orientation and presentation are required?

Is in-match play landscape-only, portrait-capable, or responsive? Must menus and gameplay support phones, tablets, and desktop at the same release? Is the table rendered in 2D, 2.5D, or 3D?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### PLT-04 - P0 - Is an internet connection always required?

Can the tutorial or AI practice work offline? If offline activity exists, what is stored locally, what earns no server-backed rewards, and how is progress reconciled?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### PLT-05 - P0 - Which countries, regions, and languages launch first?

Separate Beta and V1 markets. Specify English, Traditional Chinese, Simplified Chinese, Japanese, Cantonese voice/text, and any other language; identify the authoritative locale for Mahjong terms and rule explanations.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### PLT-06 - P1 - Are mainland China distribution and services in scope?

WeChat sign-in, localization, hosting, data residency, publishing approvals, content rules, and store/payment providers can imply a distinct product path. Confirm whether mainland China is launch scope, future scope, or explicitly excluded.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### PLT-07 - P1 - What are the approved brand and sensory direction?

Provide the game title, publisher/studio names, logo status, art direction, historical-versus-modern tone, tile-face standard, music direction, voice languages, character-guide concept, and licensing/ownership constraints.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

---

## 3. Rules governance, terminology, and configuration

### GOV-01 - P0 - Which exact Taiwanese 16-tile rules tradition is authoritative?

Name the region, association, published rulebook, tournament standard, expert, or existing implementation that resolves every rule and scoring dispute. "Taiwanese Mahjong" alone is not sufficiently specific.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### GOV-02 - P0 - What evidence is required to approve rules behavior?

Will the rules authority provide a complete rulebook, Tai table, worked scoring examples, edge-case decisions, and canonical test hands? Who signs off that the digital implementation matches them?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### GOV-03 - P0 - Which rules are fixed and which are table-configurable?

List all intended house-rule toggles. For public ranked tables, identify one immutable launch default. For private rooms, state whether custom rules are allowed and whether custom results can affect currency, rating, achievements, or statistics.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### GOV-04 - P0 - What is the canonical player-facing currency name and glyph?

Choose Tael, Jade Chips, or another name. Confirm the intended Chinese character and romanization; the PRD currently combines 両, Liǎng, and Jade Chips. Define singular/plural and localized names.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### GOV-05 - P0 - Which terms in the PRD are typos versus intended mechanics?

Confirm "Tai" versus "Tail," "Ting draw" versus "Tilted draw," "Pavilion" versus "Pavillion," and whether "Chong," "Ron," "Zimo," "Tsumo," "Pong/Pon," "Kong/Kan," and "Chow/Chi" should vary by ruleset and locale.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### GOV-06 - P0 - Define the game-state vocabulary.

Give one unambiguous definition for turn, hand, deal, round, prevailing-wind round, dealer rotation, match, session, and full game. Identify which unit ends for a wall draw, which unit produces 1st-4th placement, and which unit updates rating.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### GOV-07 - P1 - How are rules presented and versioned?

Will players have an in-client rulebook, scoring glossary, worked examples, and a visible rules version? When rules change, are active matches pinned to the version on which they started, and are historical replays interpreted under that version?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

---

## 4. Taiwanese setup, legal actions, and round lifecycle

PRD references: pages 1, 5, and 6.

### TWN-01 - P0 - Is every supported Taiwanese match exactly four players?

Confirm whether two-player, three-player, hot-seat, or uneven-seat modes are excluded. If a seat cannot be filled, may a bot occupy it?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-02 - P0 - How are seats and the initial dealer selected?

Specify seat-wind assignment, initial dealer selection, dice use, randomization, party seating, and whether any of these are shown as animations or only represented in state.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-03 - P0 - What is the exact turn and dealer-rotation direction?

The appendix says the deal passes "to the right." Confirm clockwise/counterclockwise behavior from the player's visual perspective and provide an example seat sequence.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-04 - P1 - Is wall building, dice rolling, and wall breaking mechanically significant?

Define the exact break calculation, wall stack arrangement, starting draw location, back-of-wall replacement location, and whether a visually abbreviated setup must preserve the same deterministic result.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-05 - P0 - What is the complete Flower/Season procedure?

Specify initial reveal order, replacement order by seat, chained Flower draws, which end of the wall supplies replacements, whether Flower handling is always mandatory, and what the later "automation toggle" can actually disable.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-06 - P0 - How is the wall exhausted?

Define the live wall, replacement area, any dead-wall reserve, how Flowers and Kongs consume tiles, when no legal replacement remains, and which exact draw ends the hand.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-07 - P0 - Which winning hand structures are legal?

Besides 5 melds plus 1 pair, list every supported exceptional hand, such as seven pairs, thirteen orphans, knitted/special structures, or region-specific hands. State whether open and closed variants differ.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-08 - P0 - What are the exact Chow rules?

Confirm that only the next player in turn order may Chow, which suit sequences are legal, how a player chooses among multiple possible Chows, whether the claimed tile's position must be indicated, and whether Honors can ever be used.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-09 - P0 - What are the exact Pong rules?

Define legal timing, reveal/orientation, priority among simultaneous claims, whether a player may decline and later claim an equivalent discard, and any restrictions after a Pong.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-10 - P0 - What Kong variants and consequences are supported?

Specify concealed Kong, open Kong from a discard, added Kong from an existing Pong, reveal rules, replacement draw, Flower-after-Kong handling, score bonuses, turn continuation, and whether each variant changes hand openness.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-11 - P0 - Can an added Kong be robbed?

Define Robbing the Kong eligibility, claim priority, special scoring, what happens to the fourth tile, and whether multiple players may win from it.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-12 - P0 - What other special win states exist?

Resolve last-tile draw/discard, win after Kong, Heavenly Hand, Earthly Hand, Flower-based instant wins, wins during initial replacement, and any liability/responsibility rules.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-13 - P0 - How are simultaneous Win claims resolved?

Choose single winner by seat priority, multiple winners, head-bump, or another rule. Define ties between Win, Pong, Kong, and Chow and whether the discarder's relationship to each claimant matters.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-14 - P0 - What are the exact action timers?

Separate normal draw/discard time, interception time, animation time, reconnection grace, and banked time if any. Explain "3.0s mask / 10s total move limit," including when choices become visible and when the server closes input.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-15 - P0 - How are concurrent interception choices collected?

Are responses hidden until everyone answers or time expires? Does an early Pong reveal information before another player chooses Win? Can a player revise an answer? How are stale or high-latency actions rejected?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-16 - P0 - What happens on timeout?

Define auto-pass, default discard selection, whether a drawn tile is discarded first, auto-win behavior, repeated-timeout escalation, AFK detection, bot takeover, and penalties.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-17 - P0 - What is the full exhaustive-draw procedure?

Who reveals a hand, how Ting is validated, whether non-dealers receive/pay anything, how hidden information is handled, when the dealer continues, when the dealer passes, and how the Lianzhuang counter changes.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-18 - P0 - What exactly causes dealer continuation?

List outcomes for dealer self-draw, dealer win from discard, non-dealer win, exhaustive draw with dealer Ting, exhaustive draw without dealer Ting, abortive draw, foul, disconnect, and server-voided hand.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-19 - P0 - What is the authoritative Lianzhuang formula?

Confirm whether Base Hand Tai + (2k + 1) is correct, define k for the first continuation, explain why the surrounding text calls the effect exponential/compounding, and specify any cap and who pays the increment.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### TWN-20 - P1 - Which foul and abortive states exist?

Define false win, illegal Chow/Pong/Kong, wrong tile count, premature reveal, illegal discard, insufficient Tai, four-Kong or other abortive conditions, penalties, match continuation, and whether the client prevents or permits each action.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

---

## 5. Scoring, settlement, stakes, and economy

PRD references: pages 2, 5, and 6.

### SCO-01 - P0 - What is the complete Taiwanese Tai table?

Provide every scoring pattern, exact Tai value, open/closed distinction, dealer/seat/prevailing-wind bonuses, Flower values, special hands, and worked examples. Identify the authoritative source and version.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCO-02 - P0 - How do patterns combine?

For every pattern, define stackability, mutual exclusions, superseding patterns, double counting, maximum hand value, rounding, and tie-breaking if two valid decompositions score differently.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCO-03 - P0 - Is there a minimum Tai requirement to win?

If yes, define it by lobby/mode and what the UI does with a structurally complete but sub-threshold hand. If no, define the zero/low-Tai payout.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCO-04 - P0 - What is the exact payout formula?

Give worked settlement examples for self-draw, win from discard, dealer win, non-dealer win, Lianzhuang, Flowers, Kongs, special wins, multiple winners, caps, and draws at every lobby tier.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCO-05 - P0 - Who pays each win?

State whether all opponents pay for self-draw, only the discarder pays for a discard win, whether the dealer pays/receives multipliers, and whether responsibility payments can redirect liability.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCO-06 - P0 - What does "Base Stake per Tai" mean?

Specify whether final transfer is Tai x stake, an exponential lookup, a base-plus-bonus formula, or another calculation. Define rounding and maximum representable values.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCO-07 - P0 - What does the liability cap cap?

Does it cap total winning-hand value, each loser's payment, the discarder's payment, or total payout? Explain how a capped payout is divided among winners/losers and shown on the tally sheet.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCO-08 - P0 - How can Dragon's Den require adequate liability with "No Cap"?

Define the maximum possible legal hand, required bankroll or escrow, negative-balance policy, and what happens if a player cannot cover a valid settlement.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCO-09 - P0 - How is bankroll reserved for Full Game?

Is only the lobby minimum checked, or is potential liability locked before each hand or entire match? Can a player fall below the entry threshold but continue the current match? Can a balance ever become negative?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCO-10 - P0 - Distinguish entry requirement, entry fee, wager, and stake.

The PRD uses these concepts interchangeably. For each mode, state what is merely a balance gate, what is deducted on entry, what is escrowed, what is transferred between players, and what is permanently sunk.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCO-11 - P0 - Is the match economy strictly zero-sum?

Identify any house rake, service fee, jackpot contribution, system subsidy, bot-funded payout, rounding sink/source, or promotional multiplier.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCO-12 - P0 - What are the starting balance and recovery rules?

Define the initial grant for tutorial completion and tutorial skip, daily grants, "Alms" eligibility and amount, reset-pool behavior, ad rewards, cooldowns, abuse limits, and whether players can become permanently unable to play.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCO-13 - P1 - What are all planned currency sources and sinks?

Cover play settlement, missions, achievements, mail, battle pass, direct purchase, ads, tournaments, cosmetics, fees, refunds, compensation, expiration, and admin grants. State the intended inflation/bankruptcy targets.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCO-14 - P0 - Can Taels be bought with real money or premium currency?

If yes, explain the intended pay-to-continue/pay-to-compete policy, regional restrictions, purchase caps, age controls, disclosures, and whether purchased and earned balances are distinguished.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### SCO-15 - P0 - Can anything with value leave an account?

Confirm whether cash-out, redemption, gifting, trading, wagering between friends, player-to-player transfers, account sale, or prizes with real-world value are prohibited or supported. Identify the legal review owner.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

---

## 6. Modes, matchmaking, and session lifecycle

PRD references: pages 1, 2, 4, and 5.

### MOD-01 - P0 - What is the complete three-chapter tutorial script?

For each chapter, specify learning objective, starting hand/wall state, forced actions, guide dialogue, allowed mistakes, correction behavior, scoring explanation, completion condition, and reward.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MOD-02 - P1 - How do skip, replay, and prior experience work?

Can players skip before or during any chapter, resume later, replay from settings, earn the same reward after skipping, and choose a more advanced rules refresher?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MOD-03 - P0 - What exactly is Quick Play?

Confirm that it is one complete hand/deal, identify dealer selection, placement determination, tie-breaking, currency settlement, rating update, rematch behavior, and target session duration.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MOD-04 - P0 - What exactly is Full Game?

Does "4 rounds (East, South, West, North)" mean four hands with each seat dealing once, four prevailing-wind rounds potentially containing at least sixteen hands, or something else? Define termination, dealer continuations, tie-breakers, maximum duration, and target duration.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MOD-05 - P0 - Which modes are ranked and/or staked?

For Tutorial, AI Practice, Quick Play, Full Game, private rooms, tournaments, and future rulesets, state whether each affects Taels, ELO/MMR, XP, achievements, missions, profile statistics, and leaderboards.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MOD-06 - P0 - Where can a player intentionally choose AI opponents?

Is there solo practice, difficulty selection, mixed human/bot tables, offline AI, or tutorial-only AI? Which of these are Beta and V1 scope?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MOD-07 - P0 - What does public matchmaking optimize?

Rank stake tier, skill rating, geographic region, latency, party size, language, rules version, platform, wait time, and repeat-opponent avoidance. Define acceptable wait thresholds and expansion behavior.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MOD-08 - P0 - May bots fill or backfill public tables?

If yes, when, at what difficulty, with what disclosure, bankroll source, rewards, rating impact, and replacement behavior if a human reconnects?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MOD-09 - P1 - Are private rooms and friend parties supported?

Define room creation, join codes/invites, host options, spectators, bot seats, stakes, custom rules, seat choice, rematches, and whether private results count toward progression.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MOD-10 - P0 - What is the disconnect and reconnect contract?

Define grace period, state resynchronization, hidden-hand protection, action behavior while absent, AI takeover, return control, repeated disconnect penalties, currency/rating outcome, and mobile backgrounding.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MOD-11 - P0 - What are voluntary quit and AFK penalties?

Separate queue dodge, pre-deal leave, mid-hand quit, Full Game abandonment, repeated timeout, and emergency/server-caused interruption. State any cooldown, automatic loss, currency liability, rating penalty, or appeal/compensation path.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MOD-12 - P1 - Are spectating, replays, and game history required?

Define live spectator delay, hidden-hand visibility, friend/tournament permissions, anti-collusion controls, streamer mode, replay retention, shareability, and whether the GTM strategy depends on these at Beta or V1.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MOD-13 - P1 - What happens when a match cannot complete normally?

Define behavior for server crash, maintenance, desync, rules-engine error, impossible wall state, cheating detection, all players disconnecting, or a tournament cancellation. Specify void/refund/restore/compensation policy.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

---

## 7. User flow, in-match UX, assists, and accessibility

PRD references: pages 3, 4, and 5.

### UX-01 - P0 - What is the required top-level information architecture by milestone?

For Beta and V1 separately, list the actual destinations shown after sign-in: lobby, Quick Play, Full Game, practice, tutorial, profile, friends, customization, store, mail, events, settings, help/rules, and support. Identify which PRD screens are placeholders versus functional.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### UX-02 - P0 - What is the required table presentation?

Specify 2D/2.5D/3D, fixed or movable camera, local-player seat orientation, hand scale, meld layout, discard-grid ordering, wall visibility, tile-count visibility, and how layouts adapt without hiding legal actions.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### UX-03 - P1 - How does tile selection and hand organization work?

Define single-tap/select versus double-tap/confirm, drag-to-discard, accidental-discard protection, manual reordering, auto-sort categories, sorting after every draw/claim, selected-tile persistence, keyboard controls, and touch target minimums.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### UX-04 - P0 - Which player assists are allowed in each mode?

For Ting detection, winning-tile lists, remaining-tile counts, identical-tile highlighting, discard danger, recommended moves, score previews, and auto-arrange, specify Tutorial, Practice, casual public, ranked, private, tournament, and spectator availability.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### UX-05 - P0 - How is the Ting remaining quantity calculated and described?

Does it equal four copies minus the player's own hand and all publicly visible tiles, or only the visible public pool? Confirm that it never uses hidden information. Define behavior for multiple hand decompositions, already-exhausted waits, and ruleset-specific legality.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### UX-06 - P0 - Does the client show only legal actions?

If the rules engine knows an action is illegal, is its button hidden, disabled with explanation, or selectable with a foul consequence? Define this consistently for Win, sub-threshold hands, Chow, Pong, Kong, Riichi, and special claims.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### UX-07 - P1 - What visual rules make discards and claims unambiguous?

Define recent-discard highlight duration, claimed-tile orientation, source-player indication, per-player discard order, identical-tile highlighting, color-independent cues, animation interruption, and what remains visible in compact/mobile layouts.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### UX-08 - P0 - What do the automation settings actually control?

Resolve the conflict between mandatory Flower replacement and an "automatically declare/draw replacements" toggle. Define defaults and mode restrictions for auto-sort, Flower handling, auto-pass, auto-win, auto-discard, and any reconnect automation.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### UX-09 - P0 - What does the timer communicate?

For normal turns and interceptions, define total time, any hidden/masked interval, latency allowance, warning thresholds, overtime/bank behavior, color/audio/haptic cues, accessibility alternatives, and what the player sees when another player is deciding.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### UX-10 - P0 - What must the scoring and match-end screens explain?

Specify the order and depth of hand reveal, Tai line items, exclusions, stake formula, each player's payment, cap application, dealer continuation, rating change, XP, missions, rematch, dispute/report, and return-to-lobby actions.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### UX-11 - P1 - What are the required loading, empty, error, and recovery states?

Cover patch/version mismatch, service unavailable, authentication failure, no eligible lobby, insufficient balance, queue timeout, invite expiry, purchase failure, ad failure, reconnecting, desync, maintenance, and client update required.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### UX-12 - P0 - What accessibility standard and acceptance bar apply?

Choose WCAG target where applicable and define text scaling, contrast, color-blind-safe tile identification, reduced motion, flashing limits, screen-reader coverage, keyboard navigation, subtitles, captions for declarations, and non-audio timer cues.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### UX-13 - P1 - What audio, haptic, and motion behavior is required?

Define music, ambient table audio, tile sounds, voice declarations, opponent cosmetic effects, haptics, mute granularity, background-audio behavior, reduced-motion alternatives, and whether cosmetics may ever reduce readability or change timing.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### UX-14 - P1 - What settings persist, and where?

List language, audio, haptics, graphics, sorting, automation, accessibility, privacy/presence, notifications, data/analytics consent, and account controls. State whether each is device-local, account-synced, ruleset-specific, or mode-forced.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

---

## 8. Identity, friends, communications, safety, and privacy

PRD reference: page 4.

### ACC-01 - P0 - What can a Guest account do?

Define generated identity, persistence duration, device binding, online multiplayer access, purchases, friends, mail, progression, recovery, age/terms acceptance, and what is lost if the app or browser data is cleared.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### ACC-02 - P0 - How does Guest conversion and account linking work?

Define linking to Apple, Google, WeChat, or Facebook; conflicts with an existing account; merge rules for currency, purchases, rating, inventory, and friends; unlinking; and recovery from an accidental link.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### ACC-03 - P0 - Which identity providers are actually required at each milestone?

Separate Beta and V1. Confirm whether email/password, passkey, platform account, Apple, Google, WeChat, and Facebook are supported, and whether Apple Sign-In is required when other social providers are offered on iOS.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### ACC-04 - P0 - What are the age gate and consent requirements?

Set minimum age by region, parental-consent handling, age-assurance method, restrictions on ads/social/purchases for minors, and age-rating targets.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### ACC-05 - P0 - What is the account privacy lifecycle?

Define consent versioning, data export, account deletion, deletion grace period, anonymization, legal retention, guest deletion, purchase records, match-history retention, and what other players continue to see after deletion.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### ACC-06 - P1 - What are username, avatar, title, and Player ID policies?

Define creation, uniqueness, rename frequency/cost, allowed characters, profanity/impersonation filters, default avatars, custom uploads if any, report flow, moderation, and whether Player IDs are searchable or shareable.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### ACC-07 - P1 - What is the complete friend lifecycle?

Define search, request, accept/decline, limits, duplicate/spam controls, unfriend, block, recent players, cross-region friendship, invite permissions, and what happens when a friend is in a match.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### ACC-08 - P1 - What presence information is visible?

Specify Online, Away, In Match, lobby/mode/stake visibility, last-seen time, invisible mode, streamer mode, blocked-user behavior, and privacy defaults for minors.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### ACC-09 - P0 - Are chat, voice, free text, or emotes in scope?

If none are in scope, state that explicitly. If any are supported, define where, age restrictions, mute/block/report, moderation, logging, localization, anti-spam, and tournament/private-room differences.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### ACC-10 - P0 - What player-safety and reporting features are required?

Define report categories, evidence attached automatically, match/report history access, acknowledgement, review tooling, sanctions, appeals, false-report handling, urgent escalation, and user-facing feedback.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### ACC-11 - P0 - How are collusion and multi-account abuse addressed as product rules?

Cover friend/party matchmaking, repeated opponents, chip dumping, coordinated discard behavior, multiple accounts/devices, botting, account sharing, suspicious transfers, private-room farming, and consequences for currency/rating/rewards.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### ACC-12 - P1 - What are mail and notification rules?

Define system versus reward mail, targeting, expiry, Claim All behavior, inventory/entitlement overflow, duplicate claims, read state, push/email opt-in, quiet hours, deep links, and child-account restrictions.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

---

## 9. AI behavior and bot policy

PRD reference: page 5.

### AI-01 - P0 - What jobs do bots perform?

Select among tutorial actors, solo practice, public-table fill, disconnect takeover, matchmaking backfill, internal simulation, and tournament substitution. For each, state milestone and whether the bot is disclosed.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### AI-02 - P0 - What information may AI use?

Confirm that bots use only legally visible state plus their own hidden hand, with no access to wall order or opponent hands. Define whether Easy/Medium may intentionally ignore visible information.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### AI-03 - P0 - What complete decisions must each difficulty make?

For draw evaluation, discard, Chow, Pong, each Kong type, Win, pass, defense, value pursuit, dealer risk, wall exhaustion, and timer use, define intended Easy, Medium, and Hard behavior.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### AI-04 - P0 - What does "100% safe tile" mean?

The Hard description implies certainty that may not exist under all Taiwanese states. Define the safety model, acceptable inference, unknown-risk handling, and when Hard abandons offense.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### AI-05 - P1 - What strength and personality targets are required?

Provide measurable win/placement targets against reference players or bots, mistake rates, reaction-time distributions, variation between agents, and whether difficulty adapts to the player.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### AI-06 - P1 - Must bot behavior be reproducible?

Define seeded determinism for tests/replays, allowed randomness, performance budget per decision, fallback if evaluation times out, and how AI version changes affect replay or fairness analysis.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### AI-07 - P0 - How do bot results affect systems?

For each bot use, state effects on Taels, ELO/MMR, XP, achievements, missions, profile statistics, leaderboards, and welfare eligibility. Define the bot's bankroll source and sink.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### AI-08 - P2 - How do AI requirements extend to Hong Kong and Riichi?

Is future-ruleset AI part of the initial architecture only, required when each module launches, or out of scope? Identify whether difficulty labels must represent comparable player strength across rulesets.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

---

## 10. Account progression, rating, statistics, and leaderboards

PRD references: pages 2, 3, and 5.

### PRO-01 - P1 - What awards XP, and how much?

Provide the XP table for completion, placement, winning a hand, self-draw, claims, Kongs, hand value, tutorial, AI/private/ranked play, missions, and achievements. Define caps and anti-farming rules.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### PRO-02 - P1 - What is the level curve and reward catalog?

Define starting level, XP thresholds, maximum/prestige behavior, every unlock, retroactive grants after tuning, and whether lobby access is controlled by level, balance, rating, or combinations.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### PRO-03 - P1 - What is the achievement specification?

List launch achievements, exact counters, eligible modes, hidden achievements, tiers, rewards, retroactivity, localization, progress display, and behavior when rules change.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### PRO-04 - P0 - Is "ELO Matrix" the intended rating system or only shorthand?

Choose or define a four-player rating algorithm. State whether it is truly zero-sum, how opponent ratings and placement are converted to changes, and provide worked examples.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### PRO-05 - P0 - What event updates rating?

Does rating change after each Quick Play hand, each hand inside Full Game, only final Full Game placement, or a combination? How are 1st-4th placements created for a one-hand Quick Play result?

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### PRO-06 - P0 - Is rating shared or segmented?

Define separate or shared ratings by Taiwanese/Hong Kong/Riichi, Quick/Full/Tournament, ranked/unranked, stake tier, region, and season. Explain how matchmaking uses each.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### PRO-07 - P1 - What are initialization and lifecycle rules for rating?

Define starting rating, provisional games, uncertainty, placement matches, floors, tiers, decay, seasonal resets, inactivity, smurf mitigation, and display precision.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### PRO-08 - P0 - How do abnormal outcomes affect rating and statistics?

Cover ties, multiple winners, exhaustive draws, disconnect, voluntary quit, AFK, bot takeover, server void, rule correction, detected cheating, private rooms, and matches with any AI seat.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### PRO-09 - P1 - What are the exact statistic and leaderboard definitions?

Define denominators and eligible modes for finish percentages, Win/Loss, Zimo-versus-Chong rate, deal-in percentage, average Tai, hands played, disconnects, and streaks. Specify filters, seasons, privacy, minimum sample sizes, tie-breakers, and leaderboard rewards.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

---

## 11. Store, monetization, ads, tournaments, and live operations

PRD references: pages 4, 5, and 6.

### MON-01 - P0 - Is monetization enabled during Beta?

For Beta and V1 separately, state whether premium currency, Tael top-offs, cosmetics, rewarded ads, battle pass, and ticketed tournaments are functional, visible-but-disabled, or absent.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MON-02 - P1 - What is the premium currency?

Define name, icon, acquisition, purchase packages, regional pricing, bonus amounts, spending uses, refund behavior, expiry, and whether earned and purchased units are distinguished.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MON-03 - P0 - What is the policy for selling gameplay currency?

Resolve whether Tael top-offs are direct purchases, premium-currency exchanges, earned recovery, or ads. Define purchase limits, bankruptcy prompts, fairness positioning, minor protections, and compliance review.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MON-04 - P1 - What is the launch cosmetic catalog and entitlement model?

List tile skins, table textures/backdrops, avatar frames, titles, animations, music, and voice packs. Define ownership duration, equip slots, previews, opponent visibility, readability constraints, cross-platform access, and compatibility across rulesets.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MON-05 - P0 - What are purchase, refund, and chargeback rules?

Define receipt validation, restore purchases, duplicate transactions, pending/failure states, platform refunds, chargebacks, negative premium balances, revoked cosmetics, account sanctions, customer support, and server rollback.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MON-06 - P0 - What is the rewarded-ad design?

Specify providers, eligible regions/ages, consent, placements, reward values, daily caps, cooldowns, failure/retry, ad-unavailable fallback, fraud prevention, no-ads purchase if any, and whether ads can interrupt play.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MON-07 - P1 - What is the complete season/battle-pass contract?

Define season length, free and paid tracks, price, progression source, tier count, mission contribution, purchase after progress, catch-up, tier skips, grace period, unclaimed rewards, duplicate handling, and whether limited items may return.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MON-08 - P1 - What is the rotating-store contract?

Define rotation cadence and timezone, catalog size, personalized offers, purchase limits, previews, countdown accuracy, reruns, discount reference prices, regional differences, and emergency removal/refund behavior.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MON-09 - P1 - What is the tournament product?

Define bracket/table format, qualification, entry currency, prize type, schedule, seeding, rules/stakes, late arrival, disconnect, substitution, anti-collusion, spectator delay, tie resolution, cancellation, refund, and whether anything has real-world value.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MON-10 - P1 - How do daily/weekly challenges determine eligibility?

Specify reset timezone, progress across rulesets/modes/AI/private games, retroactivity, abandonment, impossible states, rerolls, anti-farming, claim/expiry, and how ruleset-specific missions are hidden from ineligible players.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MON-11 - P1 - What live-operations controls are required?

List remotely configurable lobbies, stakes, caps, rewards, offers, events, missions, banners, mail, feature flags, rules versions, matchmaking parameters, and maintenance messages. Define roles, approval, audit log, scheduling, preview, rollback, and environment separation.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### MON-12 - P1 - What is the content cadence and ownership model?

Set intended season/event/module cadence, required asset quantities, localization lead time, cultural review, music/voice rights, operational staffing owner, and what happens if content is delayed.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

---

## 12. Hong Kong and Riichi future-module decisions

PRD references: pages 3 and 7.

### FUT-01 - P0 - How much future-ruleset detail belongs in the current specification?

Choose one: architecture-ready only, product flows and contracts defined but content deferred, or complete playable Hong Kong and Riichi specifications. If deferred, state the exact stable extension points the current product spec must preserve without writing an implementation plan.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### FUT-02 - P2 - Is Hong Kong first and Riichi second an approved release commitment?

Confirm order, target markets, milestone status, and what evidence could change the order.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### FUT-03 - P0 - What are the authoritative rule sources for each future module?

Name the exact Hong Kong variant and Riichi standard/association, rule owner, scoring tables, edge-case authority, and localization terminology.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### FUT-04 - P2 - What is the full Hong Kong rules configuration?

Define 136-versus-144 tile default, Flower allocation/scoring, minimum Fan, special hands, claim priority, multiple wins, dealer rotation, draws, payouts, limits, Fouls/Chombo, and which options are public-lobby versus private-room settings.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### FUT-05 - P2 - What does the Hong Kong Fan scaling sentence mean?

The PRD says "4 Fan -> 8 Fan -> 16 Fan" and also mentions modern limits up to 10 Fan. Separate Fan count from base points/payout multipliers and provide the authoritative conversion table and cap.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### FUT-06 - P2 - How can a sub-threshold Hong Kong win be both blocked and a Chombo?

Choose the intended UX/rule behavior: hide/disable Win, allow declaration and penalize it, or distinguish manual versus automatic declaration. Define the exact penalty and tutorial/rulebook explanation.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### FUT-07 - P2 - Are four Riichi red fives intentional?

Confirm the specified one Red 5-Pin, one Red 5-Sou, and two Red 5-Wan composition as an intentional house rule or replace it with the authoritative launch standard. State whether red-five count is configurable.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### FUT-08 - P2 - What complete Riichi scoring and round rules are required?

Provide Yaku/Yakuman list, Han/Fu calculation, limits, open/closed values, starting points, East/South match structure, dealer continuation, Honba, Riichi sticks, Tsumo/Ron payments, rounding, placement points, and end conditions.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### FUT-09 - P2 - Which omitted Riichi mechanics must be supported?

Resolve Ippatsu, Ura-Dora, Kan-Dora, Kan-Ura, temporary/permanent/self-discard Furiten, Chankan, double/triple Ron or head-bump, exhaustive and abortive draws, Nagashi Mangan, exhaustive-draw payments, Chombo, and special end conditions.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### FUT-10 - P1 - Which systems are shared versus ruleset-specific?

For lobby tiers, Taels, premium currency, MMR, account level, statistics, missions, achievements, cosmetics, tutorial, AI, timers, UI labels, store, and leaderboards, define shared state, separate state, and conversion behavior.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

---

## 13. Analytics, reliability, security, compliance, support, and GTM acceptance

PRD references: pages 1, 4, and 6.

### OPS-01 - P0 - What is the Beta test design and exit decision?

Define open/closed access, target regions and languages, participant count, test duration, supported devices, feedback channels, experiment policy, success/failure thresholds, and who approves progression beyond Beta.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### OPS-02 - P0 - What product analytics events and funnels are required?

Cover install/load, account/guest, consent, onboarding choice, tutorial steps, lobby browse, queue, matchmaking, every game action/outcome, disconnect, scoring, economy transfers, rating, store, ads, missions, social, reports, and errors. Identify the minimum Beta set.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### OPS-03 - P0 - What analytics/privacy controls apply?

Define consent by region/age, essential versus optional telemetry, SDKs, PII policy, player identifiers, retention, deletion, access controls, data residency, export, and whether raw tile/action histories may be retained for anti-cheat and rule disputes.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### OPS-04 - P1 - What player and concurrency scale must the product support?

Provide Beta and V1 targets for registered users, daily/monthly active users, peak concurrent users, concurrent matches, event spikes, tournament spikes, and geographic distribution.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### OPS-05 - P0 - What real-time performance targets apply?

Set targets for input acknowledgement, state update, claim resolution, animation completion, matchmaking wait, reconnect, acceptable latency/jitter/packet loss, and behavior above thresholds.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### OPS-06 - P1 - What client performance and download targets apply?

Define initial load, patch size, memory, battery/data use, frame rate, thermal behavior, crash-free session rate, resume time, low-end profile, and background/foreground recovery.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### OPS-07 - P0 - What availability and recovery targets apply?

Define uptime, planned maintenance, match-state durability, recovery-point and recovery-time expectations, region failure behavior, backup/restore, deployment rollback, and player compensation after incidents.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### OPS-08 - P0 - What is the authoritative-server and anti-cheat policy?

Specify which actions and calculations must be server-authoritative, client trust boundaries, replay/action-log requirements, tamper/root/jailbreak policy, rate limits, bot detection, collusion analysis, sanctions, and false-positive appeal.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### OPS-09 - P0 - What fairness and RNG assurance is required?

Define shuffle algorithm expectations, secure seed source, bias testing, auditability, reproducible internal tests, certification if any, player-facing fairness statement, and who may inspect or disclose seeds after a match.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### OPS-10 - P0 - What security and administrative controls are required?

Cover transport/storage encryption, secret handling, session/token lifetime, admin MFA, role-based access, economy grants, impersonation/support access, audit logs, suspicious-login response, breach notification, and vendor review.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### OPS-11 - P0 - Which legal and platform-policy reviews are mandatory?

Identify owners and target markets for review of gambling-like virtual stakes, purchasable gameplay currency, rewarded ads, premium tournaments, minors, social features, odds/value disclosures, consumer refunds, taxes, privacy, and app-store policies.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### OPS-12 - P1 - What localization and cultural-quality process is required?

Define translator/reviewer qualifications, Mahjong-expert review, terminology glossary, Traditional versus Simplified Chinese, Cantonese/Mandarin voice, Japanese rules terms, layout expansion, date/number/currency formats, and cultural-event approval.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### OPS-13 - P1 - What customer-support and dispute workflow is required?

Define in-product help/contact, supported languages/hours, response targets, match-ID access, scoring dispute review, missing-currency/purchase recovery, report appeals, account recovery, known-issue messaging, and compensation authority.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### OPS-14 - P0 - What acceptance evidence proves rules correctness?

Require a golden suite of setup, legal-action, priority, scoring, draw, dealer, cap, timeout, reconnect, and abnormal-state examples approved by the rules owner. Define expected coverage and whether every live rules change must update it.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

### OPS-15 - P1 - What GTM and community capabilities are actually product requirements?

Confirm whether Beta needs invite codes, feedback prompts, tournament administration, spectator delay, replay links, streamer-safe overlays, creator accounts, match codes, promotional banners, referral tracking, community moderation, or public leaderboards.

**Resolved answer:** See [Mahjong Product Specification](mahjong-product-specification.md), using this question ID in Section 16.3.

---

## Team sign-off

Planning baseline sign-off:

- Product scope: Resolved for planning; accountable role is Product Owner.
- Taiwanese rules and scoring: Product-owned v1.0 baseline resolved; Rules Lead validation is a pre-Beta acceptance requirement.
- Economy and monetization: Resolved; Jade is non-purchasable and monetization is future scope.
- UX and accessibility: Resolved; WCAG 2.2 AA is the target where applicable.
- Safety, privacy, and legal constraints: Resolved for planning; qualified review remains a pre-release acceptance requirement.
- Operations and live-service scope: Resolved for Beta and Version 1.
- Deferred items: paid monetization, ads, tournaments, spectator/replay, native apps, mainland China, Hong Kong, and Riichi.
- Product specification completed: 2026-07-13.
