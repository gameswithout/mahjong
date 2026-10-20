# Chapter 2 — Game Modes: Implementation and Acceptance

Source: [User Engagement Model v1.7, Chapter 2](user-engagement-model.md). Source imported 2026-10-19 from the Product Owner's Google Doc. Implement **2.1 before 2.2**. Preserve the Journey implementation already started. Existing client modes and server assumptions are placeholders; they do not override this document.

## 2.1 Unranked — Accessible and Social Mahjong

### Required player behavior

- One unified Unranked queue accepts parties of 1–4 humans.
- A solo player can queue directly; friends join a party through a shareable link, including as guests.
- Four-human parties start immediately. Smaller parties search for additional humans before remaining seats are filled with bots.
- Every table has exactly four seats; never strand a smaller party because four humans cannot be found.
- Players can rematch together after a completed dealer rotation.
- No Jade stake and no Elo changes. Completed gameplay earns Legacy XP and personal achievements; XP amounts belong to Chapter 6.
- Persist composition as all-human, mixed humans/bots, or one human/three bots. Keep this provenance available to achievements and future leaderboards.
- Guided bot play and tutorials are supported within Unranked. Remove the separate top-level Practice entry when the unified flow is functional; preserve its useful guided-play/persona functionality.

### Work map

| Area | Existing implementation to replace or reuse | Required change |
| --- | --- | --- |
| Lobby and entry | `client/App.tsx`, `client/PracticeLaunchCard.tsx` | One Unranked entry; guided learning belongs inside it; remove old one-hand/staked split when replaced |
| Party and invitation | `client/party.ts`, `client/session.ts` | Guest-capable shareable party link, party roster, leader start, immediate full-party start |
| Queue | `client/matchmaking.ts`, `client/staked-matchmaking.ts` | Unranked never calls Jade reserve; queue smaller parties as a group; server-owned fallback timing and cancellation |
| Session authority | `mahjong-match-service/pkg/session/` | Explicit Unranked identity; distinguish authorized bot fill from Ranked; freeze roster when match starts |
| Runtime | `mahjong-match-service/pkg/match/rotation.go`, `runtime.go` | Full rotation with 1–4 humans and remaining bot seats; stable membership; rematch to a fresh rotation with consenting players |
| Results/provenance | `protocol/envelope.ts`, service proto, storage | Authoritative mode and composition metadata, separately from temporary disconnect takeover |
| Rewards | Existing progression paths | Unranked eligibility independent of bot presence; do not use `isPracticeMatch()` as the economic/progression mode definition |

### Acceptance scenarios

- Solo, two-human, and three-human parties each search for humans, then can start with enough bots to make four seats.
- A full party starts without waiting for external humans or reserving Jade.
- A guest joins a shared link, remains with the inviter, and can play without upgrading their account.
- A match found concurrently with fallback or cancellation produces only one authoritative active match; no duplicate roster or orphan ticket.
- A disconnect takeover does not rewrite the match's original composition provenance.
- A completed rotation offers rematch to the same group, with fresh match identity and a fresh wall. Declining or disconnected players cannot be silently re-enrolled.
- Unranked leaves Jade and Elo unchanged and records completion/provenance for later progression chapters.

### Open source decisions

Human-only preference and human-search timeout are explicitly open. Keep the timeout configurable; obtain a launch default before enabling fallback in the live service. Do not invent a human-only option as an approved requirement.

## 2.2 Ranked — Competitive Mahjong

### Required player behavior

- Solo queue only; four independently matched human players; full dealer rotation.
- Guests are allowed subject to the specified account and eligibility rules. Guest status alone is not a reason to disable Ranked.
- Pairwise Elo uses pre-match ratings, initial rating 1200, K = 24, divisor 3, ties scoring 0.5.
- Current Elo and tier may decrease. Peak Elo, highest tier, and first-time promotions remain recorded permanently.
- No MVP Ranked seasons or Elo resets.
- Tier defaults are illustrative and configurable: Bronze <1000, Silver 1000–1199, Gold 1200–1399, Platinum 1400–1599, Diamond 1600–1799, Master ≥1800.
- First-time promotions may grant cosmetics; do not invent a reward catalog.

### Acceptance scenarios

- Party tickets and bot-filled initial rosters are rejected server-side for Ranked.
- Four equal-rating players in distinct places receive pairwise deltas +12, +4, −4, −12 before any integer rounding policy; a four-way tie receives zero.
- Each comparison uses the same pre-match snapshot; seat iteration order cannot alter the result.
- Tied final scores produce tied pairwise comparisons, independent of display order.
- Retry cannot apply a second Elo result or duplicate a first-promotion event.
- Lower later results update current standing without reducing historical peaks.
- Old season-reset or Quick Play ladder behavior does not become part of the replacement Ranked model.

### Chapter boundary

Jade entry stakes, forfeiture, disconnect grace, penalties, and server-void settlement are specified in **Chapter 3**, followed by **Chapter 4 Bamboo Recovery**. Implement those chapters next in order; do not label a Chapter 2-only build as a complete release-ready Ranked experience. Keep the full feature unavailable until its required entry and settlement policies are implemented.

## Progress and sequencing

- [x] Complete source imported with all chapter numbers preserved.
- [x] Chapter 2 requirements and acceptance scenarios recorded.
- [x] Artwork inventory established; provisional visuals explicitly marked.
- [x] Main menu simplified to Unranked and Ranked choices; existing controls preserved inside their panels with transition notices. This does not complete either mode runtime.
- [ ] 2.1 unified Unranked implementation and integration verification.
- [ ] 2.2 solo Ranked and Elo implementation and integration verification.
- [ ] Continue to Chapter 3, then Chapter 4 and later chapters in source order.

This checklist distinguishes source reconciliation from shipped functionality. Journey work remains in the working tree for later integration; it has not been undone.


## Solo Unranked update — 2026-10-19

Per the Product Owner, invitations are deferred. The menu now has one direct Play Unranked action, with no practice submenu or opponent picker. A dedicated Unranked human pool is searched for up to 10 seconds (editable client default); if no table is found, the client confirms ticket cancellation before opening a bot-filled session. With no dedicated pool configured, it starts bots directly. The old staked pool is never substituted.

Ticket polling errors and unconfirmed cancellation do not authorize bot fallback. A retained ticket is reused on retry to avoid duplicate queue entry. In source, explicit Unranked sessions run as full rotations and admit guests, while old ranked account gates remain separate. New runtime behavior requires deploying the updated match service; the current local browser smoke test verifies the existing deployed service can open a table with three bots, not a full-rotation completion.

Validation: actual local guest sign-in → Play Unranked → table with Stone Lion, Jade Dragon, and Swift Sparrow, all explicitly marked bots. Human matching is not live-tested because `ACCELBYTE_UNRANKED_MATCH_POOL` is not configured. Party start, party bot-fill coordination, and group rematches remain pending; they are not claimed by this solo implementation.

### Compact Ranked menu — 2026-10-19

Ranked now matches the direct Unranked card: title, one-sentence description, one Play Ranked button, and a brief status only when unavailable. The dropdown and nested Bamboo/Full Rotation choices are removed from the main menu. The legacy single-hand launcher remains inside Developer session tools for compatibility. The direct action uses the existing rotation queue and its current availability/account checks; this UI change does not implement the replacement Elo or stake policies.

Validation: 596 client tests and production build passed. Browser preview confirms two direct cards and no mode dropdown; Ranked shows a disabled action with an availability message when its queue is unconfigured. Artwork remains text-only placeholders in the existing register.
