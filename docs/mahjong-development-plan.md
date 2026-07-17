# Mahjong — Development Plan

- Source of truth: [`mahjong-product-specification.md`](mahjong-product-specification.md) **v1.1** (2026-07-17). Section references (§) below point at that document.
- Plan status: Draft for Product Owner / Engineering Lead approval
- Plan date: 2026-07-17
- Rule: this plan implements the approved design. It introduces no product changes. Where the spec is silent (technology, staffing, sequencing), decisions here are labeled **[ASSUMPTION]** and need sign-off, not silent acceptance.

---

## Step 1 — Product understanding and assumptions

### 1.1 Summary of what we are building

- **Core gameplay:** server-authoritative Taiwanese 16-tile Mahjong (rules standard v1.1, §5–6). Four human or bot players; one-hand Quick Play (8–15 min) and one-East-round Full Rotation (30–45 min, 60-min cap). No house-rule toggles.
- **Major systems:** deterministic rules engine with golden-case certification (§1.3); Jade closed-loop double-entry economy with reserves and caps (§7); tiered lobbies (Bamboo/Sparrow open at V1, upper tiers implemented-but-closed, §7.1); matchmaking queues (§8.5); scripted 3-chapter tutorial with versioned fixtures (§8.1); AI bots Easy/Medium/Hard plus disconnect takeover (§11); XP/levels/32 achievements/missions (§12.1–12.3, §13.3); pairwise Elo rating + leaderboards + Quick Play ladder (§12.4–12.9, V1); friends/private rooms (Beta: Quick Play only, §8.6); mail/notifications/live config (§10.9, §13.4); reports/sanctions/support tooling (§10.8, §15.13); first-party analytics (§15.2–15.3).
- **Technical architecture (required properties):** clients render authorized state and submit intent only (§15.8); committed CSPRNG shuffle before deal (§15.9); durable append-before-ack event log, deterministic replay, ≤30 s snapshots (§15.7); RPO 0 ledger; idempotent commands; hidden-information isolation at protocol level; per-decision shared absolute deadlines with RTT compensation (§5.10).
- **Platforms:** responsive web / installable PWA only. Desktop Chrome/Safari/Edge/Firefox (current+prev), iOS Safari 17+, Android Chrome 12+. 360×640 minimum viewport; landscape-locked match under 768 px (§3.1–3.2). Always online — Tutorial and AI Practice also run against the server (§3.1).
- **Multiplayer:** 4-seat realtime matches; queue targets p50 ≤ 30 s; state update p95 ≤ 250 ms in-region; reconnect p95 ≤ 3 s; seat retention 90 s Quick/private, 60 s ranked; AFK→takeover bot after 3 timeouts (§8.7, §15.5).
- **LiveOps:** audited two-person-approved remote config for lobbies, timers-within-bounds, missions, seasons, banners, flags (§13.4); 12-week seasons; Lunar New Year + Mid-Autumn anchor events (§13.5); content lock 15 business days ahead.
- **Monetization:** none. No store, payments, ads, or dormant payment code (§13.1). §2.8 records the cosmetic-only future hypothesis; nothing in this plan builds toward it except cosmetic content pipeline health.
- **External integrations (all thin):** Google/Apple OAuth (V1); transactional email provider for magic link; Web Push (VAPID); optional hosted crash/analytics processor **only after** privacy review (§15.3) — the plan treats it as absent.
- **Release milestones:** Closed Beta (six weeks, ≥500 invitees, US/Canada-ex-Quebec/Taiwan, en + zh-TW, §15.1) with hard exit gates (§2.5); then Version 1.

### 1.2 Assumptions requiring sign-off

| # | Assumption | Why | Escalate if wrong |
| --- | --- | --- | --- |
| A1 | **[ASSUMPTION] Stack:** TypeScript monorepo. Client: React + DOM/CSS-first table rendering (WebGL2 effects as an optional layer). Server: Node.js (NestJS or Fastify) modular monolith + separate stateful realtime match service; Postgres; Redis; WebSocket transport. | Shared protocol types end-to-end; DOM-first table makes WCAG 2.2 AA (§9.9) and the mandated Canvas/CSS fallback (§3.2) one codepath instead of two. | If sim throughput (E1.F10, 1M hands/RC) or Hard-AI 250 ms budget (§11.4) misses target in Node, port the rules/AI core to Go/Rust behind the same fixture format — isolate it from day 1 to keep this cheap. |
| A2 | **[ASSUMPTION] Team:** 6 engineers (2 gameplay/backend, 2 client, 1 platform/DevOps, 1 QA-automation) + part-time PM/UX/loc/Rules Lead. 2-week sprints. | Needed to make the sprint plan concrete. | Re-scale sprint plan linearly; dependency order (Step 4) is capacity-independent and does not change. |
| A3 | **[ASSUMPTION] Hosting:** one US cloud region at launch (§2.7 US data stores) on managed services (managed Postgres, managed Redis, container platform). Taiwan latency served over backbone; §15.5 measures in-region so this is compliant, but Taiwan RTT must be measured in Phase 0. | Single-region halves ops scope; §15.7 region-failure routing is written as conditional. | If Taiwan p95 misses §15.5 targets in Phase 0 probes, add an APAC match-service region in Phase 5 (tech-debt item TD-3). |
| A4 | **[ASSUMPTION] Buy-vs-build:** identity (magic link/OAuth), email delivery, and web push use off-the-shelf providers behind our own account model; everything gameplay/economy/matchmaking/analytics is built first-party. A game-backend platform (e.g., AccelByte-class BaaS) was considered and rejected for core loops because the Jade ledger, deterministic rules engine, and claim-privacy protocol are bespoke anyway. | §15.3 forbids third-party analytics SDKs without review; core requirements are custom. | Product Owner may still choose BaaS for friends/leaderboards; the service boundaries in Step 8 keep that swappable. |
| A5 | Art/audio (tile faces, 3 table themes, frames, music, SFX) are commissioned externally with license documentation (§2.7, §3.4) and delivered by end of Phase 3. | Engineering consumes final assets in Phase 4–5; placeholder art until then. | Beta ship blocker if late — flagged as schedule risk R-S2. |
| A6 | Trademark-cleared product name arrives before public V1; Beta ships the text title card "Mahjong" (§3.4). | Spec allows it. | None for Beta. |
| A7 | Legal/counsel review (§15.11), zh-TW localizer + Taiwanese Rules Lead (§1.1, §15.12) are engaged by end of Phase 1. | Rules certification (M1) needs the Rules Lead; Beta needs bilingual parity. | Hard blocker for M1/M5 — risk R-S1. |

### 1.3 Ambiguities found while planning (need answers, not assumptions)

1. **Email provider + magic-link UX details** (link TTL, single-use policy, rate limits) — §10.2/§15.10 give security posture but not parameters. Proposed defaults in E4.F3; Trust/Privacy Lead to approve.
2. **Beta invite distribution** — §15.14 specs one-use/limited-use codes but not who generates/sends them (mail-merge? partner communities?). Ops decision; tooling in E16.F6 covers generation/redemption only.
3. **Reference devices** for the §15.6 battery/thermal soak — spec says "selected launch reference devices" but never selects them. Propose: iPhone 12, iPhone 15, Pixel 6a, mid-range iPad; QA lead to confirm.
4. **Season 1 start date** relative to V1 launch (§12.5 says 12 weeks but not the anchor). Propose: season starts at V1 launch day 00:00 UTC.
5. **"2,000 accounts in good standing" tier-opening criterion** (§7.1) — needs the precise good-standing definition; propose: no active sanction, not pending-deletion. Product Owner to confirm.

---

## Step 2 — High-level architecture

### 2.1 Client (single TypeScript web app, PWA)

| Concern | Approach |
| --- | --- |
| UI framework | React + TypeScript. Route-level code splitting to hit §15.6 (shell ≤ 5 MB, first-play ≤ 25 MB). |
| Table rendering | DOM/CSS (tiles as accessible elements with transforms) — satisfies screen-reader labels, 200% text scale, contrast, Reduced Motion (§9.9) natively and doubles as the required reduced-effects fallback. Optional WebGL2 particle/effect layer, feature-detected, never load-bearing (§3.2). |
| Game state | Server state is authoritative; client keeps a versioned replica keyed by `state_version`. Commands carry expected version + idempotency token (§15.8). A thin local UI-state store (selection, sort order, panels) is separate from replica state and never mutates it. |
| Input | Pointer/touch/keyboard adapters emitting semantic intents (`select_tile`, `confirm_discard`, `claim(chow, tiles)`). Two-step discard confirm per §9.3/§9.6; mirrored left-handed layout (§9.3). |
| Animation | CSS/WAAPI, interruptible, ≤ 600 ms standard / ≤ 150 ms Reduced Motion (§9.11); animation never delays deadline or input (§9.5). |
| Audio | Three WebAudio buses (music/effects/declarations); gesture-gated start; pause on background (§9.11). |
| Networking | One WebSocket for match + presence; REST for meta (profile, friends, mail). Heartbeat + RTT estimator feeding server deadline compensation (§5.10). Resume protocol: re-auth → state snapshot ≥ current version (§8.7). |
| Local persistence | IndexedDB for guest credential + device settings; `navigator.storage.persist()` request with data-loss warning fallback (§3.2, §15.6). Asset caching via service worker (PWA). |
| Asset loading | Versioned manifest, cache-first SW, cosmetics fetched on demand (§15.6); routine update ≤ 10 MB. |
| i18n/a11y | ICU message format, semantic string IDs shared with server (§15.12); 30% expansion-safe layouts; central announcer for ARIA live regions (§9.9). |

### 2.2 Backend services

**[ASSUMPTION]** Modular monolith ("Core API") + two stateful runtimes, one repo. Each module below has its own schema ownership and internal API so it can be split out later without rewrites. Right-sized for 2,500 CCU / 750 concurrent matches (§15.4).

| Service / module | Responsibilities (spec refs) |
| --- | --- |
| **Gateway/API edge** | TLS termination, session validation, rate limiting, request logging (§15.10). |
| **Identity & Session** (module) | Guest device credentials, email magic link, Google/Apple OAuth (V1), account linking rules, 15-min access tokens, rotating refresh sessions, reuse detection, logout-all, suspicious-login handling (§10.1–10.2, §15.10). |
| **Player Profile** (module) | Display names + filters, cosmetic equipping, settings sync matrix (§9.10), statistics read model (§12.7), privacy visibility. |
| **Matchmaking** (module) | Per-lobby and Full Rotation queues, eligibility (balance, linked identity for ranked), region/latency banding, rating bands + expansion, reservation + dodge cooldowns, block/recent-opponent avoidance (§8.5, §10.6, §10.8). |
| **Match Service** (stateful runtime) | One actor per match: wall commit + shuffle, full rules state machine (via Rules Engine lib), shared deadlines, private claim collection, timeouts/auto-actions, AFK takeover, reconnect, emote relay, event-log append-before-ack, snapshots (§5, §8.7, §15.7–15.9). |
| **Rules Engine** (pure library) | Deterministic state transitions, legal-action derivation, hand evaluation, canonical highest-Tai decomposition, settlement math, Ting/wait computation — no I/O, replayable from events (§5–7, §9.4). Consumed by Match Service, sim harness, support replay tool. |
| **AI Service** (stateful runtime or module) | Easy/Medium/Hard policies + takeover bot; observation contract enforcement; seeded determinism; 250 ms budget with fallback chain; calibration harness (§11). |
| **Economy/Ledger** (module) | Double-entry Jade ledger, reserves, settlement posting, grants, welfare, compensations, reversals; idempotency keys; conservation checks; RPO-0 posting (§7, §15.7). |
| **Progression** (module) | XP events + level curve, achievements (event-log derived, recomputable), daily/weekly missions, Quick Play ladder points (§12.1–12.3, §12.9, §13.3). |
| **Rating & Leaderboards** (module, V1) | Pairwise Elo, provisional K, floor redistribution, abandonment adjustments, season lifecycle/reset, regional leaderboards, ladder boards (§12.4–12.8). |
| **Social** (module) | Friends/requests/blocks, Recent Players, presence (Offline/Online/InQueue/InMatch, appear-offline), private room codes + invites (§8.6, §10.6). |
| **Mail & Notifications** (module) | Mail types, targeting, idempotent claims, expiry; web push (invites, service restoration, reward expiry), quiet hours (§10.9). |
| **Live Config** (module) | Versioned remote config within hard bounds, feature flags, two-person approval workflow, staging preview, one-action rollback, audit (§13.4). |
| **Analytics Ingest** (module) | First-party event endpoint, schema registry + validation, consent gating, pseudonymization, warehouse loader (§15.2–15.3). |
| **Trust & Safety / Support / Admin** (module + internal UI) | Reports + evidence bundles, sanctions ladder, appeals, anti-abuse signal jobs, Match-ID audit package retrieval, read-only account views, cataloged compensation, invite codes, maintenance banners (§10.8, §15.13–15.14, §15.9). |
| **Privacy** (module) | Export bundles, deletion with 30-day window, retention jobs, "Deleted Player" masking (§10.4). |

Cross-cutting: OpenTelemetry tracing/metrics/logs; append-only audit log for admin actions; secrets in managed vault; IaC for all environments.

### 2.3 Data flow invariants (enforced by design, tested by E18)

1. No API or socket payload ever contains another player's concealed tiles, unrevealed wall, unresolved claim responses, or future randomness (§15.8) — enforced by per-seat view projection in Match Service, verified by the hidden-info test suite.
2. Every gameplay mutation = append event → ack; ledger postings are transactionally paired debit/credit; a failed hand reverses provisionally, never edits history (§8.8, §15.7).
3. Anything the client displays about legality came from the server's legal-action set (§5.13, §9.4).

---

## Step 3 — Work Breakdown Structure

Complexity: S ≤ 3 days, M ≤ 2 weeks, L ≤ 4 weeks, XL > 4 weeks (single owner + review). Every feature ID is stable and extraction-ready: an implementation prompt = feature row + its spec sections + relevant Step 6/7/8 detail.

### E0 — Foundations & DevOps

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E0.F1 | Monorepo + standards | pnpm workspace: `client`, `server`, `match-service`, `rules-engine`, `ai`, `protocol`, `tools`. Lint/format/tsconfig strict, ADR template, CODEOWNERS. | — | S | — | Fresh clone → `pnpm build && pnpm test` green; ADR-0001 records stack (A1). |
| E0.F2 | CI/CD pipeline | Per-PR lint+typecheck+unit; trunk-based; preview deploys; artifact versioning; migration gate. | E0.F1 | M | — | PR-to-preview < 15 min; rollback = one action (§13.4, §15.7). |
| E0.F3 | Environments + IaC | dev/staging/prod via IaC; managed Postgres/Redis; secrets vault; TLS everywhere. | E0.F2 | M | Cloud account/billing setup lag | `terraform apply` reproduces staging from zero; no secret in repo (§15.10). |
| E0.F4 | Observability baseline | OTel traces/metrics/logs, dashboards-as-code, alert routing, crash capture (first-party endpoint until a processor passes privacy review §15.3). | E0.F3 | M | — | A traced request spans edge→module→DB; §15.5 latency histograms exist on day 1. |
| E0.F5 | Protocol package | Shared TS types + JSON schemas for commands, events, errors (stable codes §9.8), analytics events (§15.2). Codegen for docs. | E0.F1 | M | Premature freeze | Breaking change fails CI compat check; every error has a stable code + i18n key. |
| E0.F6 | Latency probes | Synthetic RTT/jitter probes from US-west + Taiwan vantage points against candidate region (A3). | E0.F3 | S | — | Report vs §15.5 thresholds delivered before Phase 2 exit. |

### E1 — Rules Engine (Taiwanese v1.1)

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E1.F1 | Tile & state model | 144-tile catalog, seats/winds, hand/wall/discard/meld structures, canonical sort, state serialization + hashing. | E0.F5 | S | — | Round-trips deterministically; catalog hash stable (§15.9). |
| E1.F2 | Wall + shuffle + deal | CSPRNG Fisher-Yates, seed/wall-hash commit record, dice break `((s−1) mod 4)+1`, 72-stack flatten to deque, 4-pass deal +1, front/back draw semantics, 16-tile reserve, boundary rules incl. Kong-at-boundary stats standing (§5.2). | E1.F1 | M | Off-by-one wall math | Property tests: 65 dealt / 79 wall / 63 drawable; skip-animation identical deque; boundary golden cases pass. |
| E1.F3 | Flower replacement | Mandatory exposure + chained back-draw replacement, initial E→S→W→N order, in-play immediate replacement (§5.3). | E1.F2 | S | — | Chained-replacement goldens incl. Earthly-Hand-via-flower (§5.9). |
| E1.F4 | Turn/claim state machine | Draw→discard cycle, Chow/Pong/Kong legality, claim window with private collection, priority resolution (wins > pong/kong > chow), timeout-Pass **without** discard-Win lock, deliberate-pass lock lifecycle, stale-action rejection (§5.5–5.8, §5.10, §5.13). | E1.F2 | L | Highest defect-density area | Full claim-priority golden matrix passes; forged/stale commands rejected without state change; lock reason codes distinguish deliberate vs server Pass. |
| E1.F5 | Kong flows | Exposed/added/concealed forms, replacement draws, robbing added Kong (multi-winner, declarer-as-discarder) (§5.7). | E1.F4 | M | — | All Kong goldens incl. rob-with-multiple-winners. |
| E1.F6 | Special wins & offers | Eight Flowers offer/re-offer, Heavenly offer/lapse, Earthly, Last-Tile definition (either end) + stacking with Win After Replacement (§5.9). | E1.F4 | M | Ambiguity regressions — new v1.1 rules | Offer/lapse event sequences match §5.9 goldens exactly; server never auto-declares. |
| E1.F7 | Hand evaluation + decomposition | 5 melds + pair detection, Ting/wait-set computation (deduplicated union, §9.4), highest-Tai canonical decomposition with lexicographic tie-break (§6.2). | E1.F1 | L | Performance for wait computation | ≤ 5 ms per evaluation p99 on server hardware; decomposition deterministic across runs/platforms. |
| E1.F8 | Scoring table | All §6.1 patterns + §6.2 combination/exclusion rules; 69-Tai max fixture; Dealer Tai 1+2k (§5.12). | E1.F7 | L | Rule-interpretation errors | Every §6.1 row has ≥ 1 positive + ≥ 1 negative golden; §6.2 exclusions enumerated as fixtures; Rules Lead sign-off. |
| E1.F9 | Settlement math | Payer models (discard/Zimo/rob/instant-win), Dealer Tai application, debit cap, largest-remainder proportional allocation, exhaustive-draw/dealer-continuation outcomes incl. k-cap 10 (§5.11, §7.3). | E1.F8 | M | Integer-rounding disputes | All §7.4 worked examples reproduce exactly; conservation property (credits == debits) fuzz-tested; signed-64 only. |
| E1.F10 | Golden suite + simulator | Fixture format (named cases, versioned), runner in CI, randomized legal-state simulator with invariant checks (no dup tiles, conservation, replay determinism), 1M-hand RC gate with triage tooling (§1.3, §15.9). | E1.F4–F9 | L | CI cost | 500+ named goldens green; 1M sim runs < 60 min on CI hardware (else triggers A1 escape hatch); failure artifact = replayable seed. |

### E2 — Match Runtime

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E2.F1 | Match actor + event log | One actor per match wrapping E1; append-before-ack durable event log; snapshots ≤ 30 s; crash recovery by replay (§15.7). | E1.F4, E0.F3 | L | Durability vs latency | Kill-9 during play recovers to identical state; ack only after append; command idempotency verified. |
| E2.F2 | Per-seat view projection | Redacted state per seat: own hand, public zones, counts only for others; claim privacy until resolution (§9.5, §15.8). | E2.F1 | M | Leak = critical bug | Hidden-info test suite proves no concealed data in any payload/timing side channel (jitter rule §15.5). |
| E2.F3 | Deadline engine | Shared absolute deadlines = base + max(smoothed half-RTT, cap 500 ms); per-mode presets (§5.10); animation-time exclusion; server-side enforcement. | E2.F1 | M | Clock skew | Deadline identical for all seats; late input rejected; presets live-configurable within bounds (E14.F3). |
| E2.F4 | Timeout & takeover | Auto-Pass (no lock) / canonical auto-discard; 3-strike AFK → disclosed Medium takeover; control return on next legal turn (§5.10, §8.7, §11.1). | E2.F3, E3.F2 | M | — | Timeout goldens; takeover badge events emitted; returning player resumes correctly. |
| E2.F5 | Reconnect | Seat retention 90 s Quick/private, 60 s ranked; re-auth → versioned snapshot ≥ 3 s p95; second-device resume for linked accounts with prior-session revocation (§8.7). | E2.F1, E4.F1 | L | iOS socket lifecycle | Scripted disconnect matrix (drop, sleep, tab-kill, device swap) all resume; p95 target met in staging netem tests. |
| E2.F6 | Match lifecycle & abnormal termination | Reservation→seat→hand loop→settlement handoff; administrative void + replay-with-same-k; reserve release on failed start; incomplete-match rules (§8.8, §5.11). | E2.F1, E5.F2 | M | — | Every §8.8 branch has an integration test; no orphaned reserves after chaos test. |
| E2.F7 | Full Rotation orchestration (V1) | Multi-hand rotation, continuations, table points (uncapped, no stake), 60-min cap + telemetry, podium tie-breaks, abandonment marking (§8.4, §8.7). | E2.F6 | M | — | Rotation goldens incl. cap-at-k=10 and 60-min end; capped-match metric emitted. |
| E2.F8 | Emote/phrase relay (V1) | 8 emotes + 24 phrases, 5 s shared rate limit, mute/block filtering (§10.7). | E2.F1, E12.F2 | S | — | Rate limit server-enforced; muted sender invisible to muter only. |

### E3 — AI Bots

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E3.F1 | Observation contract + harness | Legal-observation struct (own hand + public only), seeded RNG, decision recording for replay (§11.2, §11.4). | E1.F7 | M | — | Attempting to read hidden state is a compile-time/API impossibility; decisions replay from seed. |
| E3.F2 | Easy + Medium policies | Per §11.3 rows: Easy biased-random/isolated-tile logic; Medium effective-draw minimizer; always-win, mandatory flowers; reaction delays. | E3.F1 | M | — | Divergence-from-reference bands (Easy 35–50%, Medium 10–20%, §11.4) measured in harness. |
| E3.F3 | Hard policy + safety prover | Expected-value discard model; public-state "provably safe" solver (no consistent unseen assignment completes any eligible hand, honoring win-locks); fold logic (§11.3). | E3.F2 | XL | Algorithmic risk; 250 ms budget | Prover correct on adversarial fixtures; p99 decision < 250 ms or fallback chain fires (§11.4); Hard-vs-Medium first-place 34–42%. |
| E3.F4 | Calibration suite | 10k same-seed seat-rotated sims per pairing; strength bands enforced in CI as a release gate; style-offset seeding ≤ 5% (§11.4). | E3.F2–F3 | M | Sim time | Calibration report auto-generated per AI version; out-of-band fails release. |

### E4 — Identity & Accounts

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E4.F1 | Sessions & tokens | 15-min access / rotating refresh (30-day inactivity, 90-day absolute), family revocation on reuse, logout-all, recent-reauth gate for sensitive ops (§15.10). | E0.F3 | M | — | Token reuse triggers family revocation test; sensitive ops 401 without recent auth. |
| E4.F2 | Guest accounts | Device credential issuance/rotation, age gate (month/year, block <13, no retention of full DOB), versioned ToS/Privacy acceptance, storage-persistence warning, 180+30-day inactive deletion job (§10.1, §10.3). | E4.F1 | M | iOS storage eviction | Cleared storage → warned path; underage cannot create persistent account; deletion job idempotent. |
| E4.F3 | Email magic link (Beta) | Provider integration, single-use 15-min links **[ASSUMPTION — ambiguity #1]**, rate limits, guest→link migration with settings-conflict summary (§9.10, §10.2). | E4.F2 | M | Deliverability | Link flow < 60 s end-to-end in staging; conflict summary shown when established account has values. |
| E4.F4 | Google/Apple OAuth (V1) | OAuth flows, established-account collision rule (never auto-merge), unlink guard for last identity (§10.2). | E4.F3 | M | Apple web-auth quirks | Collision chooses established account; last-identity unlink blocked. |
| E4.F5 | Player identity | Opaque IDs, curated default names, rename 1/30 days, bilingual profanity/impersonation filter, exact-ID search (§10.5). | E4.F2 | M | Filter quality zh-TW | Filter fixture list (both languages) passes; rename cooldown enforced server-side. |

### E5 — Economy (Jade)

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E5.F1 | Double-entry ledger core | Append-only postings (debit+credit pairs), idempotency keys, reason codes, actor/match/rules-version tags, balance materialization, RPO-0 write path (§7.5, §15.7). | E0.F3 | L | Correctness is existential | Concurrent-posting fuzz keeps Σcredits==Σdebits; replaying postings reproduces balances; audit query by match ID. |
| E5.F2 | Reserves & settlement posting | Pre-seat balance check + cap reserve, release paths, settlement from E1.F9 output, multi-winner caps, compensating reversals (§7.1–7.3, §8.8). | E5.F1, E1.F9 | M | Orphan reserves | Chaos test: no reserve survives match teardown; §7.4 examples post correctly end-to-end. |
| E5.F3 | Grants & welfare | Onboarding grants (3,000 + 2,000 once), daily mission grants (via E11), welfare top-up to 1,000 gated on same-day AI hand, 1/UTC-day (§7.5). | E5.F1, E11.F3 | S | — | All grants idempotent by event ID; welfare prerequisite enforced. |
| E5.F4 | Economy dashboards & tier criteria | Per-tier balance percentiles, faucet-to-cap ratio, inflation by source; tier-opening criteria monitor (2,000 eligible + queue-health projection §7.1); median-balance review trigger (§7.5). | E5.F1, E15.F2 | M | — | Dashboards live in staging with synthetic data; trigger alerts fire in test. |

### E6 — Matchmaking & Lobbies

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E6.F1 | Queue core + reservation | Per-lobby queues, 4-human formation, reservation handshake, dodge cooldowns (60 s/5 m/15 m), cancel-free before reservation (§8.5). | E4.F2, E5.F2 | L | Liquidity edge cases | Formation p50 < 30 s with 16 synthetic eligible players (§2.5); dodge escalation persisted 24 h. |
| E6.F2 | Placement constraints | Region/latency ≤ 150 ms banding, recent-opponent avoidance (3 matches), block avoidance, no-coordinated-friends rule (§8.5, §10.6, §10.8). | E6.F1, E12.F1 | M | Population-permitting fallbacks | Constraint relaxation order deterministic + logged; friends never seated together from public queue when detectable. |
| E6.F3 | Queue UX contract | 90-second alternative offer (AI practice / lower tier / keep waiting), latency warning > 150 ms, ranked disable > 300 ms/10% loss (§8.5, §15.5). | E6.F1 | S | — | Offer events emitted; take-rate metric wired (§15.2). |
| E6.F4 | Ranked queue (V1) | Rating bands ±150 +100/20 s, unrestricted at 80 s in-region; linked-identity eligibility gate (§8.5, §12.5). | E6.F1, E13.F1 | M | — | Guests receive typed eligibility error; band expansion telemetry. |

### E7 — Client Foundation

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E7.F1 | App shell + PWA | Router, layout system, service worker, install prompt, orientation handling (non-blocking overlay §3.2), compatibility check + unsupported-browser state (§9.8). | E0.F5 | M | — | Lighthouse PWA pass; shell ≤ 5 MB compressed; §9.8 states reachable. |
| E7.F2 | Design system | Tokens (type/spacing/color incl. High Contrast + dark parity), tile component with accessible names, buttons ≥ 44 px, focus system, Reduced Motion switch (§9.9). | E7.F1 | L | 360 px feasibility | Storybook a11y audit clean; tile readable at 32×44 hit-area spec. |
| E7.F3 | Realtime client | WS lifecycle, RTT estimator, command queue with idempotency, versioned replica sync, resume protocol, degraded-connection indicator (§15.5). | E0.F5, E7.F1 | L | iOS background socket | netem test matrix (drop/latency/jitter) green; resume ≤ 3 s p95 staging. |
| E7.F4 | i18n + a11y runtime | ICU pipeline, en/zh-TW bundles, semantic IDs, live-region announcer, keyboard map, mirrored layout, text scale 200% (§9.3, §9.9, §15.12). | E7.F2 | M | zh-TW screen reader | Axe + manual SR pass on shell in both languages. |
| E7.F5 | 360×640 match wireframe validation | Build the §9.2 simultaneous-visibility layout as a static prototype; on-device sign-off gate before E8 hardening. | E7.F2 | S | Requirement revision path | UX Lead sign-off recorded, or approved §9.2 revision filed (spec-mandated gate). |

### E8 — Match Table UI

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E8.F1 | Table layout & zones | Bottom-local remap, discard grids (chronological, claim placeholders), meld areas, wall depletion display, drawable count, wind/dealer/continuation badges (§9.2, §9.5). | E7.F5, E2.F2 | L | Density at 360 px | All §9.2 elements simultaneously visible at every supported viewport (device-lab pass). |
| E8.F2 | Hand interaction | Select/confirm discard (touch + mouse + keyboard), manual reorder, auto-sort modes (never while selected), cancel-until-ack (§9.3, §9.6). | E8.F1, E7.F3 | M | — | Input-mode matrix tests; discard cancel race handled (server ack wins). |
| E8.F3 | Claim & action UI | Legal-action buttons only, private claim window with shared countdown, revision-until-deadline, "Thinking" opponent state, timer states (amber 3 s / red 1 s, non-color cues, SR announcements) (§5.10, §9.4–9.5). | E8.F1 | L | Time-pressure usability | Claim flow usability test with novices; timer a11y audit; no legality computed client-side. |
| E8.F4 | Assists | Ting panel with "Visible remaining" (0-copy shown with "All visible"), identical-tile highlight, recent-discard pulse (Reduced-Motion variant), score preview (§9.4). | E8.F1 | M | — | Assist values match server fixtures; assist matrix per mode (§9.4) enforced by server flags. |
| E8.F5 | Result & tally screen | §9.7 ten-item order, expandable "Why this scored", dealer continuation display, Add Friend, result-card image export (client-rendered, no hidden info), Play Again (§8.10, §9.7). | E8.F1, E11.F1 | M | — | Tally reproduces E1.F8 breakdown exactly; export image snapshot-tested; §7.4 examples render correctly. |
| E8.F6 | Reconnect/AFK UX | Reconnecting overlay, takeover badge ("Auto-playing"), control-restored toast, abandonment warnings (§8.7, §11.1). | E8.F1, E2.F5 | S | — | Full disconnect matrix has correct UI at each stage. |

### E9 — Meta UI (screens detailed in Step 7)

| ID | Feature | Deps | Size | Acceptance summary |
| --- | --- | --- | --- | --- |
| E9.F1 | Onboarding flow (age gate, consent, guest create, grant moments) | E4.F2, E7.F2 | M | Funnel instrumented (§15.2); block-under-13 path correct. |
| E9.F2 | Home/Play + lobby select (eligibility, closed-tier states, insufficient-Jade error) | E6.F1, E5.F2 | M | Closed tiers absent-not-teased (§9.1); eligibility errors typed. |
| E9.F3 | Queue screen (§8.5 offers) | E6.F3 | S | Offer interactions logged. |
| E9.F4 | Profile & statistics (§12.7 read models, visibility settings) | E11.F1 | M | Percentages gated at 20 hands; privacy modes honored. |
| E9.F5 | Match history + detail (20 Beta / 50 V1, filters, Match ID copy) | E2.F1 | M | No concealed-hand leakage; rules-version shown. |
| E9.F6 | Settings (all §9.10 groups, sync matrix, device-vs-account) | E4.F2 | M | Matrix behaviors integration-tested incl. guest-link migration. |
| E9.F7 | Rulebook (offline-cacheable, searchable, contextual deep links, fairness statement §15.9) | E7.F1 | M | Opens without abandoning active decision (§1.3); en/zh-TW parity. |
| E9.F8 | Friends & Recent Players UI | E12.F1 | M | Rate limits surfaced; block/report flows complete. |
| E9.F9 | Private room UI (create/join/lobby/rematch, host presets) | E12.F2 | M | Code expiry handled; presets match §8.6 only. |
| E9.F10 | Mail & announcements UI (V1 full; Beta maintenance banner) | E14.F1 | M | Claim-all skip logic surfaced per item (§10.9). |
| E9.F11 | Missions/achievements/progression/cosmetics UI (V1; Beta minimal XP display) | E11 | L | Preview + Reset to Default for cosmetics; progress exact counts (§12.3). |
| E9.F12 | Leaderboards UI (V1: rating + ladder, region/global) | E13.F3 | M | Provisional labeling; refresh timestamp shown. |
| E9.F13 | Feedback/support form + post-match survey + status banner (§15.13–15.14) | E7.F1 | S | Receipt ID returned; Match ID auto-attached. |

### E10 — Tutorial & Rulebook content

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E10.F1 | Fixture authoring + engine hooks | Server-authored snapshot format (TUT-C1/2/3-v1), scripted opponents, snapshot-restore on error, step gating, progress save (§8.1). | E1.F4, E2.F1 | L | Fixture drift vs rules | Fixtures validated against rules engine in CI (no extra legal claims possible — spec requirement). |
| E10.F2 | Chapters 1–3 UI | All 13 scripted steps with guide character, recovery prompts, forced-focus handling, chapter picker, skip/resume/replay/reset (§8.1). | E10.F1, E8.F1 | L | Copy iteration churn | Every step: permitted input, focus, string ID, recovery tested; completion 75% target instrumented. |
| E10.F3 | Onboarding rewards wiring | 500 XP + 2,000 Jade once for complete-or-skip; replay grants nothing (§8.1, §12.1). | E10.F2, E5.F3 | S | — | Idempotency verified across skip→later-complete paths. |

### E11 — Progression

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E11.F1 | XP + levels | §12.1 award table with caps, takeover rule (completion-only if > half hand), level curve, retroactive recompute, level rewards → entitlements (§12.2). | E2.F1, E5.F1 | M | — | Award idempotent by event ID; curve-change recompute test grants but never revokes. |
| E11.F2 | Achievements (32) | Event-log-derived counters, rules-version aware, recompute on corrections, cheating-revocation path (§12.3). | E11.F1 | M | Counter drift | Replay-from-events equals live counters in property test; all 32 triggers fixture-tested. |
| E11.F3 | Missions | Daily (3) + weekly (3 deterministic from catalog), 7-day claim window, retired-mission replacement logic, AI-practice-labeled onboarding mission only (§13.3). | E11.F1, E14.F3 | M | — | UTC reset correctness incl. DST-free UTC handling; progress excludes private/AI/voided per §13.3. |
| E11.F4 | Quick Play ladder (V1) | 3/win + 1/hand, first 10 hands/UTC day, season accrual, guest accrual-hidden-until-link, cosmetic rewards (§12.9). | E11.F1, E13.F2 | M | — | Daily cap boundary tests; reward mailing idempotent. |
| E11.F5 | Cosmetics & entitlements | Catalog (3 faces/3 themes/9 frames/16 titles), equip slots, opponent-visible subset, suppress-opponent-effects, compatibility metadata (§13.2). | E11.F1 | M | — | Tile skins pass a11y checks (§13.2); Reset to Default works. |

### E12 — Social

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E12.F1 | Friends graph + presence | Requests (limits 200/50 pending/20 per day/5 per min), blocks, Recent Players (20, 30-day), presence states + appear-offline, minor default-invisible, In-Match queued invite rule (§10.6). | E4.F3 | L | Presence fan-out | Rate limits server-enforced; blocked users see Offline; presence updates < 5 s. |
| E12.F2 | Private rooms | 6-char codes, invites, host presets (timer/open-hand/bot difficulty), bot fill, rematch-same-seats, no Jade/rating/missions, code expiry (§8.6). | E12.F1, E2.F1, E3.F2 | M | — | Preset isolation verified (no ledger/rating writes); Beta restricts to Quick Play. |
| E12.F3 | Emotes/phrases content (V1) | 8 emotes + 24 phrases, en/zh-TW localization + cultural review, mute controls (§10.7). | E2.F8 | S | Localization review lead time | Catalog approved by reviewer; mute matrix tested. |

### E13 — Rating, Leaderboards & Seasons (V1)

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E13.F1 | Pairwise Elo | §12.4 formula, K 40/24, integer largest-remainder zero-sum, 500 floor redistribution, abandonment disciplinary adjustment separate from Elo (§12.6). | E2.F7 | M | Rounding edge cases | All §12.4 worked examples exact; zero-sum property fuzzed; floor cases golden. |
| E13.F2 | Season lifecycle | 12-week calendar, between-match reset 1500+0.75×(r−1500), tier bands, season checkpoint recompute for cheating removal (§12.5–12.6). | E13.F1, E14.F3 | M | — | Reset never touches active matches; recompute audit-logged. |
| E13.F3 | Leaderboards | Per-region + global, eligibility 10 matches + linked + good standing, provisional labels, sort tie-breaks, 15-min refresh, season rewards mailing (§12.8), ladder boards (§12.9). | E13.F2, E14.F1 | M | — | Region pinned at season start; deleted players drop at refresh (§10.4). |

### E14 — Mail, Notifications & Live Config

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E14.F1 | Mail system | Types, targeting (no sensitive traits), idempotent claims, Claim All with per-item results, expiry rules (§10.9). | E5.F1 | M | — | Double-claim impossible; expiry honored; policy mail persistent. |
| E14.F2 | Web push + email | VAPID push (3 allowed categories), quiet hours 21:00–09:00 local, minors default-off, installed-PWA education flow (§10.9, §3.2). | E4.F3 | M | iOS push requires install | Quiet-hours suppression tested across timezones; unsubscribe honored. |
| E14.F3 | Live config + flags | Versioned config schema with hard bounds (immutable list §13.4), two-person approval, staging preview, effective-time scheduling, one-action rollback, full audit (§13.4). | E0.F3 | L | Change-safety | Attempting an out-of-bounds or rules-touching change is rejected; rollback < 1 min; every change has ticket/approver metadata. |
| E14.F4 | Maintenance & status | Banner service, 24-h notice flow, queue-block 10 min pre-shutdown, known-issues page (§15.7, §15.13). | E14.F3 | S | — | Maintenance drill executes the full sequence. |

### E15 — Analytics

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E15.F1 | Event pipeline | First-party ingest endpoint, schema registry (from E0.F5), consent gating (essential vs optional), pseudonymous IDs, field allowlist (no email/IP/DOB/tokens/concealed tiles), warehouse loader (§15.2–15.3). | E0.F4 | L | Privacy correctness | Schema-invalid events rejected; consent-off drops optional events; leak-scan test on event corpus. |
| E15.F2 | Dashboards & KPIs | §2.5 gates + §15.2 named dashboards (tutorial funnel, claim-timeout by account age, queue abandonment + 90-s offer take rate, dealer Jade delta, capped-match share, tier balance percentiles) + D1/D7/D30, session length, match duration. | E15.F1 | M | — | Every Beta exit gate (§2.5) has a live query before Beta starts. |
| E15.F3 | Funnels | load→playable, identity→onboarding, tutorial, queue→match, first-match, repeat, welfare recovery, Full Rotation completion (§15.2). | E15.F1 | S | — | Funnel definitions in code, not ad-hoc SQL. |

### E16 — Trust & Safety, Support, Admin

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E16.F1 | Reporting | Categories, auto-attached evidence (match ID, event slice, versions), 500-char reporter text, receipt IDs, security-queue routing (§10.8). | E2.F1 | M | — | Report bundle contains no other player's concealed data beyond spec. |
| E16.F2 | Sanctions & appeals | Warn/rename/mute/cooldown/reverse/suspend/ban ladder, evidence-required permanence, 14-day appeals with different reviewer, reporter notices (§10.8). | E16.F1 | M | — | Sanction actions audit-logged; appeal workflow state machine tested. |
| E16.F3 | Anti-abuse signals | Batch jobs: repeated groups, feeding patterns, shared device/network, timing automation, ledger anomalies, private-room farming; signal → review queue, never auto-permanent (§10.8, §15.8). | E15.F1, E5.F1 | L | False positives | Signals produce ranked review queue with evidence links; no automated permanent action path exists. |
| E16.F4 | Support console | Search by Match/Player ID/ledger event/receipt; read-only time-boxed account views; cataloged compensation codes with role limits; scoring-dispute escalation; audit package by Match ID (§15.9, §15.13). | E5.F1, E2.F1 | L | Scope creep | No free-form balance edit exists; every action audited; audit package renders a replay of the hand. |
| E16.F5 | Deterministic replay viewer (internal) | Step through any hand from event log with per-seat visibility toggle — powers rules verification, disputes, anti-cheat (§8.8). | E2.F1, E1.F10 | M | — | Replay of 100 sampled production hands matches recorded results bit-exact. |
| E16.F6 | Beta invite codes | One-use/limited-use generation, redemption gate, cohort tagging (§15.14). | E4.F2 | S | — | Redemption race-safe; codes revocable. |

### E17 — Security & Privacy

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E17.F1 | ASVS L2 hardening pass | Headers, CSRF, rate limits, dependency/container scanning in CI, admin MFA + RBAC, audit-log tamper evidence (§15.10). | E0.F2 | M | — | ASVS L2 checklist mapped to evidence; scanner gate in CI. |
| E17.F2 | Privacy lifecycle | Export bundle, 30-day deletion window, retention jobs per §10.4 table, "Deleted Player" masking, Taiwan transfer notice surfacing (§10.4, §15.3). | E4.F2 | M | — | Export/delete e2e test; retention jobs prove deletion by scanning. |
| E17.F3 | Pen-test & incident readiness | Hidden-information + claim-privacy pen test (§16.1), incident response runbook, breach-notification process, suspicious-login notices (§15.10). | E2.F2 | M | External scheduling | Pen-test findings at zero criticals before Beta exit (§2.5). |

### E18 — QA & Release Engineering

| ID | Feature | Objective / description | Deps | Size | Risks | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| E18.F1 | Test infrastructure | Unit/integration harnesses, 4-client e2e driver (scripted players), netem network simulation, device farm hookup. | E0.F2 | L | — | A full 4-human staged match runs headless in CI nightly. |
| E18.F2 | Load & soak | Synthetic players to §15.4 burst (Beta 2×30 min; V1 3×60 min), 60-min device soak, backpressure verification. | E18.F1 | M | — | §15.4/§15.5 targets met on staging with report artifacts. |
| E18.F3 | Accessibility & loc audits | WCAG 2.2 AA audit + game-exception doc, en/zh-TW parity check, zh-TW screen-reader session (§9.9, §16.1). | E7.F4, E9.* | M | External auditor lead time | Audit report with zero blocking findings or approved exceptions. |
| E18.F4 | Chaos & recovery drills | Match-service kill/recovery, DB failover, backup restore (quarterly exercise), rollback rehearsal (§15.7). | E2.F1, E0.F3 | M | — | RTO/RPO targets demonstrated; drill runbooks written. |
| E18.F5 | Release traceability | Requirements-to-test matrix for every "must" (§16.1); golden suite + calibration + 1M sim as release gates. | E1.F10 | M | Tedium → drift | CI publishes traceability report; gaps block RC. |

---

## Step 4 — Implementation order (phases and why)

**Dependency spine:** Rules Engine → Match Runtime → (Ledger + Identity) → Matchmaking → Client table → Meta/onboarding → Social/LiveOps → Beta → V1 competitive/social/live layers.

| Phase | Content (epic/features) | Exit milestone |
| --- | --- | --- |
| **P0** (2 sprints) | E0 all; E17.F1 start; E18.F1 skeleton; hiring/vendor asks (A5, A7); latency probes E0.F6 | **M0 Walking skeleton:** deployed hello-match echo over WS through full pipeline |
| **P1** (3 sprints) | E1.F1–F10; E3.F1–F2; E7.F1–F2, E7.F5 in parallel on client | **M1 Rules certified:** 500 goldens + sim invariants green; Rules Lead sign-off; 360 px layout validated |
| **P2** (2 sprints) | E2.F1–F4; E8.F1–F4 (against staged matches); E3 bots as opponents | **M2 Playable slice:** internal 1-human-3-bot Quick Play hand end-to-end on staging |
| **P3** (2 sprints) | E4.F1–F3, F5; E5.F1–F3; E6.F1–F3; E2.F5–F6; E8.F5–F6 | **M3 Human loop:** 4 real humans queue Bamboo, play, Jade settles, reconnect works |
| **P4** (2 sprints) | E10 all; E9.F1–F7, F13; E11.F1 + minimal XP; E7.F4 completion; E15.F1–F3 | **M4 Onboarding complete:** new player → tutorial → first human hand, bilingual, instrumented |
| **P5** (2 sprints) | E12.F1–F2 (Beta scope); E14.F1(min), F3–F4; E16 all; E17.F2–F3; E18.F2–F5; iOS hardening burn-down | **M5 Beta entry:** §15.1 capability list done; load/pen/a11y/backup gates passed; invite codes live |
| **Beta** (3 sprints, 6 wks) | Stabilization; §2.5 gate monitoring; controlled tier tests; V1 groundwork (E2.F7, E13.F1) at ≤ 30% capacity | **M6 Beta exit:** every §2.5 mandatory gate green ≥ 14 days for S0/S1 rules defects |
| **P6** (3 sprints) | E2.F7–F8; E13 all; E11.F2–F5; E4.F4; E12.F3; E9.F8–F12; E14.F2 | **M7 V1 feature complete** |
| **P7** (2 sprints) | E18 full regression + V1 load (3× burst); legal/privacy sign-off (§15.11); WCAG final audit; content lock for launch season; RC soak | **M8 RC → M9 V1 launch** |

**Why this order minimizes risk and rework:**

1. **The rules engine is the product and its highest defect risk** — it gets the first three sprints, isolated as a pure library so certification (M1) doesn't wait on any infrastructure, and so the A1 language-escape-hatch stays cheap.
2. **Determinism/durability (E2.F1) precedes all features that consume events** — achievements, analytics, replay, anti-cheat all read the event log; building it early prevents the classic retrofit rewrite.
3. **The ledger arrives with the first human match, not later** — retrofitting double-entry under live balances is the most expensive rework in this codebase; M3 forces it correct while stakes are synthetic.
4. **Client table starts against staged bot matches (P2)**, decoupling the two hardest workstreams (match runtime, table UX) so they parallelize across the backend and client pairs.
5. **The two spec-mandated gates land before their dependents:** 360 px validation (E7.F5) before table hardening; hidden-info pen test before Beta.
6. **Everything V1-only (Elo, ladder, OAuth, emotes, leaderboards) is after Beta**, so Beta findings can reshape it without sunk cost — and Beta runs with a deliberately small surface, per §15.1.

Parallel workstreams throughout: backend pair (E1→E2→E5/E6), client pair (E7→E8→E9/E10), platform (E0→E14.F3→E16→E18 infra), QA-automation (E18 alongside everything from P1).

---

## Step 5 — Sprint plan

Detail is full through Beta (S1–S16); V1 sprints (S17–S24) are goal-level by design — they get re-planned against Beta findings, which is the point of running a Beta.

**S1 — "Repo to prod-shaped staging"** — Features: E0.F1–F3. Tasks: workspace scaffold, CI, IaC baseline, secrets vault, standards ADRs. Deliverables: staging env, green pipeline. Testing: pipeline self-test. Risks: cloud account setup delay. Exit: M0 pre-req; any engineer ships a change to staging in < 1 h.

**S2 — "Contracts and observability"** — Features: E0.F4–F6, E17.F1 start, E18.F1 skeleton. Tasks: protocol package + codegen, OTel wiring, dashboards-as-code, WS echo service + client harness, latency probes. Deliverables: M0 walking skeleton; Taiwan latency report. Testing: traced e2e echo. Risks: protocol over-design — timebox to command/event/error envelopes. Exit: M0 demo; probe report reviewed vs A3.

**S3 — "Tiles, wall, deal"** — Features: E1.F1–F3; client E7.F1. Tasks per Step 6.1. Deliverables: deal + flower replacement fully property-tested. Testing: wall-math property suite, §5.2 goldens. Risks: fixture-format churn — freeze schema this sprint. Exit: 65/79/63 invariants green in CI.

**S4 — "Claims and turns"** — Features: E1.F4 (+F5 start); client E7.F2. Tasks: state machine, claim window, priority resolution, pass-lock semantics, forged-command rejection. Deliverables: full turn loop in fixture tests. Testing: claim-priority matrix goldens; timeout-Pass lock goldens (v1.1 critical). Risks: state-machine complexity — mandatory design review before build. Exit: all §5.5–5.8 goldens green.

**S5 — "Scoring, settlement, certification"** — Features: E1.F5–F10; E3.F1–F2; client E7.F5 prototype. Tasks: Kong flows, special-win offers, evaluator, Tai table, settlement math, golden runner, simulator, Easy/Medium bots. Deliverables: **M1 candidate**. Testing: 500 goldens, §7.4 examples, 1M sim dry run, §6.2 69-Tai fixture. Risks: Rules Lead availability (R-S1) — schedule sign-off session now. Exit: **M1** + 360 px layout sign-off (E7.F5).

**S6 — "A match that survives murder"** — Features: E2.F1–F3; E8.F1 start. Tasks: match actor, event log append-before-ack, snapshots, recovery, per-seat projection, deadline engine. Deliverables: staged bot match runs on staging; kill-recovery demo. Testing: crash-replay identity test; hidden-info scan v1. Risks: durability latency — measure early against §15.5. Exit: kill -9 mid-hand recovers identically, acked commands never lost.

**S7 — "Playable slice"** — Features: E2.F4; E8.F1–F3. Tasks: timeout/auto-action/takeover, table layout, hand interaction, claim UI vs staged matches. Deliverables: **M2** — 1 human vs 3 bots, full hand, on devices. Testing: input-mode matrix; timer a11y first pass. Risks: 360 px density — device checks daily, not end-of-sprint. Exit: M2 demo on iPhone + desktop; internal playtest #1 logged.

**S8 — "Identity and money"** — Features: E4.F1–F2, F5; E5.F1–F2; E8.F4. Tasks: tokens/sessions, guest + age gate, ledger core, reserves, settlement posting, assists UI. Deliverables: bot matches settle real ledger entries (0-stake modes verified no-op). Testing: ledger fuzz (conservation), reserve chaos test. Risks: ledger subtlety — second engineer reviews every posting path. Exit: §7.4 examples post correctly end-to-end.

**S9 — "Four humans"** — Features: E6.F1–F3; E2.F5–F6; E4.F3. Tasks: Bamboo queue, reservation, dodge cooldowns, reconnect flows, magic link, abnormal-termination paths. Deliverables: **M3** — staff play real matches from four devices. Testing: 4-client e2e in CI; disconnect matrix; netem. Risks: iOS socket resume (R-T1) — dedicate one engineer. Exit: M3; reconnect p95 ≤ 3 s staging; no orphaned reserves in chaos run.

**S10 — "Results, history, errors"** — Features: E8.F5–F6; E9.F2–F3, F5, F13; E11.F1 minimal. Tasks: tally screen + Why-this-scored, history, lobby/queue screens, §9.8 error states, XP pipeline minimal. Deliverables: complete Quick Play loop UX. Testing: tally-vs-engine snapshot tests; error-state walkthrough. Risks: — . Exit: internal playtest #2: full loop rated ≥ 4/5 by staff on claim clarity (dry run of §2.5 metric).

**S11 — "Teach the game"** — Features: E10.F1–F2 (Chapters 1–2); E9.F1, F6–F7; E7.F4 completion. Tasks: fixture hooks, chapter UIs, onboarding flow, settings matrix, rulebook shell, i18n runtime completion. Deliverables: Chapters 1–2 playable bilingual. Testing: fixture-vs-engine CI validation; SR pass on tutorial. Risks: zh-TW review loop time — submit strings this sprint (R-S1). Exit: novice playtest completes Chapter 1 unaided.

**S12 — "Onboarding complete"** — Features: E10.F2 (Ch 3) + F3; E15.F1–F3; E9.F4. Tasks: Chapter 3, grants wiring, analytics pipeline + funnels + §2.5 gate dashboards, profile/stats. Deliverables: **M4**. Testing: funnel events end-to-end; grant idempotency. Risks: analytics privacy review. Exit: M4; every Beta gate has a live dashboard query.

**S13 — "Friends and rooms"** — Features: E12.F1–F2; E14.F3–F4; E16.F6. Tasks: friends graph, presence, blocks, private Quick rooms, live config + flags + approval workflow, maintenance banner, invite codes. Deliverables: Beta social scope done. Testing: rate limits, presence latency, config-bounds rejection tests. Risks: presence fan-out at scale — load test now, not at Beta. Exit: friends+rooms usable across three test markets’ latencies.

**S14 — "Trust, safety, support"** — Features: E16.F1–F5; E17.F2; E14.F1 minimal (maintenance/policy mail). Tasks: reports, sanctions, appeals, signals v1, support console, replay viewer, export/deletion, retention jobs. Deliverables: T&S operable by non-engineers. Testing: evidence-bundle privacy scan; export/delete e2e. Risks: console scope creep — cataloged actions only. Exit: mock abuse case handled end-to-end in console.

**S15 — "Hardening I"** — Features: E18.F2–F4; E17.F3; iOS burn-down; performance budget enforcement (§15.6). Tasks: load to Beta burst, device soaks, WCAG audit run, pen test execution, chaos drills, bundle-size diet. Deliverables: gate evidence pack v1. Testing: is the sprint. Risks: pen-test findings volume — reserve S16 capacity. Exit: all Beta-blocking findings triaged with owners.

**S16 — "Beta entry"** — Features: fix backlog from S15; E18.F5 traceability; Beta ops runbooks; invite wave 1 prep. Deliverables: **M5 — Closed Beta live** to first cohort. Testing: full regression + golden + sim gates on RC build. Risks: launch-day ops — staffed war room, §15.7 maintenance drill done. Exit: first 100 invitees playing; crash-free ≥ 99.5% in week 1.

**Beta sprints B1–B3 (S17–S19 calendar):** goals = §2.5 gate convergence. Fixed loop each sprint: triage (S0/S1 rules defects get a 24 h SLA — the 14-day clean-window clock (§2.5) restarts on each one), fix, golden-case addition for every rules bug, weekly gate review vs dashboards, controlled Sparrow/tier config tests, qualitative survey wave. ≤ 30% capacity on V1 groundwork (E2.F7, E13.F1 behind flags). Exit: **M6** sign-off by Product Owner.

**S20–S21 — "Ranked core"**: E2.F7, E13.F1–F2, E6.F4, E4.F4. Exit: rated Full Rotation end-to-end on staging with Elo goldens green.
**S22 — "Progression & social V1"**: E11.F2–F5, E12.F3, E2.F8, E9.F8–F11. Exit: 32 achievements + missions + cosmetics live on staging.
**S23 — "Leaderboards, ladder, mail, push"**: E13.F3, E11.F4, E14.F1–F2, E9.F10, F12. Exit: **M7 feature complete**; season-1 config staged.
**S24 — "V1 hardening + RC"**: E18 full pass at V1 targets, §15.11 legal sign-off, final WCAG audit, upper-tier closed-state verification, launch content lock. Exit: **M8 RC**, then **M9 launch** on Product Owner go.

---

## Step 6 — Engineering task lists (extraction-ready)

Format: each block is self-contained for handoff. Tasks ≤ 1 day each unless marked. Three fully-expanded examples below set the template; remaining features inherit the same granularity from their WBS acceptance criteria (the WBS row + spec §§ + this template = the implementation prompt).

### 6.1 E1.F2 — Wall, shuffle, deal

Tasks:
1. Implement CSPRNG wrapper with injectable seed for tests; forbid `Math.random` repo-wide (lint rule).
2. Implement Fisher-Yates over the 144-tile catalog; unit-test uniformity (chi-squared on 1M shuffles, offline job).
3. Implement 72×2 stack layout and side assignment (E/S/W/N × 18).
4. Implement dice roll (2d6, both values recorded) and break-point selection: owner `((s−1) mod 4)+1`, count s stacks from owner's right, counterclockwise.
5. Implement flatten-to-deque (upper-then-lower per stack from break) and front/back draw APIs.
6. Implement 4-pass deal + East extra tile; emit deal events.
7. Implement 16-tile reserve boundary: exhaustibility check, mandatory-replacement-at-boundary → exhaustive draw, Kong-at-boundary meld standing (§5.2 v1.1).
8. Implement commit record: seed, rules version, catalog hash, wall hash → event log before deal (§15.9).
9. Property tests: tile conservation, 65/79/63 counts, deque determinism from (seed, dice), skip-animation equivalence.
10. Golden cases: boundary draws front and back, replacement-at-boundary, final-drawable definitions feeding E1.F6.

Acceptance criteria: all §5.2 numbers reproduced; identical deque from identical (seed, dice) across 10k runs; commit record present before any deal event in every log.
Definition of Done: merged with review by second gameplay engineer; property + golden suites in CI; no TODOs; fixture docs updated.

### 6.2 E1.F7/F8 — Hand evaluation and scoring (the prompt's worked example)

Tasks:
1. Define evaluation input: 16-tile concealed hand + melds + candidate tile + context (seat/prevailing wind, dealer k, win source, wall state, flower exposures).
2. Implement meld enumerator (chow/pong partitioning with memoized backtracking).
3. Implement winning-structure detector (5 melds + pair over 17 effective tiles; Kong-as-one-meld).
4. Implement wait-set computation: all tile identities completing ≥ 1 legal decomposition, deduplicated (§9.4); "visible remaining" counter from public zones only.
5. Implement per-pattern detectors for every §6.1 row (one function per pattern, table-driven registration).
6. Implement combination/exclusion resolver per §6.2 (supersede chains, mutual exclusions, All Chows/No-Honors award rule).
7. Implement highest-Tai decomposition search with lexicographic canonical tie-break; serialize the chosen decomposition for tally display.
8. Implement event-Tai integration (Zimo/Last-Tile/Win-After-Replacement/Rob/Heavenly/Earthly/Eight-Flowers) with §5.9 stacking rules.
9. Unit tests: pattern positives/negatives per row; §6.2 69-Tai maximum fixture; multi-decomposition determinism test.
10. Performance: memo/bitset optimization to ≤ 5 ms p99; benchmark harness in CI.
11. Wire into golden runner; author scoring goldens with Rules Lead (paired session).

Acceptance criteria: E1.F7/F8 WBS rows. Definition of Done: Rules Lead has signed the pattern-fixture review; benchmark job green; tally serialization consumed by E8.F5 snapshot test.

### 6.3 E5.F1 — Jade ledger core

Tasks:
1. Schema: `ledger_posting` (id, journal_id, account_id, direction, amount>0, reason_code, idempotency_key UNIQUE, match_id?, rules_version, actor, created_at) — append-only, no UPDATE/DELETE grants.
2. Journal writer: multi-posting transaction, Σdebit==Σcredit enforced in code + DB CHECK via journal balance table.
3. Balance materialization: per-account running balance with optimistic concurrency; reconciliation job comparing Σpostings vs balance nightly.
4. Idempotency: same key → same journal returned, no double-post (tested under concurrency).
5. Reserve model: `reserve` rows lock cap amounts; available-balance = balance − active reserves; release paths (settle, void, failed start).
6. Reason-code catalog (grant/settlement/welfare/compensation/reversal/…) as enum shared via protocol package.
7. Compensating-transaction API (never mutate history) (§8.8).
8. RPO-0 posting path: synchronous commit; document failure semantics for Match Service callers.
9. Fuzz test: concurrent settlements + grants + welfare on shared accounts; invariant scan.
10. Audit query endpoints: by account, by match, by reason code (for E16.F4).

Acceptance criteria: E5.F1 WBS row. Definition of Done: security review of grants (least-privilege writer roles); runbook for reconciliation-mismatch alert.

---

## Step 7 — UI development plan

Global (applies to every screen, do not repeat per row): localized en/zh-TW with 30% expansion tolerance (§15.12); WCAG 2.2 AA — focus visible, no traps, 200% text scale, 4.5:1 contrast, SR labels (§9.9); every loading/empty/error state uses §9.8 codes with retry + support path; telemetry = view + primary-action events per §15.2 schema; responsive 360×640 up; Reduced Motion variants; left-handed mirroring where an action row exists.

| Screen | Purpose | Key components | States & transitions | User actions | Notable error/empty states | Animations | Telemetry highlights |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Landing/compat | Entry, capability check | Title card, compat gate, language pick | checking→ok/unsupported | continue, switch language | unsupported browser (§9.8) | none | load-to-playable funnel start |
| Age & consent | §10.3 gate | Month/year picker, ToS/Privacy versioned accept | input→accepted/blocked | confirm, view policies | under-13 terminal state (no account) | none | consent state |
| Sign-in/link | Guest create, magic link, (V1) OAuth | provider buttons, email form, conflict summary (§9.10) | guest→linked; collision→choose-account | create, link, resend | link expired, provider fail, collision | subtle | link start/success/fail |
| Home/Play | Mode hub | Quick Play card, AI Practice, (V1) Full Rotation, nav (§9.1) | per-release nav sets | navigate | maintenance banner state | card hover | session start |
| Lobby select | Tier choice (§7.1) | Tier cards: min balance, stake, cap; eligibility badges | eligible/ineligible/closed-hidden | select, view rules version | insufficient Jade → welfare pointer | none | lobby impression/eligibility |
| Queue | Waiting (§8.5) | timer, cancel, 90-s offer sheet, latency warning | queued→reserved→match / offer / cancel | cancel, accept offer | queue timeout, reservation fail | pulse (RM-safe) | queue enter/expand/cancel/offer take |
| **Match table** | Core play (§9.2–9.6) | hand row, discard grids, meld zones, wall, badges, timer, action row, Ting panel, emote tray (V1) | per state-machine; claim overlay; reconnect overlay; takeover badge | select/confirm discard, claim, pass, sort, panel toggles, emote | desync → resync flow; disconnect overlay | §9.5/§9.11 budget; interruptible | every command + state transition |
| Result/tally | §9.7 explanation | 10-section ordered layout, Why-this-scored expandable, Add Friend, export card | summary→expanded rows | expand rows, add friend, export, play again, report | export unsupported → save fallback | count-up ≤ 600 ms | result view depth, add-friend, export |
| Tutorial (3 chapters) | §8.1 | guide character, step overlay, forced-focus, chapter picker | 13 scripted steps + recovery snapshots | per-step actions, skip/resume/replay | step recovery prompts (not errors) | slow, RM-safe | per-step start/error/retry/complete |
| AI Practice setup | §8.2 | difficulty select, optional timer toggle | setup→match | start, back | none | none | practice start |
| Rulebook | §1.3 reference | search, Tai table, diagrams, worked examples, fairness note | browse/search/deep-link (non-abandoning overlay in match) | search, navigate | offline-cached state | none | rule lookups (topic) |
| Profile/stats | §12.7 | stat groups by mode, filters, visibility control | <20 hands → counts only | filter, set visibility | private profile view (others) | none | — |
| History + detail | §8.10 | list (20/50), filters, Match ID copy, tally re-render | list→detail | copy ID, report, export card | empty history | none | — |
| Settings | §9.10 | grouped controls per matrix, read-only rules info | device vs account scopes | edit, link account, export/delete, logout-all | conflict summary on link | none | settings changes (§15.2) |
| Friends | §10.6 | list w/ presence, requests, Recent Players, blocks | tabs | add by ID, accept/decline, block, report, invite | rate-limit notice, not-found | none | social events |
| Private room | §8.6 | code display/entry, roster, host presets, bot fill | lobby→match→rematch | create, join, set presets, start, rematch | code expired/full/invalid | none | room funnel |
| Mail | §10.9 | list by type, claim buttons, Claim All results | unread→read→claimed | claim, claim all | claim conflict (§9.8), expired | none | mail claims |
| Missions/progression (V1) | §13.3, §12.2 | daily/weekly cards, XP bar, level rewards track | reset countdowns | claim, view catalog | — | progress fill | mission events |
| Achievements/cosmetics (V1) | §12.3, §13.2 | 32-achievement grid with exact progress, equip slots, preview, reset-default | locked/unlocked/equipped | equip, preview, reset | — | none | equips |
| Leaderboards (V1) | §12.8–12.9 | region/global tabs, rating + ladder boards, provisional labels, refresh stamp | loading→list | switch region/board, view profile | ineligible-yet state | none | views |
| Feedback/support | §15.13–15.14 | form, category, Match ID attach, receipt, survey, status banner | submit→receipt | submit, copy receipt | offline queue-and-retry | none | submissions |
| Maintenance/error shell | §9.8 catalog | code, explanation, retry, support link, known-issues link | per error code | retry, contact | — is the state | none | error impressions |

State-transition sources: match-screen transitions are generated from the E1.F4 state machine (single source of truth); meta screens use a typed route/state map in `client/state` reviewed against this table.

---

## Step 8 — Backend development plan

Cross-service defaults (stated once): auth via gateway-validated session token; rate limiting per token + IP with typed 429s; errors use the §9.8 stable-code envelope; metrics = RED + domain counters per §15.5 targets; logs structured, secret/hidden-info-free (§15.10); caching only where noted (correctness beats caching in an economy product); horizontal scale via stateless modules + partitioned Match Service.

### Identity & Session
Endpoints: `POST /guest`, `POST /auth/magic-link {email}`, `POST /auth/magic-link/verify`, `POST /auth/oauth/{google|apple}` (V1), `POST /auth/refresh`, `POST /auth/logout-all`, `POST /account/link`, `DELETE /account/identity/{id}` (guarded), `GET /account`.
Data: `account`, `identity(provider, subject, UNIQUE)`, `device_credential`, `refresh_session(family_id, rotated_from)`, `consent_record(version, at)`.
Validation/security: link-collision rule §10.2; reuse-detection revokes family; recent-reauth for sensitive ops; magic-link single-use TTL; email only for auth/security (§10.9). Scale: stateless; Redis for token denylist.

### Player Profile
Endpoints: `GET/PATCH /profile`, `POST /profile/rename` (30-day), `GET /players/{playerId}` (visibility-filtered), `GET/PUT /settings` (matrix-scoped), `GET /stats/{mode}`.
Data: `profile`, `settings(account_scope jsonb, device_scope client-side)`, `stats_*` read models projected from events. Validation: name normalization + bilingual filter (E4.F5). Caching: public profiles 60 s.

### Matchmaking
Endpoints: `POST /queue/{queueId}/enter`, `DELETE /queue`, `POST /reservation/{id}/accept`, WS events for reservation.
Data: Redis queue sets + `reservation`, `dodge_penalty` in Postgres. Validation: eligibility (balance via Economy, linked-identity for ranked, latency band from client RTT report + server measurement). Metrics: time-in-queue histograms per queue (Beta gate §2.5). Scale: single matcher loop per queue (population makes this trivial); shardable by queue.

### Match Service
Interface: WS `match.command` (envelope: session, match, actor, expected_version, action_id, idempotency) / `match.event` per-seat streams; internal gRPC/HTTP for orchestration (create from reservation, health, drain).
Data: `match`, `match_event(seq, payload, hash)` append-only partitioned; `match_snapshot`; per-seat outbox. Validation: full §15.8 list — authorization, turn, deadline, legality, replay protection. Security: per-seat projection is the only egress path; no debug endpoint returns full state in prod. Metrics: command-ack and state-update latencies (§15.5), active matches, takeover count, desync count. Scale: consistent-hash match placement, drain-based deploys (finish hands, no mid-hand kill), 750 concurrent matches ≈ trivial per node; 3-node minimum for recovery.

### Economy/Ledger
Endpoints (internal-only except read): `POST /ledger/journal` (internal, idempotent), `POST /reserve` / `POST /reserve/{id}/release` (internal), `GET /wallet` (own balance + active reserves), `GET /ledger/history` (own, paginated).
Data: Step 6.3. Validation: §7.2 semantics; welfare gating. Security: writer role restricted to Match Service settlement path + audited support actions; two-person rule for config-driven grant changes (§13.4). Metrics: conservation-check results, reserve leaks (must be 0), posting latency.

### Progression / Rating / Social / Mail / Live Config / Analytics / T&S
Per the WBS rows E11/E13/E12/E14/E15/E16 — each exposes: Progression `GET /missions`, `POST /missions/{id}/claim`, `GET /achievements`, `GET /ladder` (V1); Rating internal `POST /rating/apply(matchResult)` + `GET /leaderboard/{region}`; Social `POST/GET /friends*`, `POST /blocks`, `GET /presence` (WS-pushed), `POST /rooms`, `POST /rooms/join`; Mail `GET /mail`, `POST /mail/{id}/claim`, `POST /mail/claim-all`; Live Config `GET /config` (client bootstrap, signed), admin CRUD with approval workflow; Analytics `POST /events` (batch, schema-validated, consent-aware); T&S `POST /reports`, admin console APIs (search, evidence, sanction, compensation) — all admin routes MFA + RBAC + audit-logged (§15.10). Data models follow Step 9. Progression/rating writers are event-log consumers (idempotent by event ID), which makes recompute (§12.3) a replay, not a migration.

---

## Step 9 — Database design

**[ASSUMPTION]** Postgres 16, one cluster, schema-per-module; partitioned event tables; PITR + daily encrypted backups (35-day retention, quarterly restore drill §15.7).

Entities (owner → tables): identity → `account, identity, device_credential, refresh_session, consent_record`; profile → `profile, settings, rename_history`; social → `friendship, friend_request, block, recent_player, room`; economy → `ledger_posting, journal, balance, reserve, welfare_claim`; match → `match, match_event (range-partitioned by day, 180-day drop §10.4), match_snapshot, match_summary (player-visible history)`; progression → `xp_event, level_state, achievement_progress, mission_state, ladder_points`; rating → `rating_state, rating_history, season, leaderboard_snapshot`; mail → `mail_item, mail_claim`; config → `config_version, config_change (audit)`; T&S → `report, sanction, appeal, abuse_signal, invite_code`; privacy → `export_job, deletion_request`; analytics → warehouse-side star schema (separate store, pseudonymous IDs only §15.3).

Key relationships: `account 1—n identity/friendship/ledger_posting/…`; `match 1—n match_event/match_summary`; `journal 1—n ledger_posting` (balanced); `season 1—n rating_history/leaderboard_snapshot`.

Indexes (beyond PKs/FKs): `ledger_posting(idempotency_key) UNIQUE`, `(account_id, created_at)`, `(match_id)`; `match_event(match_id, seq) UNIQUE`; `match_summary(account_id, ended_at DESC)`; `friend_request(to_account, status)`; `rating_state(region, rating DESC)` partial for eligibles; `mail_item(account_id, expires_at)`; `identity(provider, subject) UNIQUE`.

Persistence strategy: match hot state in-memory in Match Service actors; durability via event append (sync commit) + snapshots; everything else ordinary transactional. Ledger and match_event tables are append-only (no UPDATE/DELETE grants; retention via partition drop with legal-hold override for T&S cases §10.4).

Migrations: forward-only, expand-migrate-contract pattern; CI gate applies to a copy of prod schema; every migration ships a rollback note or explicit forward-recovery plan (§15.7). Versioning: schema version table; event payloads versioned by rules/protocol version (events are never rewritten — new consumers handle old versions).

---

## Step 10 — Multiplayer plan

- **Connection flow:** HTTPS auth → WS connect with access token → subscribe presence → (in match) `match.attach(matchId)` → server streams snapshot@version then deltas.
- **Lobby/queue flow:** eligibility check (balance reserve pre-check, latency band) → queue → reservation broadcast → all four accept within window → Match Service allocates actor → seat/wind/dealer randomization → wall commit → deal (§8.5, §5.2). Reservation decline/timeout → dodge cooldown; failed allocation → reserves released (§8.8).
- **Game creation:** private rooms allocate the same actor with host presets (§8.6); tutorial/AI matches allocate actors with fixture/bot seats.
- **Synchronization:** authoritative-state replication, no lockstep, no client prediction — turn-based cadence makes server-confirmed UI (with optimistic *visual* selection only, never optimistic discard) the right model; every event carries `state_version`; client detects gap → requests resync.
- **Authoritative server responsibilities:** everything in §15.8 (shuffle, hands, legality, deadlines, claims, scoring, settlement) — client renders and intends only.
- **Reconnect:** §8.7 flow; seat retention 90/60 s; re-auth then versioned snapshot; second-device resume revokes prior session; timers keep running (decisions time out normally).
- **Disconnect/timeout handling:** auto-Pass (lock-free) / canonical auto-discard; 3 strikes → disclosed Medium takeover; Quick Play absence = recorded disconnect with normal results; Full Rotation two-hand-endings absence = abandonment + cooldown ladder (§8.7).
- **Anti-cheat:** protocol validation (turn/deadline/legality/idempotency), private claim collection with no early reveal (including timing: claim resolution waits for all responses or deadline — no information leaks via early resolution §15.5), command anomaly + timing-automation detection feeding E16.F3, ledger reconciliation, collusion analysis (§15.8).
- **Replay:** internal-only deterministic replay from event log (E16.F5) for support/rules/anti-cheat; player-facing replay explicitly future (§8.10).
- **Timeout tuning:** all §5.10 values in live config within hard bounds, new matches only.

---

## Step 11 — Testing strategy

| Layer | Scope & tooling | Key suites |
| --- | --- | --- |
| Unit | rules engine, settlement, Elo, ledger math, i18n, components | pattern detectors, §6.2 exclusions, largest-remainder allocators (Jade + Elo), curve math |
| Property/fuzz | invariants under random input | tile conservation; ledger conservation; deque determinism; claim-priority totality; Elo zero-sum; idempotency-under-concurrency |
| Golden | 500+ named fixtures, versioned per rules version (§1.3) | every §6.1 row ±; §7.4 examples; §5.9 offers/lapses; timeout-lock distinction; boundary draws; dealer table §5.11; every rules bug found ever becomes a golden |
| Simulation | randomized legal-state playouts | invariant scan + deterministic-replay check; 1M/RC gate; AI calibration bands (§11.4) |
| Integration | module APIs + DB | settlement end-to-end; reserve lifecycle; mission/achievement projection vs replay; privacy export/delete |
| E2E gameplay | 4 scripted clients vs staging | full Quick Play loop; claim races; multi-winner; reconnect matrix; abnormal termination branches (§8.8) |
| Network simulation | netem profiles (150/300 ms, 2/10% loss, 50 ms jitter) | deadline fairness; resume targets; ranked-disable thresholds (§15.5) |
| Hidden-info/security | payload + timing scans, pen test | no concealed data in any per-seat stream under fuzzing; forged/stale/replayed command corpus; ASVS checks |
| Load/soak | synthetic players at §15.4 bursts; 60-min device soak | queue + match latency SLOs; memory/battery budgets (§15.6) |
| Chaos | kill match nodes, DB failover, backup restore | recovery to identical state; RTO/RPO evidence (§15.7) |
| Accessibility | axe CI + manual SR (en + zh-TW) + keyboard-only runs | tutorial, match table, claim window under timer; audit for §16.1 |
| Regression | full suite nightly + per-RC; traceability matrix (E18.F5) | every "must" mapped to ≥ 1 test |
| Cross-platform | device farm: browser matrix §3.2 + reference devices (ambiguity #3) | iOS interruption matrix (§16.1): call, tab switch, 5-min background, storage eviction, orientation churn |

Per-system required cases are enumerated in each WBS acceptance row; QA owns keeping the §16.1 traceability report green.

---

## Step 12 — DevOps plan

- **Repo:** single monorepo (E0.F1 layout); ADRs in `/docs/adr`; golden fixtures in `rules-engine/fixtures` (versioned dirs per rules version).
- **Branching:** trunk-based; short-lived feature branches; PR review mandatory (2 reviewers for `rules-engine`, `economy`, auth paths — mirrors §13.4 two-person spirit).
- **CI/CD:** PR → lint/typecheck/unit/property; trunk → integration + preview deploy; nightly → e2e + netem + sim (100k); RC → full golden + 1M sim + calibration + load + traceability gates. Deploys: API rolling; Match Service drain-then-replace (no mid-hand kills); client versioned static deploy with SW-driven update prompt ("client update required" = version-mismatch state §9.8).
- **Feature flags:** server-evaluated via Live Config (E14.F3), client receives resolved flags at bootstrap; V1 features run dark in Beta behind flags.
- **Environments:** dev (ephemeral per-PR previews), staging (prod-shaped, synthetic load), prod. Config differences only via Live Config + IaC vars.
- **Secrets:** managed vault, rotated, never in repo/CI logs (§15.10).
- **Monitoring/alerting:** §15.5/§15.7 SLOs as alert rules; ledger-conservation and reserve-leak checks page immediately; §2.5 gate dashboards.
- **Crash reporting:** first-party endpoint (client `error`+source-mapped stack, sampled) unless/until a processor passes the §15.3 review.
- **Rollback:** one-version rollback rehearsed (E18.F4); DB expand-contract keeps schema compatible one version back; Live Config one-action rollback; runbook per service.

---

## Step 13 — LiveOps preparation

Implemented by E14 + E11 + E16; this is the operational readiness list:

- **Daily/weekly missions:** catalog CMS-lite inside Live Config admin (reviewed catalog, deterministic weekly selection §13.3); reward wiring through mail/ledger with idempotency.
- **Seasons:** season table + scheduler (rating season, ladder season, cosmetic IDs §12.5, §13.5); season-1 config staged in S23; reset drill on staging before each live reset.
- **Events:** anchor-event kit = themed accent/frame entitlement + mission set + announcement (Lunar New Year, Mid-Autumn) with 15-business-day content lock and 10-day localization/cultural review workflow tracked in the LiveOps calendar (§13.5); no rules/economy impact possible by construction (config bounds).
- **Remote config/A-B:** bounds-checked config (E14.F3); experiments limited to onboarding copy/UI placement/non-economic presentation (§15.1) via flag-cohorts; timers/queue-offers are *tunable config*, not A/B experiments, per §13.4 approval flow.
- **Push:** three permitted categories only, quiet hours, minors-off (§10.9).
- **Content management:** string/asset bundles versioned with the client; glossary-keyed terminology (§15.12); cosmetic entitlement IDs stable forever (never revoke §12.2).
- **Localization ops:** professional localizer + Taiwanese expert review loop with string-freeze checkpoints each release; machine-translation banned for rules/safety/support strings (§15.12).
- **Support/GM/Admin tools:** E16.F4 console (search, evidence, cataloged compensation, sanctions, appeals), E16.F5 replay viewer, maintenance banner + status page, invite-code manager; **no tool can edit rules outcomes or free-form balances** (§15.13).

---

## Step 14 — Technical debt register (accepted at planning time)

| ID | Shortcut / deferral | Reason | Impact | Priority |
| --- | --- | --- | --- | --- |
| TD-1 | Modular monolith instead of microservices | Team size, CCU scale | Later extraction cost if scale 10× | Low |
| TD-2 | DOM-first rendering; WebGL effects layer deferred | A11y + fallback economics (A1) | Less visual flair at launch; effects layer post-Beta | Low |
| TD-3 | Single US region; Taiwan on backbone | Ops scope (A3) | Taiwan RTT worse than a local region; §15.5 in-region wording keeps it compliant | Medium — revisit with E0.F6 data + Beta telemetry |
| TD-4 | First-party crash/analytics only; no hosted processor | §15.3 review not done | More self-managed pipeline ops | Medium |
| TD-5 | Support console minimal UI polish | Internal tool | Slower support workflows | Low |
| TD-6 | Anti-abuse signals batch-only (no realtime scoring) | Beta population is small + invite-only | Slower collusion detection | Medium — revisit at V1 |
| TD-7 | Node rules engine (A1 escape hatch unexercised) | Velocity, shared types | Possible sim/AI perf ceiling | Watch — trigger = E1.F10/E3.F3 benchmarks |
| TD-8 | Leaderboard region correction is manual support action | §12.8 allows support correction | Support toil | Low |
| TD-9 | No public verifiable-shuffle UX (spec-future §15.9) | Spec defers | Trust rests on audit + fairness statement | Deferred by spec |
| TD-10 | V1-scope items dark-shipped during Beta behind flags | Parallelize | Flag-debt cleanup sprint needed post-V1 | Low |

---

## Step 15 — Risks and dependencies

| ID | Risk | Type | Prob. | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| R-T1 | iOS Safari lifecycle (sockets, eviction, orientation) degrades UX | Technical | High | High | E7.F3 dedicated hardening, §16.1 interruption matrix, S9/S15 device time, persistent-storage flow | Client lead |
| R-T2 | Rules-engine correctness defects reach players (S0/S1 gates §2.5) | Technical | Med | Critical | Golden-first development, M1 certification before UI, sim gate, replay viewer, 24 h S0/S1 SLA in Beta | Gameplay lead + Rules Lead |
| R-T3 | Hard-AI safety prover misses 250 ms budget | Technical | Med | Medium | Prototype in P2 groundwork, fallback chain (§11.4), TD-7 language escape hatch | Gameplay eng 2 |
| R-T4 | Event-log durability adds latency beyond §15.5 | Technical | Low | High | Measure in S6; batch fsync tuning; local NVMe + sync replication option | Platform |
| R-T5 | Hidden-info leak via payload or timing | Security | Low | Critical | Single projection egress, leak-scan CI, pen test E17.F3 | Eng Lead |
| R-D1 | Queue liquidity in Beta off-peak (4-human, no bots, §8.5) | Design | High | Medium | Invite-wave scheduling by timezone, 16-player gate on §2.5 measurement, 90-s offers; product accepts risk per spec | PM |
| R-S1 | Rules Lead / zh-TW localizer engagement late (A7) | Schedule | Med | High | Contract by end P0; paired fixture sessions scheduled in S5, S11 | PM |
| R-S2 | Commissioned art/audio late (A5) | Schedule | Med | Medium | Placeholder pipeline until P4; Beta can ship v1 art minimalism (§3.4 text title card) | PM |
| R-S3 | Beta exit gates (esp. crash-free 99.5%, queue p50) not met in 6 weeks | Schedule | Med | High | Gates dashboarded from S12; hardening sprints S15–16 before entry; Beta extension is a Product Owner call, planned as option | EM |
| R-3P1 | Email deliverability (magic link) | 3rd party | Med | Medium | Reputable provider, monitored bounce rates, resend + support path | Platform |
| R-3P2 | Apple/Google OAuth review friction (V1) | 3rd party | Low | Medium | Start app registrations in P5; magic link is the fallback path | Platform |
| R-I1 | Single-region outage | Infra | Low | High | §15.7 RTO 60 min runbook, backups, drill E18.F4; multi-region is explicitly conditional in spec | Platform |
| R-SEC1 | Admin-tool misuse | Security | Low | High | MFA, RBAC, cataloged actions only, tamper-evident audit (§15.10) | Eng Lead |
| R-P1 | Legal/privacy review finds Beta blocker (§15.11) | Compliance | Low | High | Counsel engaged P1 (A7); review checklist tracked from P3 | Trust/Privacy Lead |

Third-party dependency list: email provider, OAuth (Google/Apple), push service (standard Web Push), cloud provider (A3), device farm, external pen-test + WCAG auditors, art/audio vendors, localization vendor. None are runtime-critical to a running match except cloud infrastructure.

---

## Step 16 — Definition of Done

- **Task:** merged with review; tests included; no lint/type errors; telemetry + error codes wired where user-facing.
- **Feature (WBS row):** acceptance criteria demonstrably met (test link or demo); strings localized or keys stubbed for loc batch; a11y pass at component level; dashboards/alerts updated if operational; docs (API/runbook) updated; no new TODO without a TD-register entry.
- **Epic:** all features done; epic-level integration test green; traceability rows green; owner sign-off (Rules Lead for E1, UX Lead for E7–E10, Economy Designer for E5/E11, T&S Lead for E16–E17).
- **Sprint:** exit criteria met or explicitly re-planned; demo recorded; no unreviewed S0/S1 bugs; flake rate < 2% on CI.
- **Alpha (= M3):** four humans complete Quick Play with settlement on staging; crash recovery demonstrated; no known S0.
- **Beta entry (= M5):** §15.1 capability list complete; load @ Beta burst passed; pen test zero criticals; WCAG interim audit; en/zh-TW parity; runbooks + on-call rota live; invite system operational.
- **Beta exit (= M6):** every §2.5 mandatory gate met, including 14-day zero-S0/S1 rules window and Jade conservation zero-discrepancy; Product Owner sign-off recorded.
- **Release Candidate (= M8):** V1 feature list (§2.3) complete; full regression + 1M sim + calibration green; §15.11 legal sign-off; final WCAG audit; V1 load (3× burst 60 min) passed; season-1 content locked; rollback rehearsed on this build.
- **Production launch (= M9):** RC soaked ≥ 1 week on staging + Beta cohort; go/no-go with Product Owner, Eng Lead, T&S Lead; war-room staffed; §2.5 directional dashboards live; day-2 patch train scheduled.

---

## Step 17 — Deliverables map & post-launch backlog

This document contains: executive roadmap (Step 4 table), architecture overview (Step 2), WBS (Step 3), dependency graph (Step 4 spine + per-feature dep columns), milestone plan (M0–M9), sprint plan (Step 5), engineering task lists + template (Step 6), QA strategy (Step 11), DevOps plan (Step 12), risk register (Step 15), and this post-launch backlog. Each WBS feature row + its spec sections + the Step 6 template is a self-contained implementation prompt.

**Post-launch backlog (priority order, from spec §16.4 future scope):**
1. Discard puzzle mode on tutorial fixtures (§2.3) — first post-launch candidate.
2. Friend-only spectating in private rooms (§8.6).
3. Untimed unranked human queue (accessibility, §9.9).
4. First Jade sink specification — triggered by §7.5 economy review.
5. Own-match replay viewer on the internal replay foundation (§8.10).
6. Upper-tier lobby openings per §7.1 criteria (ops action, not build).
7. WebGL2 effects layer (TD-2) and APAC region (TD-3) as telemetry warrants.
8. Cosmetic pipeline scale-up per §2.8 hypothesis (content program, not engineering).

**Explicitly not planned (spec non-goals §2.4):** monetization of any kind, native apps, HK/Riichi playable modules (extension contracts honored in E1's module boundaries per §14.1), spectator/replay public features, clubs, tournaments, open chat.
