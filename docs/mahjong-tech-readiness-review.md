# Technical Specification Readiness Review — Mahjong

- Reviewed corpus: [`mahjong-product-specification.md`](mahjong-product-specification.md) v1.1 (behavioral/product spec), [`mahjong-development-plan.md`](mahjong-development-plan.md) v1.1 (architecture, WBS, phases, decisions D1–D12), [`mahjong-spec-review.md`](mahjong-spec-review.md) (design review, incorporated)
- Review date: 2026-07-17
- Disposition (2026-07-17): Must-fix items 1 and 5 applied — F-1 reconciled through the dev plan (Step 8, Step 9, WBS E4.F1/E12.F1/E13.F3/E14.F1); F-2, F-3, and the D10 good-standing absorption shipped as spec v1.2 (§16.5). Items 2–4 and 6 remain scheduled as first-work-package deliverables.
- Reviewer stance: Principal Architect / Staff Engineer / EM / TPM, pre-implementation gate
- Scope note: product quality is out of scope (already reviewed and incorporated). This review asks one question: **can engineering begin coding today with minimal ambiguity?**

---

## Final verdict (up front)

**Readiness score: 74 / 100.**

**🟡 Ready After Minor Updates — with a phase-scoped answer:**

- **Yes, coding can begin today** on Phase 0 (foundations) and the rules engine (E1). The rules documentation (§5–§7) is the most implementation-ready part of the corpus: exhaustive behavior, exact formulas, worked examples that double as test vectors, and enumerated edge cases. An engineer or coding agent can build and certify the rules engine from the spec alone.
- **No, coding must not begin** on the API layer, match runtime, meta services, or client screens until seven named artifacts exist — and here is the critical nuance: **five of the seven are already scheduled Phase 0–1 deliverables in the dev plan.** The corpus is missing a technical-specification layer (protocol catalog, API schemas, DDL, state charts) *by design*, with the work items that produce it sequenced before the code that needs it. The remaining two are genuine defects found by this review: a D4-propagation inconsistency inside the dev plan, and a handful of spec-level undefined behaviors listed below.

The plan's phase order is exactly what makes this a 🟡 rather than a 🟠: nothing currently unspecified is upstream of the work that is allowed to start.

---

## 1. Overall readiness

| Area | Score /100 | Basis |
| --- | ---: | --- |
| Rules/gameplay behavior (§5–§7) | 92 | Near-formal; worked examples; v1.1 closed the known edge cases |
| Economy behavior (§7) | 90 | Double-entry semantics, cap math, examples reproduce exactly |
| Ops/security/privacy posture (§10, §15) | 85 | Concrete targets, retention tables, control lists |
| Architecture & boundaries (plan Step 2) | 75 | Sound shape; AGS boundary conditional on unexecuted spike |
| Testing strategy (plan Step 11) | 80 | Layered, gate-driven; fixture schema not yet defined |
| Internal consistency | 68 | D4 propagated to Step 2.2 but **not** Step 8/9 or four WBS rows (finding F-1) |
| API & protocol specification | 45 | Endpoint names exist; zero schemas, no message catalog, no error registry |
| Database design | 55 | Entity lists + partial indexes; only the ledger approaches DDL fidelity |
| State-machine formalization | 60 | Complete in prose; no normative transition table; v1.1 offer states unformalized |
| Frontend implementability | 50 | Per-screen requirements exist; zero wireframes (acknowledged gate E7.F5) |

Organization and clarity are excellent: stable IDs, section cross-references, change registers, decision register D1–D12 with flagged deviations. The corpus reads as one coherent system. Its weakness is uniform: everything *behavioral* is specified to test-vector fidelity; everything *interface-shaped* (payloads, schemas, message types) is named but not defined.

## 2. Functional completeness

Verified feature-by-feature against the WBS: every feature has purpose, behavior, dependencies, and acceptance criteria; §9.8 mandates error states with stable codes; §8.1 defines the tutorial to string-ID granularity. Failure behavior is unusually complete (§8.7–§8.8 cover disconnect/void/abnormal termination exhaustively).

**Undefined behaviors found (spec-level):**

- **F-2 (Must fix): "Animation time is not charged" (§5.10) has no server mechanism.** The server computes one absolute deadline, but nothing defines how it accounts for client-side animation before an action is available. Needs a rule, e.g.: deadline = server dispatch time + fixed per-action animation allowance (from a config table) + base time; allowance values are part of the protocol spec. Without this, timer implementations will diverge and the "not charged" promise is untestable.
- **F-3 (Must fix): leaderboard region source undefined.** §12.8 pins region to "the account's supported country at season start" — determined how? IP geolocation at season boundary? Account market selection at signup? This decides schema and privacy handling. Recommend: market recorded at account creation (from the invite/market gate), support-correctable, never IP-derived on the fly.
- **F-4 (Should fix): welfare top-up vs active reserve (§7.5).** "Sets the balance to 1,000" while a debit-cap reserve is outstanding is undefined (can a player in-match claim welfare? Is the top-up computed on balance or available balance?). Recommend: claimable only with no active reserve; computed on ledger balance.
- **F-5 (Should fix): dealer Ting reveal scope (§5.11, §8.10).** "East reveals" — the full concealed hand, or the Ting status plus waits? History references "the required dealer Ting reveal" without defining its payload. Recommend: full concealed hand at that terminal event (matches table practice), stated explicitly.
- **F-6 (Should fix): "avoided when population permits" (blocks/recent opponents, §8.5/§10.6) has no relaxation rule.** The plan requires "constraint relaxation order deterministic + logged" (E6.F2) but no order or time thresholds are defined anywhere. These are config values that must exist before matchmaking coding.
- F-7 (Later): season reset "between matches" vs a player standing in queue at the boundary; age-gate timezone basis; exact idempotency-key retention window (see §8 below).

## 3. Technical architecture

Sound: server-authoritative match actors, pure rules library, double-entry ledger, per-seat projection as the single egress path, AGS behind Go ports with declared first-party fallbacks. No circular dependencies in the WBS graph (checked: E-graph is a DAG; E12.F1↔E6.F2 is one-directional). Module ownership is explicit.

**Findings:**

- **F-1 (Must fix — internal contradiction): D4 was only partially propagated through the dev plan.** Step 2.2's service table correctly shows AGS ownership, but: Step 8 still specifies first-party identity endpoints (`POST /guest`, `POST /auth/refresh`…) and a first-party Redis matchmaking loop; Step 9 still lists AGS-owned entities (`identity`, `device_credential`, `refresh_session`, `friendship`, `friend_request`) as Postgres tables; and WBS rows E4.F1, E12.F1, E13.F3, E14.F1 are still scoped/sized as full builds (E12.F1 at L). An implementer reading Step 8/9 would build what D4 outsourced. Fix: annotate these sections as *the first-party fallback design, activated per-service only if the P0 AGS spike fails that service*, and re-size the four WBS rows for integration.
- **F-8 (Must fix — unmade architectural decision on the critical path): APAC compute vs US durable append (D3).** E2.F1's core invariant (append-before-ack) conflicts with §15.5 ack latency if APAC matches commit synchronously to US storage (~130–180 ms RTT alone). The spike is correctly scheduled in P0, but the plan should state the decision criteria now: either (a) regional durable log in APAC with async US replication — requires confirming §2.7's "data stores in the US" tolerates transient regional durability buffers, a legal question, or (b) APAC matches accept degraded ack latency, or (c) APAC compute abandoned. This ADR blocks E2.F1 coding and has a legal dependency; it is the single highest-risk unknown in the plan.
- F-9 (Should fix): the WS gateway's session-validation relationship to AGS IAM (token exchange? gateway introspection? ticket-based WS auth?) is undefined — part of the protocol artifact.

## 4. Data models

The ledger (plan Step 6.3) is near-DDL and correct (append-only, UNIQUE idempotency, balanced-journal CHECK, reserve model). Everything else is entity-list level: no column types, nullability, FK actions, or partition DDL. That is acceptable *if* DDL is declared a per-module first task — currently implied, not stated.

Findings: F-1 (AGS-owned entities listed as ours, above); F-10 (Should fix): `match_summary` player-visible history needs an explicit column contract because §8.10 forbids concealed-hand leakage — deriving it ad hoc from `match_event` risks over-exposure; specify the projected fields. F-11 (Later): no explicit `schema_version`/event-payload-version columns named for `match_event` despite §1.3 requiring per-version interpretation — the requirement exists in prose; put the column in the DDL.

## 5. API design

**The largest pure-specification gap.** Step 8 provides endpoint names, auth posture, and defaults (rate limiting, error envelope by reference to §9.8) — but zero request/response schemas, no pagination contract, no filtering syntax, no API versioning scheme, no error-code registry (required by §9.8 but not yet enumerated), and no OpenAPI artifact. The WS protocol has a command envelope field list but no message catalog: the full set of client commands (discard, claim-response, sort is client-local?, emote, resume) and server events (state delta, claim window open/close, offer, settlement…) is undefined.

This is scheduled work (E0.F5 "Protocol package") — but E0.F5's acceptance criteria should be strengthened to name the deliverables explicitly: OpenAPI spec for REST, versioned WS message catalog, error-code registry, pagination/filtering conventions, config-value catalog. Coding E2/E7/E8/E9 before E0.F5 lands would be building on sand; the phase order already prevents this, but the gate should be explicit.

## 6. State management

Match flow states are behaviorally complete in §5 prose and §5.10–§5.11 tables, and the plan wisely declares the E1.F4 state machine the single source of truth for UI transitions. **But no normative state chart exists** — states like `AwaitingDraw`, `ReplacementChain`, `ClaimWindow`, `OfferPending` (the v1.1 Eight Flowers/Heavenly offers add states and re-entry arcs), `Settling`, `Void` are implied, never enumerated with their transition triggers and timeout edges. **F-12 (Must fix): author the state chart as E1.F4's first artifact and make it normative** — it becomes the test oracle for the golden suite and the generator for client UI states. Recovery (reconnect, takeover, void) and cancellation (queue, discard-until-ack) are well defined in prose. Client-side meta-screen states are covered at requirement level in plan Step 7.

## 7. Error handling

Strong framework: §9.8 enumerates required error states with stable codes, retries, and support paths; §8.8 covers partial failures (reserve release, compensating transactions, incomplete matches); duplicate requests are handled by idempotency keys everywhere that matters. Gaps: the error-code registry itself doesn't exist (part of E0.F5); **F-13 (Should fix): client command retry policy is unspecified** — idempotency tokens make retries safe, but nothing defines when the client retries an un-acked command vs escalating to resync (recommend: one retry after 2 s, then resync-by-version); AGS outage behavior per service (degrade vs block) is not specified — should fall out of the P0 spike as a per-service availability contract.

## 8. Concurrency and race conditions

Well-designed at the model level: per-match actor serializes all gameplay (eliminates in-match races); `expected_state_version` gives optimistic concurrency; claim privacy + simultaneous-deadline resolution avoids reveal races; ledger journal transactionality + idempotency handles concurrent settlement; reservation accept is a documented handshake. Verified race pairs: claim-revision vs deadline (server deadline wins — specified); second-device resume vs active session (revocation specified); welfare vs concurrent settlement (**F-4** — unspecified, above); mail Claim All vs individual claim (idempotent — safe); rating season reset vs match completion ("between matches only" — safe, F-7 queue-boundary nit). **F-14 (Should fix): specify idempotency-key retention** (recommend: 24 h for command keys, permanent for ledger journal keys — the latter is implied by the UNIQUE constraint, make it explicit). No deadlock-prone multi-entity transaction patterns detected in the design as written.

## 9. Security review

Posture is strong and unusually specific for this stage (§15.8–§15.10): server authority, hidden-info isolation with test mandate, ASVS L2 mapping, token lifetimes, admin MFA/RBAC, no-secrets-in-logs, two-person production controls with a documented solo adaptation. Gaps, all specification-level: **F-9** WS authentication mechanism undefined; **F-15 (Should fix): magic-link token handling design** (store only a hash of the token, single-use enforcement under concurrent redemption, binding to requesting session) is unwritten — it's a small doc but it's authentication code, which should never be improvised; AGS token lifetimes/revocation must be *verified* to meet §15.10 (in the spike checklist — good); no written threat model (Later — the controls exist, the document doesn't); replay protection is specified (action IDs + idempotency + deadline rejection).

## 10–11. Performance and scalability

Budgets are concrete and testable (§15.5–§15.6), and the scale ceiling (2,500 CCU / 750 matches) makes almost everything trivially sizeable — the actor model, queue loops, and leaderboard refresh are orders of magnitude below interesting scale. Real bottleneck candidates, in order: (1) **F-8** APAC→US durable-write latency — the one place physics may beat the targets; (2) DOM rendering of a full table on low-end mobile — budgeted (§15.6) but **unverifiable until D9's phone tier arrives**, meaning perf discovery is deferred to WP15, late; recommend pulling one physical Android phone forward to P2 (cheap risk reduction); (3) 1M-sim CI wall-time — Go core (D1) makes the <60 min target credible; (4) wait-set computation p99 ≤ 5 ms — feasible with the specified memoization. Horizontal scaling: stateless modules + consistent-hash match placement + drain deploys are specified; no queueing/event-bus layer exists between match events and consumers (progression/analytics read the event log — pull-based projection is specified implicitly; **F-16 (Later): name the projection mechanism** — outbox poll vs CDC — before E11 coding).

## 12. Reliability

Specified: RPO/RTO targets, snapshot cadence, append-before-ack, backup/restore drills, one-version rollback, maintenance drill, drain deploys, compensation policy. Missing: **F-17 (Should fix): explicit backoff policies and circuit-breaker behavior for AGS and email-provider calls** (per-service timeout/retry/backoff table — five lines each, but they must exist before integration coding); failover posture is single-US-data-region by decision (risk-accepted, R-I1) with APAC drain behavior named but not detailed — fold into the F-8 ADR.

## 13. Observability

Strong: OTel from day 1 (E0.F4), dashboards-as-code, §15.5 histograms on day 1, §2.5 gate dashboards as acceptance deliverables, named health dashboards (§15.2), immutable admin audit log, analytics with consent gating and field allowlists. Missing: alert catalog with thresholds/severities (only two paging conditions are named — ledger conservation, reserve leak); health/readiness endpoint conventions for the match service (drain-aware readiness matters for deploys). Both are Should-fix, small.

## 14. Frontend readiness

Requirements per screen are complete (plan Step 7: states, a11y, telemetry, error/empty/loading), the design system and a11y runtime are scoped, and the 360×640 validation gate (E7.F5) is correctly sequenced before table hardening. **But zero wireframes exist** — layout, visual hierarchy, and component composition for the match table, claim window, and tally screen are entirely undesigned. This is acknowledged (the plan says "not ready for UI implementation") and gated. It blocks E8 coding, not Phase 0–1. Keyboard support, localization expansion, and responsive rules are specified. Frontend can start: shell, design tokens, i18n runtime, WS client — all spec'd well enough today.

## 15. Backend readiness

Per-service responsibilities, persistence, validation, and scale notes exist (Step 8) with the F-1 caveat. Background jobs are named across the corpus (guest deletion, retention/partition drops, reconciliation, anti-abuse batches, leaderboard refresh, welfare reset, mission reset, season lifecycle) — **F-18 (Should fix): collect them into one scheduled-jobs table** (cadence, idempotency, failure alerting) so none is forgotten; today they're scattered across six sections. Configuration: §13.4 defines the change-control contract but there is **no consolidated config-value catalog** (every timer, limit, cap, threshold, cooldown with default + bounds + flag class) — this is the single most cost-effective document to add (F-19, Must fix as part of E0.F5) because dozens of numeric values currently live inline in prose across two documents and *will* drift.

## 16. Testing readiness

The strongest non-rules area: layered strategy with named suites, property invariants, golden-case governance ("every rules bug becomes a golden"), release gates (500 goldens, 1M sim, calibration bands), traceability matrix as a CI artifact, netem profiles, chaos drills, and per-feature acceptance criteria throughout the WBS. Two gaps: the golden-fixture schema doesn't exist yet (correctly the first E1 task — make it explicitly so, F-20 Must fix ordering note); §7.4/§12.4 worked examples should be mechanically extracted into fixtures rather than re-transcribed (transcription is where scoring bugs will sneak in).

## 17. DevOps readiness

Specified: trunk-based flow, CI gates per stage, IaC-from-zero acceptance, drain deploys, one-action rollback, secrets vault, flag strategy, environment triad. Adequate for Phase 0 start. Missing (all Should fix, non-blocking): environment variable/secret inventory per service; artifact versioning scheme tying client version ↔ protocol version ↔ rules version (the three-way compatibility rule exists in prose — §13.4 minimum-version config — but the versioning scheme itself is undefined); AGS environment provisioning (namespaces, staging vs prod separation) folded into the P0 spike.

## 18. Documentation quality

Could another engineer implement without repeatedly asking questions? **For the rules engine: yes, genuinely.** For everything else: they would ask exactly the questions this review lists — which is a good sign (the gaps are enumerable, not diffuse). Strengths: stable IDs, decision register with flagged deviations, contradiction registers, spec§↔plan cross-referencing. Defects: **F-1** (the one true contradiction); duplication risk — timer values, retention numbers, and limits appear verbatim in both spec and plan (the config catalog F-19 fixes this by making both reference one table); no sequence diagrams for the three hardest flows (claim window, reconnect, reservation handshake) — worth adding to the protocol doc (Later); terminology is defined (§4) and used consistently.

## 19. Missing specifications (consolidated)

Config catalog (F-19) · error-code registry (E0.F5) · WS message catalog (E0.F5) · API schemas/OpenAPI (E0.F5) · normative state chart (F-12) · DDL per module (declare as first module task) · scheduled-jobs table (F-18) · retry/backoff/circuit-breaker table (F-13/F-17) · idempotency retention (F-14) · animation-allowance mechanism (F-2) · leaderboard region source (F-3) · welfare/reserve interaction (F-4) · Ting-reveal payload (F-5) · matchmaking relaxation thresholds (F-6) · WS auth mechanism (F-9) · magic-link token design (F-15) · match_summary column contract (F-10) · event-version column (F-11) · projection mechanism (F-16) · alert catalog · client↔protocol↔rules versioning scheme · AGS per-service outage contracts · analytics event schemas (E15.F1 scheduled). Permissions model: player-facing is implicit-by-ownership (adequate); admin RBAC roles are named with action catalogs (adequate); AGS-side permission mapping goes in the spike.

## 20. Implementation risk assessment

| # | Risk | Severity | Prob. | Impact | Mitigation |
| --- | --- | --- | --- | --- | --- |
| IR-1 | F-8: APAC/US durability decision breaks either latency targets or §2.7 residency | Critical | Med | Architecture rework of E2.F1 if decided late | ADR with legal input in P0, before any E2 code; criteria written now |
| IR-2 | F-1: partially-propagated D4 causes an implementer (human or AI agent) to build AGS-duplicated services from Step 8/9 | High | High (verbatim reading is how agents work) | Wasted build + integration conflicts | Fix the doc now (1–2 h); label fallback designs explicitly |
| IR-3 | Protocol/API layer coded ad hoc because E0.F5 lacks named deliverables | High | Med | Drift, rework across client/server | Strengthen E0.F5 acceptance criteria (F-19 list); make it a hard gate for E2/E7 |
| IR-4 | State machine implemented from prose without a normative chart; v1.1 offer states diverge between engine, client, and tests | High | Med | Rules defects of exactly the class §2.5 gates on | F-12: chart first, tests generated from it |
| IR-5 | AGS capability gaps discovered late (after dependent module coding) | High | Med | Re-activation of first-party fallbacks mid-phase | Spike is P0-gated (already); add per-service go/no-go record as spike output |
| IR-6 | Mobile perf/lifecycle issues surface at WP15 due to D9 phone deferral | Medium | High | Late rework of table rendering/socket handling | Pull one Android device to P2; emulator soaks meanwhile |
| IR-7 | Numeric values drift between spec, plan, and code (no config catalog) | Medium | High | Subtle behavioral bugs, audit failures | F-19 catalog, both docs reference it |
| IR-8 | Solo review (D2) misses a rules/economy defect that paired review would catch | Medium | Med | S0/S1 in Beta, gate-clock resets | Existing controls (AI review, cooling-off, goldens); accept residual |

---

## Coding readiness checklist

| Item | Status | Note |
| --- | --- | --- |
| Every feature defined | ✅ | WBS + spec behavior complete |
| Every API specified | ❌ | Names only; E0.F5 must produce schemas |
| Every data model specified | 🟡 | Ledger near-DDL; rest entity-level; F-1 contamination |
| Every state transition defined | 🟡 | Complete in prose; no normative chart (F-12) |
| Every error case specified | 🟡 | Framework + states yes; code registry pending |
| Every validation rule defined | 🟡 | Gameplay: yes (server legality). Input/API-level: pending schemas |
| Every acceptance criterion defined | ✅ | Per WBS row + §16.1 traceability mandate |
| Every dependency identified | ✅ | WBS dep columns; DAG verified |
| Every configuration value defined | ❌ | Values exist inline; no catalog (F-19) |
| Every integration point defined | 🟡 | AGS ports named; contracts await P0 spike |
| Every external dependency identified | ✅ | Plan Step 15 list incl. runtime-critical AGS |
| Every permission model defined | 🟡 | Player + admin adequate; AGS mapping pending |
| Every telemetry requirement defined | ✅ | §15.2 + named dashboards; schemas scheduled |

---

## Prioritized action items

### Must fix before coding (the blocker list — ~3–5 days of specification work, none of it blocking Phase 0 setup tasks which can start in parallel today)

1. **F-1 — Reconcile D4 through the dev plan** (Step 8, Step 9, WBS E4.F1/E12.F1/E13.F3/E14.F1). *Why:* verbatim readers — especially coding agents — will build outsourced services. *Change:* mark those sections "first-party fallback design; activate per service only on spike failure," re-size the four rows. *Impact:* prevents the largest class of wasted implementation.
2. **F-8 — Write the APAC/US durability ADR criteria now; decide in P0 with legal input.** *Why:* it shapes E2.F1's core write path and has a §2.7 compliance dimension. *Impact:* removes the plan's highest-variance unknown before match-runtime code exists.
3. **F-12 — Author the normative match state chart** (including v1.1 offer/lapse states) as E1.F4's first artifact. *Why:* it is the shared oracle for engine, client, and golden suite. *Impact:* converts the likeliest rules-defect class into a generation problem.
4. **F-19 — Create the config-value catalog and strengthen E0.F5's deliverables** (OpenAPI, WS message catalog, error-code registry, pagination conventions, versioning scheme). *Why:* every later workstream consumes these; inline numbers drift. *Impact:* single biggest ambiguity reduction per hour spent.
5. **F-2, F-3 — Close the two spec-level undefined behaviors** (animation-allowance mechanism; leaderboard region source) with one-paragraph spec amendments. *Why:* both are implementation-blocking for their features and cheap to decide now.
6. **F-20 — Golden-fixture schema as the literal first E1 task**, with §7.4/§12.4 examples mechanically extracted, not re-typed.

### Should fix soon (before the consuming feature starts)

7. F-4 welfare/reserve rule · F-5 Ting-reveal payload · F-6 matchmaking relaxation thresholds (before E5.F3 / E8.F5 / E6.F2 respectively).
8. F-9 WS auth + F-15 magic-link token design (before E7.F3 / E4.F3) — small security-design docs, reviewed under the D2 cooling-off control.
9. F-13/F-14/F-17 — client retry policy, idempotency retention, AGS/email backoff-and-breaker table (before E7.F3 / E2.F1 / any AGS port).
10. F-10/F-11 — `match_summary` column contract and event-version column in the first DDL pass.
11. F-18 — consolidated scheduled-jobs table; alert catalog with thresholds.
12. IR-6 — acquire one Android phone in P2 rather than WP15.

### Can improve later

13. Sequence diagrams for claim window, reconnect, and reservation handshake (add to the protocol doc as it forms).
14. Written threat model consolidating the existing §15.8–§15.10 controls.
15. F-16 event-projection mechanism note (before E11, which is P4+).
16. De-duplicate spec↔plan numeric values by referencing the F-19 catalog from both.
17. Per-service env/secret inventory as services materialize.

---

## Answer to the question

**Can engineering begin coding today?** Yes — on Phase 0 and the rules engine, immediately and with high confidence; the spec behind E1 is as close to executable as prose gets. The seven Must-fix items above are roughly a week of specification work, five of which the plan already scheduled; do items 1, 5 (pure document fixes) today, run items 2–4 and 6 as the first work-package's deliverables alongside repo setup, and no workstream ever waits on a missing specification. What this corpus is *not* is a complete tech spec for the full system — it is a complete behavioral spec plus a plan that correctly sequences the remaining technical specification as engineering work. That is a legitimate and, for a solo-plus-agents team, arguably optimal structure — provided the gates named here are enforced rather than skipped in the excitement of building.
