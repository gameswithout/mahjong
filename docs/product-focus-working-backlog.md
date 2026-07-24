# Product Focus Working Backlog

- Date: 2026-07-24
- Product focus: gameplay experience, UI/UX, progression, and economy
- Input: product-owner draft PRD supplied on 2026-07-24
- Planning authority: `docs/mahjong-product-specification.md` remains authoritative

## Product direction

Build outward from the playable Taiwanese 16-tile hand into a product loop that
is easy to learn, satisfying to read, and worth returning to:

```text
understand the table
  -> make a confident decision
  -> understand the result
  -> earn visible progress
  -> choose the next meaningful activity
```

The near-term experience should prove this loop before adding more rulesets,
paid systems, or high-volume live-operations content.

## Decisions already incorporated from the draft

The authoritative specification already includes:

- Taiwanese 16-tile rules, Flower replacement, claims, Ting, dealer
  continuation, Tai scoring, and deterministic settlement.
- Tutorial, AI Practice, one-hand Quick Play, and Full Rotation.
- Bamboo, Sparrow, Wind and Cloud, and Dragon's Den lobby identities.
- Jade entry requirements, stake-per-Tai values, liability caps, grants,
  welfare recovery, and a conserved ledger model.
- XP, account levels, achievements, statistics, Full Rotation Elo, seasonal
  leaderboards, Quick Play ladder progress, and earned cosmetics.
- Ting assistance, matching-tile highlighting, latest-discard emphasis,
  sorting, automation, result explanation, accessibility, and responsive table
  requirements.
- Easy, Medium, and Hard bot policies with hidden-information boundaries.
- Architecture boundaries for future Hong Kong and Riichi rulesets.

## Current product decisions that differ from the draft

These are intentional decisions in the current specification, not accidental
omissions:

| Draft concept | Current product decision |
| --- | --- |
| Tael / Jade Chips / wager language | Jade (玉) only; no cash, chip, wager, or betting language |
| Purchasable play currency and top-offs | Jade is non-purchasable, non-transferable, and has no monetary value |
| Uncapped Dragon's Den | 300,000-Jade per-hand debit cap |
| Four-round East/South/West/North Full Game | Full Rotation is one East round; winds are seat winds |
| Elo based on every round placement | Pairwise Elo applies only to completed public Full Rotation matches |
| Cosmetic store, ads, battle pass, voice packs | Excluded from Version 1; cosmetics are earned |
| Ticketed tournaments | Deferred and requires separate legal/product approval |
| Playable Hong Kong and Riichi modules | Architecture-ready only; no implementation estimate yet |

Reopening any row requires a named product decision and, for monetization or
stakes presentation, legal/platform review before implementation planning.

## Priority 0 — make the existing hand delightful

### P0.1 Table comprehension pass

- Establish one visual hierarchy for turn owner, latest discard, claim urgency,
  wall count, dealer/round state, and local legal actions.
- Make every state understandable without opening developer diagnostics.
- Keep concealed information private while making opponent melds, discards,
  timers, and connection state scannable.
- Validate at 360x640 landscape, tablet, and desktop.

Acceptance:

- A first-time observer can identify whose turn it is, the last discard, and
  the available local action within two seconds.
- No legal action is represented only by color.
- Claim and turn timers remain readable under reduced motion and high contrast.

### P0.2 Decision confidence

- Complete matching-tile highlighting across hand, public melds, and discards.
- Present Ting waits and visible remaining counts with a clear explanation of
  what the count can and cannot know.
- Explain disabled actions instead of silently hiding them where that does not
  reveal private state.
- Add an optional confirmation safeguard for unusually dangerous or
  irreversible actions; do not add friction to every discard.

Acceptance:

- The player can inspect a tile without accidentally discarding it.
- Assist information is derived from the authoritative legal state.
- Keyboard, touch, and pointer paths expose the same information.

### P0.3 Result comprehension

- Turn the hand result into a readable story: winning tile, hand structure,
  Tai sources, dealer modifiers, cap application, and per-player transfer.
- Separate Practice points, Full Rotation table points, and Jade clearly.
- Keep replay/return actions visually secondary to the explanation until the
  first scan is complete.

Acceptance:

- All four balance changes reconcile visibly to zero for a Jade hand.
- Capped settlements show both the uncapped calculation and applied cap.
- Practice never implies persistent rewards.

## Priority 1 — onboarding and repeat play

### P1.1 Three-chapter tutorial vertical slice

1. Build five sets and one pair.
2. Learn Chow/Pong/Kong and claim priority.
3. Reach Ting, compare safe and dangerous discards, and complete a hand.

The tutorial should use versioned scripted fixtures and the same table
components as live play. Every instruction has a skip path, replay path, and
analytics event.

### P1.2 Player-facing lobby hub

- Replace development-oriented entry controls with clear Practice, Quick Play,
  and locked/future-mode cards.
- Show Jade balance, eligibility, expected session length, rules version, and
  queue health before entry.
- Keep account level and progress visible without turning the lobby into a
  notification dashboard.

### P1.3 Session closure

- Add an end-to-end loop from result to Play Again, change mode, or lobby.
- Preserve failure recovery for leave, reconnect, and settlement ambiguity.
- Make the next recommended activity contextual but dismissible.

## Priority 2 — progression that teaches mastery

### P2.1 Basic XP and level presentation

- Award XP from authoritative completed-match events.
- Show one compact post-match XP animation with current level and next reward.
- Provide a progression screen with the full level curve and earned cosmetics.

### P2.2 Achievement set

- Start with milestones already derivable from canonical events.
- Favor achievements that teach rules or celebrate mastery over grind.
- Display exact progress and eligibility; never hide launch achievements.

### P2.3 Statistics dashboard

- Separate Quick Play and Full Rotation.
- Lead with Win rate, Zimo share, deal-in rate, Ting reach rate, and placement
  distribution where applicable.
- Explain denominators and delay percentages until the minimum sample size.

### P2.4 Competitive progression

- Keep Elo exclusive to public Full Rotation.
- Use Quick Play seasonal ladder points for short-session progression without
  changing matchmaking or Jade.
- Present provisional status and rating changes transparently.

## Priority 3 — a safe, testable Jade economy

### P3.1 Read-only economy UI

- Show balance, table eligibility, stake per Tai, and maximum liability before
  any live transfer is enabled.
- Add result and ledger-history views using deterministic fixtures.

### P3.2 Authoritative ledger integration

- Reserve maximum liability before seating.
- Settle with idempotent, balanced journal entries.
- Reconcile credits and debits and expose support-safe Match IDs.
- Block entry cleanly when a reserve cannot be made.

### P3.3 Faucets and recovery

- Implement onboarding and daily grants within configured bounds.
- Offer a welfare recovery grant below the Bamboo threshold.
- Prevent farming through server-side eligibility and idempotency.

### P3.4 Economy tuning gate

Do not open higher tiers based only on implementation completion. Require
simulation and observed Beta evidence for balance distribution, insolvency
rate, faucet-to-cap ratio, queue health, dealer advantage, and cap frequency.

## Explicitly deferred

- Paid Jade, currency top-offs, advertisements, randomized rewards, and
  gameplay-affecting purchases.
- Battle pass, paid store rotation, ticketed tournaments, and voice-pack sales.
- Playable Hong Kong and Riichi rulesets.
- Spectating, public replay sharing, clubs, and tournament operations.

## Recommended first implementation slice

Start with **P0.1 Table comprehension pass**. It improves Practice and online
play immediately, creates the reusable table surface needed by the tutorial,
and gives progression/economy feedback a stable visual home.

Deliverables:

1. A table-state visual inventory mapped to current components.
2. Updated table hierarchy and interaction states.
3. Responsive and accessibility regression tests.
4. Before/after captures at the certified minimum viewport and desktop.
5. A short playtest script measuring turn-owner, latest-discard, and legal-action
   comprehension.
