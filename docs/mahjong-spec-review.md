# Product Design & Specification Review — Mahjong (Taiwanese 16-Tile)

- Reviewed document: `mahjong-product-specification.md` v1.0 (decision date 2026-07-13)
- Review date: 2026-07-17
- Disposition: all Critical, High, and Medium findings incorporated into specification v1.1; Future items recorded as prioritized future scope. See spec Section 16.4 for the change register.
- Reviewer stance: Principal Game Designer / PM / UX / Economy / LiveOps
- Verdict: **One of the most rigorous pre-production specs I have reviewed. It is production-grade on rules, fairness, safety, and server authority. Its weaknesses are almost all on the product side: retention depth, mode/economy structure, Beta design, and the absence of any business model. A handful of genuine rules edge cases remain unspecified.**

---

## Executive scorecard

| Area | Score /10 | One-line assessment |
| --- | ---: | --- |
| Vision | 9 | Crisp promise, explicit priority stack, explicit non-goals |
| Market positioning | 7 | Real underserved niche (English-accessible Taiwanese 16-tile), but no revenue thesis |
| Differentiation | 7 | Fair-play + rules-accuracy is differentiating but hard to market; no social/spectate hooks at launch |
| Core gameplay | 8 | Sound loops; Quick Play/Full Rotation split creates a progression gap |
| Rules completeness | 9 | Exceptional; ~6 real edge cases remain (detailed below) |
| Onboarding | 9 | Best-in-class tutorial spec; missing a bridge from tutorial to first human match |
| Progression | 6 | Thin endgame: 12 achievements, level 50 cap, sparse cosmetic track |
| Retention | 5 | Deliberately anti-manipulative, but D30 will suffer; Beta measures retention without its strongest hooks |
| Social | 5 | Safety-first minimalism is defensible; Beta has zero social features despite a diaspora/family audience |
| Competitive design | 7 | Clean pairwise Elo; guest-account smurfing and ranked session length are unresolved |
| Economy | 6 | Auditable and safe, but faucet-only inflation and two effectively dead lobby tiers at launch |
| Monetization | n/a | Explicitly absent — correct as scoped, but a business risk, not a solved problem |
| UX | 8 | Thorough; forced landscape and uniform timers are the main friction points |
| Accessibility | 9 | WCAG 2.2 AA, high-contrast skin, reduced motion; left-handed layout missing |
| LiveOps readiness | 8 | Excellent config governance; A/B scope is (deliberately) narrow |
| Technical | 9 | Server authority, deterministic replay, double-entry ledger, commit-before-deal — all correct |
| Analytics | 8 | Strong event model; a few funnel KPIs need explicit targets |
| Production readiness | 8 | Ready for engineering planning; no wireframes exist yet, so not ready for UI implementation |

---

## 1. Product Vision

**Strengths.** The promise (§2.1) is unusually disciplined: five priorities in explicit order, with tie-break rules ("Rules accuracy wins over reducing complexity. Monetization never wins over fair play."). The audience (§2.2) is clear. The reference-product table (§2.6) with *explicit anti-patterns per reference* is a practice most studios should copy. The contradiction register (§16.2) shows real editorial control over the PRD.

**Weaknesses.**

1. **No business thesis.** The spec commits to 99.9% availability, 24/7 security intake, professional localization, cultural review, counsel review in three markets, and a live-ops calendar — with zero revenue, and monetization gated behind an entirely separate future approval (§13.1). That is a legitimate scoping decision, but the vision section never states *why the product exists commercially* (portfolio play? acquisition funnel for a future monetized version? platform showcase?). Without this, every later monetization decision will fight the "no purchase pressure" identity the spec builds. State the intended business model hypothesis now, even if unfunded.
2. **The core fantasy is under-articulated.** "Contemporary Taiwanese tea-house" (§3.4) is a strong aesthetic anchor, but the emotional fantasy — the social table, family play, the ritual of the game — is not connected to features. The features that would deliver it (friends, private rooms, table talk) are absent in Beta and thin in V1.
3. **Differentiation is real but quiet.** English-accessible, rules-accurate Taiwanese 16-tile with no gacha is a genuine gap (GameTower is dated and casino-framed; Mahjong Soul is Riichi and gacha-driven). But "we don't do bad things" is hard to market. The learnability pipeline (tutorial → Rulebook → practice) is the marketable differentiator; a puzzle/trainer mode (see §16 below) would sharpen it.

**Scores: Vision 9 / Market positioning 7 / Differentiation 7.**

## 2. Core Gameplay

**Loops.** Session loop (queue → one hand → result → Play Again) is tight and honest about Mahjong's structure. Quick Play as exactly one hand (§8.3) is a smart mobile-session decision; 8–15 minutes is realistic for 16-tile. Turn flow, claim flow, and timers (§5.10) are precisely specified with a single shared server deadline — correct and fair.

**Problems.**

1. **The progression gap between modes is the biggest gameplay-structure risk in the spec.** Quick Play — the short, mobile-friendly, high-volume mode — has *no* rating, ladder, or placement. Full Rotation — the only ranked mode — takes 30–45 minutes (with a 60-minute cap). The mode players can actually fit into their day has no competitive hook beyond Jade (which inflates, see Economy), and the mode with the competitive hook demands a session length that will throttle its population on mobile web. Expect: low ranked liquidity → the 80-second band expansion to "unrestricted" firing constantly → poor match quality → weaker ranked retention. Consider either (a) a lightweight per-season Quick Play ladder (e.g., win-based points, not Elo), or (b) a shorter ranked format (best-of-N-hands) as a fast follow.
2. **Dealer variance in a one-hand mode.** Quick Play assigns dealer uniformly at random, and Dealer Tai applies to a single settled hand. Over one hand, being dealer is a pure variance injection with no chance to rotate out. Acceptable for a casual mode, but it should be an explicit, telemetry-monitored decision (compare dealer vs non-dealer net Jade per hand in Beta).
3. **Downtime is well controlled** (interruptible animations, animation time not charged against the timer, no hidden masks). No concerns.
4. **Skill vs randomness** is honestly handled: Ting panel, visible-remaining counts, and no hidden-information assists preserve skill expression without creating an assist arms race. The assist matrix (§9.4) with identical assists across public modes is the right call for fairness.

## 3. Mahjong Rules Review

This is the strongest part of the document: fixed house standard, golden-case suite, million-hand simulation gate, versioned rules pinning per match, deterministic highest-Tai decomposition with lexicographic tie-break. I verified the worked examples: the cap allocation example (171/129 via largest remainder), the Elo examples (+12/+4/−4/−12 and the provisional variant), the 69-Tai maximum construction, and the Eight Flowers 15-Tai composition are all arithmetically correct.

**Genuine unresolved edge cases and defects:**

1. **[Correctness — Critical] Timeout-Pass vs the discard-Win lock (§5.8 vs §5.10).** §5.8 locks a player who "deliberately passes a legal discard Win" until their next draw-and-discard cycle. §5.10 says a claim timeout makes the server "select Pass." Is a timeout Pass "deliberate"? As written, a lagging or briefly disconnected player can be locked out of a legal Win by a timeout they never saw — and this interacts with reconnect (§8.7), where the takeover bot only arrives after *three* timeouts. Specify explicitly: recommend that a server-selected Pass does **not** trigger the lock (it punishes connectivity, not strategy), and add it as a golden case.
2. **[Correctness — High] Eight Flowers and Heavenly Hand have no declaration mechanics.** §5.9 defines both, and §5.10 says "the server never auto-declares Win." So: is Eight Flowers offered as a claimable action when the 8th bonus tile is exposed? During *initial* replacement (which is server-automated, with no player decision point)? If the player passes or times out, is the instant win forfeited permanently, claimable later, or does the lock apply? Same question for Heavenly Hand, where East's hand is complete before any action exists to take. Define the offer/decline/timeout behavior for both and add golden cases.
3. **[Correctness — High] "Last drawable tile" vs back-of-wall draws (§5.9, §6.1).** Last Tile Zimo is defined as "Zimo on the final drawable tile before the 16-tile reserve" — a front draw. But a Kong/Flower replacement (back draw) can also be the draw that brings the wall to exactly 16. Does that back draw count as the "final drawable tile" (stacking Last Tile Zimo + Win After Replacement), or is Last Tile Zimo front-only? The boundary rule in §5.2 ("if a mandatory replacement would be required at that boundary, the hand ends as an exhaustive draw") covers the *next* replacement, not this one. Specify and add fixtures.
4. **[Spec-text inconsistency — Medium] All Chows exclusion rationale (§6.2).** The rule says All Chows "cannot stack with … No Honors or Flowers … because its own definition excludes those states." That's backwards: an All Chows hand *automatically satisfies* No Honors or Flowers (five chows, non-honor pair, no flowers). The non-stacking decision is fine as an anti-double-count rule, but the stated rationale is wrong and will confuse the Rules Lead's zh-TW rulebook translation. Fix the wording; keep the rule.
5. **[Design choice worth revisiting — Medium] Dealer among multiple winners rotates (§5.11).** "East and any non-East player both win the same discard → rotate, reset k." Most Taiwanese tables continue the dealer if the dealer wins at all. This is a legal house choice, but it will surprise the experienced-Taiwanese secondary audience; at minimum it deserves a Rulebook callout and Rules Lead sign-off with the zh-TW expert.
6. **[Minor] The Pong/Kong turn-order-proximity tie-break (§5.6, §5.8) is vacuous.** Two simultaneous Pong claims on the same discard are impossible (would require 5 copies of a tile); Pong-vs-Kong likewise. Harmless as defensive spec, but mark it as such so QA doesn't burn time trying to construct the case.
7. **[Minor] "Dealer-impossible roles" wording (§7.3).** "It applies once, even when both are dealer-impossible roles" is not parseable English. Presumably it means Dealer Tai never applies twice even in edge configurations — since winner and payer cannot both be the dealer, say that plainly.
8. **[Minor] Kong scored/unscored at the exhaustion boundary.** When a Kong is declared but its replacement would cross the 16-tile boundary (hand ends as exhaustive draw per §5.2), is the Kong's Tai moot (no winner, so yes) and is the meld still recorded for statistics/achievements ("declare a legal Kong" XP)? Specify for the XP/achievement pipeline.

**Otherwise:** wall construction, dice/break math (`((s−1) mod 4)+1` matches traditional counting), deal counts (65 dealt, 79 wall, 63 drawable), flower mandatory replacement, claim privacy, robbed-Kong liability, exhaustive-draw dealer-Ting rule, and the additive Dealer Tai (1+2k, k≤10) are all correct and internally consistent. The absence of pao/liability rules and Seven Flowers Rob One is a declared house decision, appropriately flagged as a divergence experienced players will notice.

## 4. Onboarding

The tutorial (§8.1) is the best-specified onboarding I've seen in a pre-production document: per-step fixtures with exact tiles, wall contents, recovery behavior, string IDs, snapshot-restore on error, skip-with-full-reward (no punishment for experts), server-saved progress, and localization authority rules. The 75% completion / 90% first-hand gates (§2.5) are appropriately aggressive.

**Friction points:**

1. **No bridge between tutorial and first human match.** After Chapter 3, the player faces: AI Practice (untimed) → public Bamboo (15s/7s timers, real opponents). The first *timed claim decision of their life* happens in a live human match. Recommend an explicitly framed "first human match" onboarding step, or default the first N Bamboo matches to surfacing the optional AI-practice timer beforehand. The 90% first-hand completion gate will find this in Beta; better to design for it now.
2. **7-second claim windows are the hardest beginner moment** and are uniform across all Quick Play lobbies. Consider Bamboo-only 10s claim windows (lobby timer config is already remotely configurable per §13.4 — use it).
3. **Tutorial requires connectivity** (§3.1). Defensible (single rules engine), but it means the "learn on the subway" use case is lost. Accept, but note in marketing/store copy.
4. **No standalone practice puzzles.** See Missing Systems.

## 5. Progression

**What works:** XP is participation-based and never gates lobbies or matchmaking (§12.1) — clean separation. Level curve to 50 is ~142,000 XP (~900–1,000 public hands; roughly 150–250 hours), a reasonable launch horizon. Retroactive level recompute on curve change without revocation (§12.2) is the right contract.

**What's thin:**

1. **Endgame is shallow.** 12 achievements total, most one-shot; rewards every 5 levels are mostly titles. An engaged player exhausts the visible goal structure in 6–10 weeks, leaving only seasonal rating — which lives in the long-session mode (see Core Gameplay). This is the biggest month-2/month-3 retention hole.
2. **Achievement design skews to grind counters** (50 claims, 100 Ting hands) plus four rare-hand trophies. Missing: skill-flavored intermediate achievements (win with ≥5 raw Tai, win a hand with a robbed Kong, survive a Full Rotation with positive points from every seat), which are cheap and event-log derivable — the infrastructure (§12.3, event-log derived counters) already supports them.
3. **The cosmetic catalog (§13.2) is 3 tile faces, 3 tables, 8 frames, 12 titles.** Fine for launch, but the seasonal cadence adds only "one free seasonal frame or table accent" per 12 weeks. That is a very slow drip for the only personalization system in the game. Doubling seasonal cosmetic output is low-cost and high-value given cosmetics are the sole reward surface.

## 6. Retention

The spec is deliberately anti-manipulative: no login streaks, no FOMO, no expiring currency, quiet-hours defaults. I respect it, and it fits the product identity. But be honest about the cost: the D30 directional target of 5% is *already modest*, and the systems present (3 daily missions, 3 weekly missions, one season track) are below genre norms even for ethically designed games.

**Missing, in order of value:**

1. **Friend-driven retention in Beta.** Beta has *no* friends, no private rooms, guest-only accounts (§2.3, §10.2). The stated secondary audience — diaspora/family groups — retains through playing with known people. Beta will therefore measure retention *without the product's strongest natural hook*, and the Beta exit gates (§2.5) will be judged against handicapped numbers. Either pull friends/private rooms into Beta, or explicitly annotate the retention gates as measured-without-social.
2. **Guest-only Beta is an account-loss trap.** Clearing browser storage loses the credential (§10.1). Over a six-week Beta on mobile Safari (which evicts storage of un-visited sites aggressively), some fraction of your 500 invited players will silently lose their accounts and appear as churn. At minimum, support invite-code-based recovery during Beta, or pull email magic-link forward into Beta.
3. **A weekly "table streak" or comeback mechanic** (non-expiring, non-punitive — e.g., cumulative weekly play milestones rather than consecutive-day streaks) would add a return trigger without violating the no-manipulation principle.
4. **Seasonal events are one theme treatment per 12 weeks** (§13.5). Lunar New Year and Mid-Autumn are enormous cultural moments for this exact audience; they deserve missions + cosmetic + themed table minimum, and the content-lock pipeline already supports it.

## 7. Social Features

The safety architecture is excellent: no free text anywhere, curated names, exact-ID friend search, preset emotes with rate limits and muting, block-aware matchmaking, minors default-invisible (§10.5–10.8). This eliminates ~90% of moderation cost and risk. The trade is a game about a *social table ritual* with almost no sociality: 8 emotes, no table talk, no spectating, no sharing, no replays, no clubs.

**Recommendations:** (1) Expand the emote set with a curated *phrase* palette (20–30 localized, positive/neutral table phrases — "That was close," "Lucky draw!") — same safety envelope, much more table feel. (2) Post-match "share result card" (image export of the tally sheet, no link into the game) is a zero-moderation-cost viral surface the spec currently forbids by omission. (3) Private-room *spectator seats for friends only* would serve the family-teaching use case at a fraction of full spectator-mode cost; currently excluded (§8.6) — reasonable for V1, should be the first post-launch social feature.

## 8. Competitive Design

**Sound:** pairwise zero-sum Elo with integer largest-remainder allocation (§12.4) is correct and transparent; worked examples check out. Abandonment handling (separate labeled disciplinary adjustment, not distributed to opponents, floor-respecting) is well designed. Season reset formula (75% regression to 1500) and tier bands are standard and fine.

**Problems:**

1. **[Critical] Nothing stops Guests from playing ranked.** §10.1 limits V1 guests from friends/private rooms/cross-device — but not from ranked Full Rotation. Free, unlimited, disposable guest accounts + ranked = trivial smurfing, abandonment-penalty dodging (cooldowns are per-account, §8.7), and leaderboard pollution. The anti-smurf contract (§12.5) leans on multi-account *signals*, which is the weak version. **Require a linked identity for ranked Full Rotation.** One line in the spec; large integrity payoff.
2. **20 rated matches for leaderboard eligibility ≈ 10–13 hours of play** before a player exists competitively. Combined with the session-length problem, expect a small leaderboard population in season 1. Consider 10 matches for eligibility with the Provisional label retained.
3. **The 60-minute cap can end a rotation before every player deals** (§8.4). Dealer hands carry different point exposure, so a capped match is structurally asymmetric. Timers make clock-milking hard, but add a telemetry counter for capped matches and a fairness review trigger if >5% of ranked matches hit the cap.
4. **No same-region requirement collapse for ranked bands** — after 80 seconds the band is unrestricted *within region*; fine. But with NA + Taiwan populations split by time zone, publish expected ranked queue times per region from Beta data before committing to V1 ranked SLAs.

## 9. Economy

**What's right:** closed-loop, double-entry, idempotent, zero-net-issuance settlement with reserves and caps (§7) is auditable and safe. The cap-allocation math is correct. "Access/recovery loop, not a store of value" (§7.5) is stated honestly. No dead currencies; no purchasable currency; no inflation *risk* in the sense of broken sinks — inflation is *designed in*.

**Problems:**

1. **[High] Two of four lobbies are dead content at launch.** Faucet is ~750 Jade/day (missions) and settlement is zero-sum. From the 5,000 start: Sparrow Pavilion (10k) in ~1 week — good. Wind and Cloud (100k) in ~4+ months of daily play. Dragon's Den (1,000,000) in ~3.6 *years* of faucet income for a median player; even a strong winner in Sparrow (net a few hundred Jade/hand) needs months. With 10k DAU at V1, Dragon's Den will hold a handful of players; queues there will never pop (and the spec forbids bot fill). Either ship two tiers at V1 and gate the upper two behind live config (§13.4 already supports it), or rescale the gates (e.g., 1k / 10k / 50k / 250k) and lower stakes accordingly.
2. **[Medium] Stakes are toothless at Bamboo.** Max loss is 300/hand; the daily faucet is 750. A player who loses every hand still nets positive Jade on 3 hands/day. That's intentional (no lockout), but it means the "lobby stakes" tension the tier system implies doesn't exist at the tier where everyone plays. Accept it consciously, and make the *ratio* of faucet-to-cap a tracked design parameter per tier.
3. **[Medium] Faucet-only inflation concentrates.** Zero-sum tables + universal faucet = winners' balances grow without bound; there is no sink at all (cosmetics are XP-gated by design). Fine for year one; but flag now that the *first* future Jade sink (e.g., cosmetic variants, private-room table themes) should be specced before median veteran balances make tier gates meaningless. The spec's "measure inflation by source, median, percentile" (§7.5) is good; add an explicit review trigger (e.g., when p50 balance > Wind and Cloud gate).
4. **[Low] Chip-dumping/collusion incentive is inherently low** (Jade has no value, leaderboards don't use it), and §10.8's signals plus no-party-queue rule are proportionate. The highest-value abuse is *self-collusion*: one person on four free guest browsers in a high-stakes lobby funneling Jade to a main. Low harm, but it pollutes the ledger-health metrics — another argument for identity requirements above Bamboo.

## 10. Monetization

There is nothing to review — deliberately (§13.1). Three notes: (1) The prohibition on "dormant payment or ad code" is correct and avoids platform-policy ambiguity. (2) The Jade legal framing (revocable license, no monetary value, no cash-out) is exactly right for the simulated-stakes review in §15.11. (3) The unpriced risk: when monetization *is* eventually specced, the product identity ("no purchase pressure, no paid advantage, no expiring anything") leaves approximately one viable model — direct cosmetic sales and/or a cosmetic-only season pass — and the current cosmetic pipeline (one item per 12 weeks) is an order of magnitude below what that model needs. If monetization is plausibly on the roadmap, start building cosmetic production capacity now; it's the long-lead item.

## 11. UX Review

The spec describes behavior thoroughly (no wireframes exist — see Production Readiness). Strong points: fixed camera with local-player-at-bottom remapping, chronological discard grids with claim placeholders, cancel-until-acknowledged discards, claim privacy until resolution, results ordered as an explanation narrative (§9.7), "Why this scored" exclusions view, error states enumerated with codes and retries (§9.8).

**Friction:**

1. **Forced landscape below 768px (§3.2)** kills the dominant one-handed portrait posture for casual mobile play. With 17 tiles it's defensible, but treat it as a hypothesis: prototype a portrait layout (two-row hand or scaled tiles) before locking, because the orientation prompt will be many mobile users' first in-match experience — and iOS Safari cannot programmatically lock orientation, so the "prompt" will be a recurring nag for some users.
2. **The 15s/7s uniform timers** — see Onboarding; make them per-lobby config.
3. **"Play Again" re-queues without preserving opponents (§8.3)** — correct for matchmaking integrity, but pair it with a post-match Add Friend affordance in the result screen flow (Recent Players exists per §10.6; surface it at the moment of "that was a good table").
4. **Reconnect UX on mobile web:** 60 seconds of seat retention (§8.7) is short against real mobile interruptions (phone call, app switch + Safari tab eviction). The three-timeout takeover bot mitigates match damage, but consider 90–120s retention for Quick Play, where no rating is at stake.
5. **Missing screens:** the spec enumerates states but not layouts. Queue-confirmation (with rules version, stake, cap — all required visible), the claim-decision moment (the single most important screen in the game), and the tally sheet deserve wireframes before engineering starts on the client.

## 12. Accessibility

Genuinely strong: WCAG 2.2 AA target with game-specific exception documentation, no color-alone semantics, high-contrast skin at Level 1, reduced motion, screen-reader announcements for game events, captioned declarations, independent audio buses, haptics optional (§9.9, §9.11). The 32×44px compact tile concession is thoughtfully argued.

**Gaps:** (1) **Left-handed play** is not addressed — the action row / confirm button placement should be mirrorable. (2) **Timer accommodation** for motor-impaired players is acknowledged as impossible in shared-deadline ranked play, with AI Practice as the alternative — defensible, but an *unranked untimed human queue* is the actual missing option; note it as future scope explicitly rather than silently. (3) Localization pipeline (§15.12) is solid; ensure the zh-TW screen-reader experience is separately QA'd — accessible names in Chinese for tiles are a distinct workstream from visual localization.

## 13. LiveOps Readiness

Excellent governance: two-person approval for economy/rules changes, before/after values, staging validation, one-action rollback, audit logs (§13.4); a hard boundary on what live config can never touch (rules, hidden information, retention, age gate). Feature flags exist for shipped capabilities. Content pipeline has real lead times (15 business days lock, 10 for localization/cultural review) — realistic, not aspirational.

**Gaps:** (1) A/B testing is limited to onboarding copy and non-economic presentation (§15.1) — correct for fairness, but timer values and queue-offer thresholds (the 90-second AI-offer) are exactly the parameters you'll want to tune, and they're ambiguous between "rules" (frozen) and "presentation" (testable). Classify them explicitly. (2) The seasonal cadence is sustainable but minimal — see Retention. (3) No kill-switch semantics are specified for a *mid-match* discovered rules defect (matches are pinned to rules versions — good — but can LiveOps drain and block *new* matches on a defective version? §13.4's "minimum supported rules version for new matches" implies yes; make it an explicit runbook item).

## 14. Technical Review

The architecture contract is exemplary for a spec at this stage: full server authority with intent-only clients (§15.8), commit-before-deal shuffle with audit packages (§15.9), deterministic replay from event logs + snapshots ≤30s (§15.7), RPO 0 on the ledger, idempotency keys on every mutation, claim privacy enforced at the protocol level, per-decision absolute deadlines with RTT compensation capped at 500ms (§5.10). AFK/takeover/abandonment flows are complete. Bot information boundaries (§11.2) and deterministic AI replay with seeds are specified to a level most shipped games never reach.

**Risks:**

1. **[High] Mobile Safari is the hardest platform in the matrix and the spec's quietest.** PWA on iOS: background tab suspension kills WebSockets within seconds, storage eviction threatens guest credentials, web push requires the PWA to be installed, and orientation can't be locked. The reconnect targets (interactive in p95 3s) are achievable, but the *frequency* of reconnects on iOS will dominate the experience. Budget a dedicated iOS-web hardening milestone; treat "foreground resume within 5s p95" (§15.6) as the critical KPI it is.
2. **[Medium] The 250ms decision budget for Hard AI (§11.4)** with a public-state safety *prover* (§11.3's "no assignment of unseen tiles" proof) is real algorithmic work — the proof is a constraint-satisfaction check per candidate discard. Feasible, but prototype early; the fallback chain (Medium policy → canonical discard) is well designed.
3. **[Medium] Cross-region architecture is under-specified.** Traffic splits between western NA and Taiwan (§15.4); matchmaking prefers same-region (<150ms) but private rooms with cross-Pacific friends are a first-class use case for this audience. 150–200ms RTT is fine for turn-based play, but the *shared claim deadline* + 500ms RTT-compensation cap means a Taiwan player in a US-hosted room consistently gets ~200–300ms less effective decision time than the cap assumes. Either raise the cap for private rooms or host room instances at the median of participants.
4. **[Low] The million-simulation gate per release candidate** needs CI budget and a triage protocol for nondeterministic failures — plan it as infrastructure, not a test someone runs.
5. **Offline mode / cloud saves / cross-progression:** correctly resolved (always-online, server-side state, account-based). No gaps given the scoping.

## 15. Analytics

The event model (§15.2) covers every lifecycle the game has, including reason codes and opaque tile IDs in general analytics — privacy separation (§15.3) between operational match logs and product analytics is better than industry standard. Funnels are named.

**Add:** (1) explicit KPI targets for queue-abandonment rate and the 90-second queue-offer take-rate; (2) claim-window timeout rate segmented by account age (this is your onboarding-difficulty signal); (3) dealer vs non-dealer net-Jade delta in Quick Play (see Core Gameplay #2); (4) capped-match rate in Full Rotation; (5) per-tier faucet-to-cap ratio and balance percentiles (economy health, §7.5 mentions measurement — pin the actual dashboards as acceptance items); (6) tutorial *step-level* drop-off is implied by step events — name it as a funnel. D1/D7/D30, session length, and match-duration targets already exist in §2.5.

## 16. Missing Systems

Most classically "missing" systems are *explicit non-goals* (§2.4) — the spec deserves credit for deciding rather than omitting. Assessing the deferrals:

| System | Status | Assessment |
| --- | --- | --- |
| Puzzle / trainer mode ("what do you discard?") | Absent, unmentioned | **The one genuinely missed opportunity.** Daily discard puzzles from real (anonymized) match states are cheap (rules engine + fixtures already exist per §8.1), teach the hardest skill (efficiency/defense), fit 2-minute sessions, and are a shareable differentiator. Recommend for V1 or fast-follow. |
| Spectator / replay | Deferred | Acceptable; internal replay exists (§8.8). Friend-spectate in private rooms is the cheap first step. |
| Clubs / tournaments | Deferred | Correct for scope; tournaments carry legal weight (§13.5) — right to defer. |
| Player reporting / moderation / anti-cheat | **Present and strong** | §10.8, §15.8 — no gap. |
| Notifications / mail | **Present** | §10.9 — no gap. |
| Practice mode / AI training | Present | §8.2, §11 — no gap. |
| Reconnect-from-second-device mid-match | Ambiguous | Linked accounts can sign in elsewhere — can they resume an active match from a new device? §8.7 implies session re-auth suffices; state it explicitly. |
| Left-handed layout | Absent | See Accessibility. |
| Unranked untimed human queue (accessibility) | Absent | Note as explicit future scope. |

## 17. Production Readiness

**Ready for engineering planning: yes.** Requirement IDs resolve to a questionnaire matrix with zero open items (§16.3); acceptance evidence is enumerated (§16.1); "must" statements are largely testable; the golden-suite + traceability requirement is exactly what QA needs.

**Not yet ready for UI implementation:** the spec defines behavior and constraints but no layouts. Wireframes for (at minimum) the match table at 360×640 landscape, the claim decision moment, the tally sheet, queue confirmation, and the tutorial chrome are the next deliverable, and §9.2's simultaneous-visibility requirements ("tile identity, claim source, most recent discard, active player, dealer, seat wind, continuation count, countdown, and all legal actions … at every supported match viewport") should be validated against a real 360px-wide layout *before* it's accepted as a requirement — it may not fit.

**Ambiguities to close before development** (beyond the rules edge cases in §3 above): guest access to ranked; timeout-Pass lock semantics; second-device resume; "presentation vs rules" classification of tunable timers; portrait feasibility decision.

## 18. Risk Assessment

| # | Risk | Type | Severity | Probability | Business impact | Mitigation |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | No revenue model funding a high-SLA live service | Product | High | Certain | Product survives only as a funded bet; ops costs are committed in-spec | State the business hypothesis; pre-plan the cosmetic-monetization spec; scale SLAs to funding |
| R2 | Ranked mode session length + 20-match gate throttles competitive population | Product | High | High | Weak ranked ecosystem → weak long-term retention | Quick Play ladder or short ranked format; lower leaderboard eligibility to 10 |
| R3 | iOS Safari PWA lifecycle (sockets, storage eviction, orientation, push) | Technical | High | High | Degraded experience for a large user share; guest account loss | Dedicated iOS hardening milestone; move magic-link into Beta; longer Quick Play seat retention |
| R4 | Beta measures retention without social features on guest-only accounts | Product/Beta | High | Certain | Beta exit gates judged on handicapped data; false-negative kill decision | Pull friends/private rooms or at least email link-in into Beta; annotate gates |
| R5 | Guest smurfing in ranked | Competitive | Medium | High | Leaderboard integrity, abandonment-penalty dodging | Require linked identity for ranked (one-line fix) |
| R6 | Upper two Jade lobbies are unreachable dead content for ≥1 year | Economy | Medium | Certain | Tier system reads as fake depth; empty queues | Ship 2 tiers, gate rest behind live config; or rescale gates |
| R7 | Timeout/lock/declaration rule ambiguities ship as defects | Rules | High (S1-class per §2.5) | Medium | Blocks Beta exit gate (14-day zero-S1 requirement) | Resolve edge cases §3.1–3.3 now; add golden cases |
| R8 | Month 2–3 content cliff (achievements + level track exhausted) | Retention | Medium | High | D30/D60 decay among the most engaged | Expand achievements (cheap), double seasonal cosmetics, add puzzle mode |
| R9 | Queue liquidity fragmentation (4 tiers × 2 modes × regions, no bots) | Product | Medium | Medium | Long queues off-peak → churn spiral | Fewer launch tiers; queue consolidation offers already specced (§8.5) — tune aggressively |
| R10 | 360px landscape layout cannot satisfy §9.2 visibility requirements | UX | Medium | Medium | Late-stage redesign of the core screen | Wireframe + device test before requirement acceptance |
| R11 | Hard-AI safety prover misses 250ms budget | Technical | Low | Medium | Degraded Hard AI (falls back to Medium) | Early prototype; budget algorithmic spike |
| R12 | Cultural/localization misfire in Taiwanese terminology | Market | Medium | Low | Credibility loss with core audience | Already mitigated (§15.12 expert review); protect that budget |

## 19. Prioritized Recommendations

### Critical (must fix before development)

1. **Resolve the timeout-Pass / discard-Win-lock ambiguity (§5.8 vs §5.10).**
   *Why:* It's an S1-class rules defect waiting to happen and interacts with reconnect. *Solution:* Server-selected Pass does not trigger the lock. *Player impact:* Prevents unfair lockouts of lagging players. *Complexity: Low.*
2. **Specify declaration mechanics for Eight Flowers and Heavenly Hand.**
   *Why:* "Server never auto-declares Win" leaves both wins undefined at the moment they occur. *Solution:* Define offer, timeout, and forfeiture behavior; add golden cases. *Complexity: Low.*
3. **Define "last drawable tile" vs back-of-wall replacement draws.**
   *Why:* Scoring correctness at the wall boundary; affects Last Tile Zimo and Win After Replacement stacking. *Complexity: Low.*
4. **Require a linked identity for ranked Full Rotation.**
   *Why:* Free disposable guests break smurf mitigation and abandonment penalties. *Solution:* One eligibility line in §12.5/§10.1. *Player impact:* Leaderboard integrity. *Complexity: Low.*
5. **Wireframe and device-validate the 360px landscape match screen against §9.2's simultaneous-visibility requirement.**
   *Why:* If it doesn't fit, a core requirement changes — cheaper now than mid-build. *Complexity: Medium.*

### High priority

6. **Reduce launch lobby tiers to two (Bamboo + Sparrow) with the rest behind live config, or rescale gates.**
   *Why:* Dead queues and fake depth; ~3.6-year median path to Dragon's Den. *Impact:* Every queue pops; tier progression feels real. *Complexity: Low (config already supports it).*
7. **Add a competitive/progression hook to Quick Play** (seasonal ladder points or placement-free weekly leaderboard).
   *Why:* The high-volume mode has no long-term hook; the ranked mode is too long for its audience. *Impact:* Core-loop retention. *Complexity: Medium.*
8. **Pull email magic-link (and ideally friends/private rooms) into Closed Beta.**
   *Why:* Guest-only Beta loses accounts to storage eviction and measures retention without social; the Beta exit gates depend on this data. *Complexity: Medium.*
9. **Per-lobby timer configuration with longer Bamboo claim windows (10s).**
   *Why:* 7-second claim decisions are the single hardest beginner moment. *Impact:* First-session survival, tutorial→live conversion. *Complexity: Low.*
10. **Plan a dedicated iOS Safari/PWA hardening milestone** (socket lifecycle, resume, storage persistence via `navigator.storage.persist()`, installed-PWA push education).
    *Why:* Largest platform risk in the matrix. *Complexity: High.*
11. **Fix spec-text defects:** All Chows exclusion rationale (§6.2), "dealer-impossible roles" wording (§7.3), Kong-at-boundary stat/XP handling, dealer-among-multiple-winners Rulebook callout.
    *Complexity: Low.*

### Medium priority

12. **Expand launch achievements to ~30** using existing event-log infrastructure (skill-flavored triggers, not just grind counters). *Complexity: Low.*
13. **Curated phrase palette (20–30 localized table phrases)** on the emote system. *Impact:* Table sociality at zero moderation cost. *Complexity: Low.*
14. **Shareable post-match result card** (image export of tally sheet). *Impact:* Organic acquisition surface. *Complexity: Low.*
15. **Post-match Add Friend affordance on the result screen** (Recent Players already exists). *Complexity: Low.*
16. **Extend Quick Play disconnect seat retention to 90–120s.** *Why:* Real mobile interruptions exceed 60s; no rating at stake. *Complexity: Low.*
17. **Beefed-up seasonal moments for Lunar New Year and Mid-Autumn** (missions + cosmetics + themed table, within the existing content-lock pipeline). *Complexity: Medium.*
18. **Analytics additions:** claim-timeout by account age, dealer net-Jade delta, capped-match rate, per-tier balance percentile dashboards as acceptance items. *Complexity: Low.*
19. **Left-handed (mirrored action row) layout option.** *Complexity: Low–Medium.*
20. **Explicitly classify tunable timers and queue-offer thresholds as live-configurable presentation, not frozen rules.** *Complexity: Low.*

### Future enhancements

21. **Daily discard-puzzle mode** built on the tutorial fixture system — the strongest differentiation opportunity in this review; consider promoting to V1 if capacity allows. *Complexity: Medium.*
22. **Friend-only spectating in private rooms** — serves the family-teaching audience before full spectator mode. *Complexity: Medium.*
23. **Unranked untimed human queue** as the accessibility answer to shared deadlines. *Complexity: Medium.*
24. **First Jade sink design** (cosmetic variants or private-room themes), triggered when p50 balances approach upper-tier gates. *Complexity: Medium.*
25. **Cosmetic production pipeline scale-up** as the long-lead prerequisite for any future ethical monetization. *Complexity: High (content, not code).*
26. **Player-facing replay of own matches** (internal event replay already exists — this is mostly a viewer). *Complexity: High.*

---

*Methodology note: all arithmetic claims in the spec's worked examples (§7.4 cap allocation, §12.4 Elo deltas, §6.2 maximum-Tai construction, Eight Flowers composition, wall/deal counts, dice-break formula) were independently verified during this review and are correct.*
