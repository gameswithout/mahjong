# Achievements & My Mahjong Journey — implementation record

Source: [Approved implementation brief](achievements-journey-brief.md), supplied 2026-10-20. This work implements **Phase 1: Journey UI Foundation**, plus read integration with the existing progression, statistics, and Founder entitlement services. It does not claim completion of all four phases or all end-to-end acceptance criteria.

## Phase 1 delivered

- The existing Journey component remains the owner-facing hub in the main menu's folder-tab panel. It also supports a standalone view. The active game table stays separate and ad-free.
- Overview: existing three-tile identity, display name, Legacy Level / server XP progress, current Prestige, rotation count, next Prestige, and latest recorded milestone. Skill has a separate visual treatment and honest unavailable states; no default Elo or tier is manufactured.
- Four configurable provisional Chronicle stages replace one distinct room per Prestige threshold. Mapping uses server-provided milestone indices: first milestone → First Seat; second → Familiar Table; fourth → Veteran's Room; seventh → Living Legend. This is a design assumption, not finalized product tuning. Chapter artwork remains CSS placeholders. Previously earned chapters remain viewable; none is purchasable.
- Collections: Legacy (Games Played, Anniversaries, Community), Skill, and Highlights. Approved participation milestones derive from the authoritative rotation projection. All cards include status, explanation, and detail disclosure. Dates appear only when present in supported records. Verified referral counts are unavailable, not zero. Candidate Skill achievements appear only in a disclosure labelled proposed/not active, never as unlocked or reward-bearing. No new winning-pattern detection or rarity estimate was introduced.
- Anniversaries: server-projected annual badges, approved material schedule through year 60, next calendar date, and explicit UTC / February 28 leap-day policy. Cosmetic eligibility is not ownership or proof of delivery. No browser award or claim endpoint exists.
- Records: authoritative completed rotations, completed hands, and best Tai when supported. Missing rating, peak, and tier records use a dash. Individual hands cannot advance Prestige.
- Timeline: dated anniversaries and first completed rotation only. Dates are not guessed for older Prestige unlocks. No client clock creates earned events.
- Collection: the existing authenticated Founder Pack entitlement is the only connected cosmetic ownership source. An absent general inventory is not represented as an empty, complete inventory. Filters cover type/source for available items; there are no purchases in Journey. Existing gameplay identity customization opens the existing profile editor.
- Showcase: owner-only, unsaved preview with temporary configurable capacity of three. Any owned compatible item can be selected regardless of source, independently of gameplay equipment. Unknown/unowned/incompatible items and excess selections are rejected and revalidated at preview time. These browser checks are UX safeguards, not a replacement for future server authorization.
- Public profile: private, read-only preview with identity, earned Chronicle, and selected owned cosmetics. No public URL, sharing, comments, reactions, gifts, or guestbook. The preview projection explicitly excludes account IDs, wallet values, email, and private match data.
- Loading, unavailable, error/retry, first-rotation/empty, locked, and populated states. Design fixtures are isolated under `client/fixtures/`, imported only by evidence entrypoints; each evidence page labels sample data. Production imports no fixture data.

## Existing authoritative foundation retained

`pkg/storage/journey.go` reads each naturally completed rotation container once using an `EXISTS` participant query. It has no mode, bot, placement, win, or XP filter. Time-limit and unfinished rotations are excluded. Repeated reads cannot credit again because this projection does not increment a counter. The first completion date comes from committed rotation records.

`pkg/progression/journey.go` supplies editable Prestige defaults and automatic UTC calendar anniversaries. Existing progression persistence has unique XP award/reward keys and repeated-projection tests; this phase adds no grant path. Anniversary cosmetic codes identify eligibility, not persisted inventory grants.

## Specification reconciliation

| Area | Current treatment / remaining decision |
| --- | --- |
| Prestige titles and thresholds | Earlier owner instruction approved seven values as editable defaults. The new brief calls final values proposed; defaults remain provisional and labelled, rather than being frozen. |
| Chronicle mapping | Four stage presentation follows the new brief. Its index mapping is isolated in `journey-model.ts` and documented above. |
| Legacy XP | Existing server Alpha XP/level data is displayed as provisional. No browser curve or speculative awards were added. Phase 2 must make service award/curve definitions configurable and reconcile historical XP. |
| Existing §12.3 catalog | Its 32 older achievements and reward values are not imported into the new approved collections. The service still contains the old award pipeline; migrating/disabling old definitions requires a versioned Phase 2 service change. This phase does not approve them or add new triggers. |
| Skill thresholds | No settlement-owned Elo API exists. Starting Elo 1200, K=24, pairwise four-player calculation remain requirements, not fabricated player values. Tier boundaries and promotion rewards remain proposed. Ranked entry remains disabled. |
| Anniversaries | Read-side eligibility exists; permanent inventory grants and next-visit celebration delivery require the event/inventory service. No items are synthesized from `cosmetic_code`. |
| Profile equipment | Current three-tile profile is a local identity preference, with Founder entitlement gating. It is not a general server-owned equipment/showcase implementation. |

## Remaining phases / dependencies

### Phase 2 — authoritative progression integration

- Versioned achievement definitions with approved/proposed status, eligibility, unlock timestamps, authoritative source match IDs, human/Bot provenance, and idempotent reward-grant ledger.
- Configurable Legacy XP curve/awards and migration of the earlier Alpha definitions without revoking existing ownership.
- Authoritative Ranked settlement and current/peak Elo / tier projection. No seasonal resets.
- Verified referral attribution and guest-to-email account conversion continuity, unique-new-account validation, self-referral prevention, and idempotent Friend Tile grant. No referral gameplay gate or Jade payout.
- Explicit historical backfill and guest identity-linking tests against real service persistence. No new account-keyed Journey data was introduced by Phase 1, but end-to-end conversion preservation is not newly certified here.

### Phase 3 — public profile / collection persistence

- Authenticated inventory listing across acquisition sources; equipment and showcase writes validated server-side against ownership and compatible display types.
- A configurable showcase slot contract, independent from Prestige. Browser draft selection must not become authoritative implicitly.
- Public-safe profile endpoint with opaque public handles and visibility settings. Visitor access to Chronicle and approved cosmetics requires this service; owner preview does not satisfy visitor access acceptance criteria.
- Persist selected earned title and Chronicle presentation; validate stage unlocks on writes. Current UI displays the latest earned title by default but does not claim persisted equipment.

### Phase 4 — events and celebrations

- Durable unlock/reward events, anniversary delivery/seen cursors, and deduplicated next-visit celebrations.
- Approved Highlight catalog, provenance-preserving game events, public-eligibility policy, and privacy-safe verified result links. No concealed hand or private identity leaks.

## Verification

- Client regressions cover progress from authoritative rotations, draft/candidate boundaries, no invented timestamps/ownership, leap-day dates, loading/error/empty states, collection navigation, showcase capacity/ownership/source independence, private preview field allowlisting, and production menu integration.
- Go regressions cover existing exactly-once XP/achievement projections and calendar eligibility; the added anniversary test covers all nine material milestones and inactive players through year 60.
- Existing database integration tests (`-tags=integration`) cover natural completion filters and repeat Journey reads, idempotent XP, and monotonic reward persistence. They require a configured PostgreSQL test database and are separate from ordinary `make test`; do not treat a skipped integration suite as execution evidence.
- UI evidence: `/journey-evidence.html` offers populated, empty, loading, error/retry, and unavailable samples; `?games=0`, `?games=12`, `?games=5000` exercise Prestige states. `/neo-evidence.html` shows the same Journey embedded in the current menu.

### Execution results for this phase

- `make test`: passed (root Go vet/race tests, bots simulations, match-service vet/race tests, 620 client tests).
- `npm run build`: passed.
- `npm run evidence:bundle` and `npm run evidence:ui`: passed; the UI gate generated `.artifacts/ui-evidence`.
- Additional focused progression/replay and showcase tests passed.
- Manually checked desktop and 390 px phone layouts, collection switching, private showcase preview, empty/loading states, error/retry, and unchanged earned Chronicle stage when viewing older chapters.
- PostgreSQL integration-tag suites were not executed in this phase. Persisted public profiles, referral grants, anniversary cosmetic delivery, and verified Highlight publication remain future service work as listed above.

## Layout revision — owner feedback, 2026-10-20

These refinements supersede the original Phase 1 placement above:

- Top-level folder tabs are now **My Journey · Inventory · Chronicle · Friends / Party · Store**. My Journey remains the default. The tab strip scrolls horizontally on narrow screens.
- Inventory holds owned cosmetic browsing, type/source filters, collection refresh, and entry to the existing gameplay profile editor. It contains no public showcase controls.
- Chronicle holds My Mahjong Home, earned chapter browsing, identity customization, cosmetic showcase choices, and the owner-only public preview. A shared, unsaved draft survives switching between tabs; equipment remains independent. Public publishing and saving still require future APIs.
- My Journey overview uses three equal peer cards: Prestige, Legacy, Skill. Each has exactly the same header, KPI/unit, highlight, and explanation structure. The player name/three-tile badge is removed from this scoreboard; it remains in the global header and owner profile preview.
- Missing Journey support and first-run zero rotations get the welcoming “Your Journey is just beginning” message. Unknown KPIs remain dashes. Actual retrieval failures retain a brief saved-progress warning and retry, rather than pretending a returning player has zero progress.
- Years at the table uses a compact infinity-mark membership tag plus elapsed years, member-since year, and next anniversary date. No sixty-year ladder is displayed. Only the latest earned annual badge appears in the Legacy collection.
- Visual reference: the small lifetime membership tag in the owner's Marriott screenshot and [Marriott's lifetime status presentation](https://www.marriott.com/loyalty/member-benefits/lifetime-status.mi). Marriott's eligibility rules, annual qualification, tiers, logos, and benefits are not adopted. Mahjong copy such as “Lifetime Wood Member” is provisional presentation of an already eligible material anniversary, not a new title grant or competitive tier. The approved anniversary schedule and UTC/leap-day calculation are unchanged.

Revision verification: production build and all 621 client tests passed. Regressions cover the five-tab navigation, separate Inventory/Chronicle content, equal scorecard structure, missing-versus-zero progress, compact earned lifetime recognition, and showcase draft preservation between tabs. Desktop UI review confirmed the small infinity tag follows the supplied reference's visual hierarchy.

### Journey simplification and local progression simulation

Removed the beginning banner, shared next-step row, and years-at-table presentation. Refresh is an accessible circular-arrow button in the Journey header. Prestige is explicitly the completed-rotation milestone subset of Legacy; Highlights remain memorable hands. Each scorecard exposes its own next target.

Game-mode Developer Tools simulate a full Unranked or Ranked rotation as Win/Loss. State is memory-only and starts at zero independently of account records. Both outcomes earn a draft 100 XP; Ranked previews start at 1200 Elo and change ±25. These are interface tuning defaults, not settlement rules. Exit/reset or launching real matchmaking discards the simulation. No service mutation is made. Named placeholder tiles unlock at Prestige milestones, the current achieved Legacy level, and first Ranked victory; they can be equipped in three preview profile slots without saving to the account. Reload also resets all simulation state.

### Current engagement hierarchy

The Journey overview now presents the three independent dimensions Legacy, Skill, and Highlights. Legacy contains Games Played (progressive Prestige and Living Chronicle), Anniversaries, and Community. Prestige is not a fourth dimension. The XP-based Legacy Level display and simulated level-tile rewards have been removed; historical server XP fields are preserved without presenting them as the new Legacy model. Highlight data remains unavailable until verified records exist, and Win/Loss simulation does not invent extraordinary hands. Annual badges remain in the Legacy collection without restoring the removed years-at-table section or future anniversary ladder.

### Random Highlight simulation

The approved brief defines example categories but leaves the precise catalog, thresholds, and rarity undefined. The simulator now uses five provisional examples: Self Draw, Exceptional Tai, Personal Tai Best, Rare Winning Hand, and Special Taiwanese Pattern. Each simulated rotation has a 60% chance of one uniformly selected sample event; these probabilities are UI test tuning, not real rarity or eligibility. A rotation loss can still contain a winning hand. Events retain sample rotation number, mode, and explicitly simulated human/Bot composition. The overview counts distinct achievements; collection cards count repeated events. Each distinct sample achievement unlocks one named placeholder profile tile. Exit/reset clears all events and rewards; no verified match records, eligibility logic, or server grants are created.

### Match History and menu naming

The overview's Recent Milestones section is replaced by a responsive Match History table, sorted newest first and limited to ten rows. Account history uses the existing authenticated history endpoint; it may contain individual hands, so the UI explicitly distinguishes recorded matches from full rotations counted for Prestige. Loading and error states include a history-specific retry. The persistent refresh arrow is removed; Journey retrieval errors retain Retry.

Every simulated Highlight now carries its exact sample match ID. Each event links to match details, including events older than the ten visible rows. Details retain outcome, mode, and associated sample Highlights. Simulated match Tai is not modeled. Authoritative Highlight records remain an API gap; no verified Highlight is fabricated.

Main-menu tabs are Journey and Party (including existing friends management). The display name Casual replaces Unranked; protocol mode identifiers and matchmaking endpoints remain unchanged. Casual describes solo or party entry with Bot fallback; Ranked describes solo competition against three humans.

### History paging and consistent simulation summaries

Match History starts with the newest ten records, with labelled Newer/Older arrow buttons to browse ten at a time. Boundaries disable their arrows; a newly added latest record returns the table to page one. The counter states the number of loaded records. Real history currently fetches the latest 30 records from the existing service; this UI does not imply access to older records outside that response.

The wins/games summary follows simulated match outcomes while simulation is active and restores the account summary on exit. Clicking the simulation summary returns to the local history rather than opening real account statistics. Simulated Tai now uses generated sample values from 1–16 (Exceptional Tai samples at least 12). This replaces the earlier zero-value placeholder; values represent an illustrative hand in a rotation and do not imply verified scoring, final Highlight thresholds, or the rotation's overall result.
