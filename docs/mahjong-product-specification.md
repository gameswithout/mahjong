# Mahjong Product Specification

- Status: Planning-authoritative product baseline
- Version: 1.2
- Decision date: 2026-07-17 (v1.1: 2026-07-17; v1.0 baseline: 2026-07-13)
- Source PRD: [Mahjong Game Product Requirement Document.pdf](Mahjong%20Game%20Product%20Requirement%20Document.pdf)
- Resolved questionnaire: [Mahjong Product Specification Clarification Questionnaire](mahjong-product-spec-clarification-questionnaire.md)
- Incorporated design review: [Product Design & Specification Review](mahjong-spec-review.md), 2026-07-17

This document resolves the 151 clarification questions raised against the source PRD. It defines what the product must do and the acceptance bar for it. It intentionally does not define implementation tasks, architecture diagrams, staffing, estimates, sequencing, or a development plan. Version 1.1 additionally incorporates every accepted finding from the 2026-07-17 design review; Section 16.4 registers each change.

## 1. Decision status, authority, and source precedence

Resolves: SCP-07, GOV-01 through GOV-03, GOV-07, OPS-11, OPS-14.

### 1.1 Planning authority

The decisions in this document are authoritative for development planning unless the Product Owner records an explicit replacement decision in version control. A later decision must identify the affected requirement IDs, migration impact, effective rules version, and approver.

Required decision roles are:

| Area | Accountable role |
| --- | --- |
| Product scope and final tie-breaks | Product Owner |
| Taiwanese rules and scoring | Rules Lead, advised by a fluent Taiwanese 16-tile expert |
| Economy and progression | Systems/Economy Designer |
| UX and accessibility | UX Lead |
| Safety, privacy, and policy | Trust, Privacy, and Legal Lead |
| Reliability and security | Engineering Lead |
| Live configuration and content | Live Operations Lead |

Names may be assigned later, but the roles and approval boundaries are fixed. Product Owner breaks cross-discipline ties. Rules Lead has final authority over rules interpretation unless legal or platform policy requires a product change.

### 1.2 Source precedence

When sources conflict, use this order:

1. This product specification and its approved rules version.
2. Product-owned golden examples and automated acceptance fixtures.
3. The source PRD, except where this specification explicitly replaces it.
4. The GameTower Taiwanese 16-tile scoring reference for terminology and pattern intent.
5. External references and customary play.

Taiwanese Mahjong has substantial house-rule variation. Therefore, the product ships a named house standard: **Mahjong Taiwanese 16-Tile Rules v1.1**. The standard is fully defined here rather than claiming to represent every Taiwanese table.

Future references are:

- [GameTower Taiwanese 16-tile scoring reference](https://www.gametower.com.tw/Games/Freeplay/MJ/Star31/Data/i_ingame-count.aspx)
- [Hong Kong Mahjong Association rules library](https://www.hkmahjong.org/rules?lang=en)
- [World Riichi Championship Rules 2025](https://www.worldriichi.org/s/WRC-Rules-2025-42fx.pdf)
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Developer Program Policy](https://support.google.com/googleplay/android-developer/answer/17105854?hl=en)

### 1.3 Rules evidence and versioning

Before a public Beta build is accepted, the Rules Lead must approve:

- a human-readable English and Traditional Chinese rulebook;
- the complete Tai table in Section 7;
- at least 500 named golden cases, including every positive pattern, every exclusion, every claim-priority combination, all dealer outcomes, all cap cases, every abnormal termination, timeout-selected Pass interaction with the discard-Win lock, Eight Flowers and Heavenly Hand offer/lapse mechanics, final-drawable-tile wins from both the front and the back of the deque, and a Kong declared at the exhaustion boundary;
- at least one million randomized legal-state simulations with no tile duplication, illegal state transition, Jade-conservation failure, or deterministic replay mismatch;
- worked examples for every public UI formula.

Every match records a rules version. Active matches remain pinned to the version with which they started. Match histories and support tools interpret events under the recorded version. A rules change cannot silently alter an active or historical result.

The client has an offline-cacheable, searchable Rulebook for the active rules version, a Tai glossary, every scoring-table row, claim-priority diagrams, and the worked settlement examples in Section 7.4. Rules version is visible in Settings, queue confirmation, table details, results, history, and support Match ID context. Contextual links open the relevant rule without abandoning an active decision.

## 2. Product definition, audience, scope, and success

Resolves: SCP-01 through SCP-06, SCP-08, SCP-09.

### 2.1 Product promise

Mahjong is a free, online, rules-accurate Taiwanese 16-tile game that lets a beginner finish a guided first hand and lets experienced players reach a readable human match quickly. Priorities, in order, are:

1. Correct and explainable Taiwanese 16-tile play.
2. Fast, legible one-hand sessions.
3. Fair server-authoritative competition.
4. Low-friction play with friends.
5. Earned progression and tasteful personalization.

Rules accuracy wins over reducing complexity. Accessibility wins over purely decorative authenticity. Monetization never wins over fair play.

### 2.2 Audience

The primary audience is adults and teens age 13 or older who know some Mahjong or want to learn Taiwanese Mahjong. Secondary audiences are experienced Taiwanese players, diaspora/family groups, and competitive digital board-game players. The product is not designed for children under 13.

### 2.3 Release scope

| Capability | Closed Beta | Version 1 | Future, not in current development scope |
| --- | --- | --- | --- |
| Taiwanese 16-tile rules | Complete | Complete | Maintained |
| Scripted tutorial | Complete | Complete | Additional lessons |
| AI Practice | Easy, Medium, Hard | Same | Ruleset-specific AI |
| Quick Play | Public human and AI practice | Public human and AI practice | Additional queues |
| Full Rotation | Internal-only validation | Public ranked and private | Tournament formats |
| Identity | Guest, email magic link | Guest, email magic link, Google, Apple | Additional providers |
| Lobby tiers and Jade | Bamboo public; other tiers test-configurable | Bamboo and Sparrow public; upper tiers ship closed until Section 7.1 opening criteria are met | Upper-tier opening and rebalancing |
| Account XP | Minimal tracked implementation | Levels, achievements, cosmetics | Prestige |
| Rating | Internal test data only | Full Rotation public rating | Ruleset-specific ratings |
| Quick Play seasonal ladder | Not present | Present, Section 12.9 | Rebalancing only |
| Friends/private rooms | Present; private rooms are Quick Play only | Present, including private Full Rotation | Clubs |
| Fixed emotes | Not present | Eight positive preset emotes and a 24-phrase curated palette | Additional curated emotes and phrases |
| Mail/live configuration | Maintenance notices only | Mail, missions, banners, remote lobby configuration | Rich events |
| Store, premium currency, ads, paid pass | Absent | Absent | Requires a separately approved monetization specification |
| Ticketed tournaments or real-world prizes | Absent | Absent | Requires separate legal and product approval |
| Spectator and player-facing replay | Absent | Absent | Friend spectating in private rooms first, then own-match replay |
| Discard puzzle mode | Absent | Absent | First post-launch candidate, built on tutorial fixtures |
| Native iOS/Android/desktop apps | Absent | Absent | Future |
| Hong Kong and Riichi | Extension contracts only | Extension contracts only | Separate products/modules |
| Mainland China release | Absent | Absent | Separate publishing path |

Internal-only validation means tools and test matches may exist, but the capability is not promised to Beta players.

### 2.4 Explicit non-goals

Beta and Version 1 exclude:

- real-money gambling, cash-out, prizes with monetary value, purchasable gameplay currency, gifting, trading, or player-to-player transfers;
- paid apps, premium currency, in-app purchases, rewarded ads, battle passes, rotating stores, loot boxes, and paid tournaments;
- user-generated content, custom avatar uploads, open text chat, voice chat, direct messages, and free-form room names;
- offline play, hot-seat play, two-player or three-player Mahjong, uneven-seat play, and local network play;
- public bot fill, spectator mode, player-facing replay, clubs, clans, and creator programs;
- Hong Kong, Riichi, mainland China distribution, and native mobile/desktop binaries.

These exclusions are product decisions, not missing requirements.

### 2.5 Success metrics and Beta exit gate

Beta is successful only when all mandatory conditions are met:

| Metric | Required result |
| --- | --- |
| Participants | At least 500 unique invited players across the United States, Canada excluding Quebec, and Taiwan |
| Human Quick Play volume | At least 10,000 completed human hands |
| Tutorial completion | At least 75% of players who start Chapter 1 complete all chapters or intentionally skip |
| First human hand completion | At least 90% |
| Rules correctness | No unresolved Severity 0 or Severity 1 rules/scoring defect for 14 consecutive days |
| Settlement correctness | Zero unexplained Jade conservation discrepancy |
| Queue time | p50 at or below 30 seconds and p95 at or below 90 seconds when at least 16 eligible players are online |
| In-region game-state update | p95 at or below 250 ms |
| Crash-free sessions | At least 99.5% |
| Availability | At least 99.5%, excluding announced maintenance |
| Security | No open critical finding and no unresolved high-risk exploit affecting hidden information, identity, or Jade |
| Qualitative feedback | At least 80% of surveyed experienced players rate tile readability and claim clarity 4/5 or better |

Directional health targets, not hard launch gates, are Day-1 retention of 30%, Day-7 retention of 12%, Day-30 retention of 5%, and median Quick Play session length of 8 to 15 minutes.

Because email magic link, friends, and private rooms are present in Closed Beta, these retention readings are measured with the social loop and account recovery available; a guest-only Beta without social features would understate them.

### 2.6 Reference products and quality bar

Reference products establish interaction and presentation quality only. They do not override the rules, scope, economy, safety, or acceptance requirements in this specification.

| Reference | Use as a quality bar for | Emulate | Explicitly avoid |
| --- | --- | --- | --- |
| [GameTower 明星3缺1](https://www.gametower.com.tw/Games/Freeplay/MJ/Star31/) | Taiwanese terminology, familiar hand flow, scoring communication | Recognizable Taiwanese vocabulary, fast action feedback, and a line-item Tai result breakdown | Casino framing, currency pressure, visual clutter, opaque odds, and any implication of real-money value |
| [Mahjong Soul](https://store.steampowered.com/app/2739990/Mahjong_Soul/) | Table readability and time-sensitive claim presentation | Strong tile hierarchy, unmistakable active-player state, readable claim choices, and satisfying but brief action feedback | Riichi assumptions, character/gacha monetization, sexualized presentation, randomized purchases, and effects that obscure tiles |
| [Board Game Arena](https://en.boardgamearena.com/) | Browser-first room and match flow | Low-friction web entry, clear readiness, link-based friend invitations, reconnect continuity, and understandable match state | Generic board-game chrome, dense navigation, and exposing implementation or rules jargon during play |
| [Chess.com](https://www.chess.com/lessons) | Guided learning, practice choices, social flow, and service communication | Short progressive lessons, safe practice, clear mode selection, friend challenges, status messaging, and explainable competitive results | Advertising in the play surface, subscription gates, manipulative streak pressure, and paywalled rules education |

There is no positive external reference for the Jade economy or live-service monetization. The quality bar is the closed-loop, earned-only, fully auditable ledger in Sections 7 and 13. GameTower and commercial free-to-play games are anti-references for monetization: no purchase pressure, random rewards, paid advantage, expiring currency, or gameplay-affecting store is allowed.

### 2.7 Fixed product and planning constraints

The detailed development plan must respect these fixed constraints:

- Beta and Version 1 are responsive web/PWA releases; native binaries are not in scope.
- Closed Beta is invite-only in the United States, Canada excluding Quebec, and Taiwan, with English and zh-TW parity.
- The service is age 13 or older and must not knowingly serve children under 13.
- The game is free and has no ads, purchases, real-world prizes, cash-out, trading, or transferable value.
- The authoritative game service, deterministic event record, Jade ledger, privacy controls, support tooling, and operations controls are required product capabilities, not optional infrastructure polish.
- All player-facing art, audio, fonts, and written content must have documented commercial rights.
- Launch data stores are in the United States; Taiwan users receive the required cross-border data notice.
- No fixed launch date, staffing level, or spending ceiling was supplied. A development plan must expose estimates, assumptions, staffing options, dependencies, and scope tradeoffs instead of inventing one as a requirement.
- The accountable roles in Section 1.1 must be assigned before their approval gates, but one person may hold multiple roles if conflicts of interest are documented and Product Owner remains the tie-breaker.

### 2.8 Business context and sustainability hypothesis

The product is a deliberate audience-building and franchise investment, not a near-term revenue product. To keep later commercial decisions from fighting the product identity, the working hypothesis is recorded now:

- If monetization is ever approved, the only models compatible with Sections 2.1 and 13.1 are direct cosmetic purchase and/or a cosmetic-only season pass, with gameplay currency permanently non-purchasable and no paid advantage.
- Cosmetic production capacity is therefore the long-lead prerequisite for any future revenue; the Section 13.2 catalog and Section 13.5 cadence are sized to grow rather than restart from zero.
- The Section 15 service levels are funded as a strategic cost. If funding changes, service levels are re-scoped through an explicit product decision, never silently degraded.
- The no-purchase, no-pressure identity is itself a marketable asset and must not be undermined by placeholder commerce, dormant payment code, or store UI.

This section records a hypothesis and its planning consequences. It is not a monetization approval, which still requires the separate specification described in Section 13.1.

## 3. Platforms, markets, localization, and brand

Resolves: PLT-01 through PLT-07.

### 3.1 Platform

Beta and Version 1 are a responsive web application installable as a PWA. Supported contexts are:

- desktop web with mouse and keyboard;
- tablet web with touch;
- mobile web with touch.

Native iOS, Android, Windows, and macOS applications are future scope.

The game requires a network connection. Tutorial and AI Practice are also online because the same authoritative rules engine, identity, telemetry, and deterministic event log must be used. Loss of connection enters the reconnect flow; no gameplay progress is reconciled from an offline client.

### 3.2 Browser and device matrix

The support policy covers the current and previous major release at launch time for Chrome, Safari, Edge, and Firefox on desktop; Safari on iOS/iPadOS 17 or later; and Chrome on Android 12 or later. Minimum viewport is 360 by 640 CSS pixels. Minimum device memory target is 4 GB. WebGL 2 is preferred but gameplay must have a Canvas/CSS reduced-effects fallback.

Menus work in portrait and landscape. An active match requires landscape at widths below 768 CSS pixels and provides an orientation prompt. Tablet and desktop match layouts are responsive landscape layouts.

Because iOS Safari cannot lock orientation, suspends background tabs aggressively, and may evict site storage, the client must: request persistent storage where supported and surface the Guest data-loss warning when persistence is not granted; harden connection resume against background suspension to meet the Section 15.6 foreground-resume target; present the orientation prompt as a non-blocking overlay rather than a modal loop; and explain installed-PWA requirements before offering web push. Acceptance includes the iOS interruption matrix in Section 16.1.

### 3.3 Markets and languages

Closed Beta markets are the United States, Canada excluding Quebec, and Taiwan. Version 1 may be publicly available in those same markets after policy and privacy review. Quebec is deferred until a separately scoped French localization and provincial legal review is approved.

Launch text languages are:

- English;
- Traditional Chinese for Taiwan, zh-TW.

English and Traditional Chinese are equally supported, including tutorial, rulebook, scoring explanations, errors, support templates, and accessibility labels. Traditional Chinese is authoritative for Taiwanese Mahjong terminology; English is authoritative for product/system terminology. Simplified Chinese, Japanese, Cantonese voice, and all other languages are future scope.

Mainland China is explicitly excluded from Beta and Version 1. WeChat sign-in, China hosting, China-specific publishing approvals, and China-specific data handling are not current requirements.

### 3.4 Brand and sensory direction

The working product title is **Mahjong** until a trademark-cleared name is approved. No publisher name, studio name, logo, or trademark-cleared product mark was supplied; Beta uses a text title card and no publisher animation or invented credit.

The visual direction is a contemporary Taiwanese tea-house: warm wood, muted jade, cream tile faces, restrained red accents, and uncluttered 2D table presentation. It must not use casino imagery, cash symbols, slot-machine effects, or language such as bet, jackpot, or cash.

Tile faces use conventional Taiwanese symbols and colors on cream faces, with Arabic rank/suit reinforcement available in the High Contrast skin. All tile art, table art, music, and sounds must be original, commissioned with transferable commercial rights, or covered by a documented commercial license. Version 1 audio is instrumental ambient music plus tile and action sounds. Spoken character guides and purchasable voice packs are out of scope. Tutorial guidance uses illustrated original characters and text.

## 4. Canonical terminology and game-state vocabulary

Resolves: GOV-04 through GOV-06.

### 4.1 Player-facing terms

| Concept | English UI | Traditional Chinese UI |
| --- | --- | --- |
| Scoring unit | Tai | 台 |
| Ready hand | Ting | 聽牌 |
| Self-draw win | Zimo | 自摸 |
| Win from discard | Hu | 胡牌 |
| Sequence claim | Chow | 吃 |
| Triplet claim | Pong | 碰 |
| Quad | Kong | 槓 |
| Pass | Pass | 過 |
| Soft currency | Jade | 玉 |

"Tail," "Tilted draw," "Pavillion," "Chong," "Ron," "Tsumo," "Pon," "Kan," and "Chi" are not used in the Taiwanese English UI. "Pavilion" is the approved spelling. Ruleset-specific terminology may change only when a future rules module is active.

### 4.2 Currency language

The only Version 1 currency is **Jade**, represented by 玉 and a jade-token icon. It is a non-purchasable, non-transferable play currency with no monetary value. "Tael," "Liǎng," 両, chips, wager, betting, winnings, and cash are removed from player-facing copy.

English treats Jade as a mass noun: "1 Jade" and "500 Jade," never "Jades." Traditional Chinese uses 玉 without an in-product romanization.

### 4.3 Gameplay units

- **Turn:** starts when a player draws or claims a tile and ends when that player discards, wins, or completes a terminal action.
- **Hand:** one wall from initial deal until a win, exhaustive draw, or administrative void. "Deal" is a synonym used only in explanatory copy.
- **Dealer continuation:** a repeated hand with the same dealer after a qualifying result.
- **Dealer rotation:** dealer responsibility moving to the next seat counterclockwise.
- **East round:** four base dealer positions, extended by dealer continuations. Each player must become dealer once.
- **Quick Play match:** exactly one hand.
- **Full Rotation match:** exactly one East round.
- **Session:** one continuous signed-in application visit and may contain multiple matches.

The PRD phrase "four rounds, East/South/West/North" is replaced. East, South, West, and North are seat winds within the single East round. Quick Play does not produce a four-place rating result. Full Rotation final placement updates rating.

## 5. Mahjong Taiwanese 16-Tile Rules v1.1

Resolves: TWN-01 through TWN-20.

Every setup, legal-action, scoring, settlement, draw, and dealer rule in Sections 5-7 is fixed for public and private play. There are no house-rule toggles. Private-room choices for timer, open-hand practice, and bot difficulty affect presentation/training only and cannot change Jade, rating, achievements, public statistics, or the rules version.

### 5.1 Players and tile set

Every match has exactly four occupied seats. Two-player, three-player, hot-seat, uneven-seat, and mid-hand seat replacement are not supported.

The set contains 144 tiles:

- 36 Characters, 36 Bamboos, and 36 Dots;
- 16 Winds;
- 12 Dragons;
- four Seasons and four Flowers.

There are four identical copies of each suited or honor tile and one of each bonus tile.

### 5.2 Seating, dealer, direction, and wall

At match start, the server uniformly randomizes seats. One seat is uniformly selected as dealer/East. Proceeding counterclockwise, the remaining seats are South, West, and North. Turn order is East, South, West, North, then East.

When the local player is East at the bottom of the screen, South is on the right, West is opposite, and North is on the left. Therefore, the next turn/dealer appears to move to the local player's right. Public parties are not supported, and private-room hosts cannot assign seats or dealer.

The server creates the wall with a cryptographically secure Fisher-Yates shuffle. The canonical visualization has 72 two-tile stacks: 18 each on the East, South, West, and North sides. Successive shuffled tile pairs fill those stacks, lower tile then upper tile, in that side order.

The server independently rolls two six-sided dice and records both values. With sum s:

1. count wall owners from East as 1, proceeding counterclockwise, wrapping after North;
2. select owner `((s - 1) mod 4) + 1`;
3. from the selected owner's right end as that owner sees it, count s stacks in the counterclockwise draw direction;
4. break after that stack;
5. flatten the cycle immediately after the break, taking each stack's upper tile then lower tile, to create the front-to-back wall deque.

The already uniform shuffle determines fairness; the dice determine only its recorded cyclic break. A skipped or visually abbreviated setup must produce the identical deque. Normal draws remove from the deque front. Replacements remove from its back.

The deal uses four passes. On each pass, East, South, West, and North receive four front tiles in turn; then East receives one final front tile. This leaves 16 tiles per non-dealer and 17 for East before Flower replacement. Flower and Kong replacements remove a tile from the back. The hand becomes exhaustible when exactly 16 tiles remain in the wall deque; those 16 tiles are not drawn. If a mandatory replacement would be required at that boundary, the hand ends as an exhaustive draw. A Kong completed at that boundary stands as a completed meld for statistics, achievements, and XP even though its replacement draw, and any win from it, can no longer occur.

### 5.3 Flower and Season replacement

Bonus tiles can never remain in a concealed hand. During initial replacement, East exposes and replaces all bonus tiles first, including chained replacements, followed by South, West, and North. During play, a drawn bonus tile is immediately exposed and repeatedly replaced from the back until a playable tile is drawn or the wall exhausts.

Replacement is mandatory and server-controlled. The only user setting is animation speed: Normal or Reduced. There is no setting that retains a bonus tile or declines replacement.

### 5.4 Legal winning structures

A normal winning hand has 17 effective tiles arranged as five melds plus one pair. A meld is a Chow, Pong, or Kong; a Kong counts as one meld despite containing four physical tiles.

The only non-structural instant win is Eight Flowers, declared when one player has all eight Flower/Season tiles. Seven pairs, eight pairs, Thirteen Orphans, knitted hands, and other exceptional geometries are not legal in v1.1.

Every structurally valid hand can win because Base Win supplies 1 Tai. There is no separate minimum-Tai gate.

### 5.5 Chow

Only the next player in counterclockwise turn order may Chow the most recent discard. A Chow consists of three consecutive numbers in one suit; it cannot wrap from 9 to 1 and cannot contain Honors. If multiple Chows are possible, the player chooses the exact two hand tiles. The claimed tile is rotated toward its source in the exposed meld.

### 5.6 Pong

Any non-discarding player holding two matching tiles may Pong the most recent discard. The player exposes the pair plus the claimed tile, becomes active, and must discard. If more than one Pong/Kong request survives higher-priority wins, the eligible claimant closest to the discarder in counterclockwise turn order receives the tile. With four copies per tile, two simultaneous Pong or Kong claims on one discard are arithmetically impossible; the proximity rule is retained as a defensive server invariant, and QA must not treat it as a constructible scenario.

Declining a Pong does not create a future lock; the player may claim a later copy.

### 5.7 Kong

Three Kong forms are legal:

- **Exposed Kong:** claim a discard while holding the other three copies. It is open and scores 1 Tai.
- **Added Kong:** add a self-drawn fourth copy to an exposed Pong. It remains open and scores 1 Tai.
- **Concealed Kong:** expose four self-drawn copies in the concealed-Kong presentation. It does not open the hand and scores 2 Tai.

A successful Kong is followed by one replacement draw from the back, including mandatory chained Flower replacement, then the same player continues and discards.

An added Kong may be robbed by any player for whom the added tile completes a legal hand. The original Pong remains; the fourth tile becomes the winner's tile, the Kong is not scored, and the declaring player is treated as the discarder. Exposed and concealed Kongs cannot be robbed. Multiple winners are allowed.

### 5.8 Win claims, precedence, and passing

All legal Win claims on the same discard are honored, up to three winners. Priority is:

1. all legal Win claims;
2. one Pong or Kong, selected by turn-order proximity;
3. Chow by the next player.

Claims are collected privately. No response is revealed until all eligible players respond or the deadline expires. A player may revise a response until the deadline; Win remains available if legal. The server rejects responses received after the authoritative deadline or with a stale action identifier.

A player who deliberately passes a legal discard Win cannot win from another discard until completing their next personal draw-and-discard cycle. Zimo remains legal during that period. This temporary lock is shown in the UI and event log.

Only an explicit player-submitted Pass, or an explicit revision to Pass, is deliberate. A Pass selected by the server because of a timeout or disconnection never creates this lock; it punishes connectivity, not strategy, and is recorded with a distinct reason code. This distinction is a mandatory golden case.

### 5.9 Special win events

The following events exist and score as Section 6.1 defines:

- Zimo;
- Last Tile Zimo;
- Win After Replacement, for a Kong or Flower replacement draw;
- Robbing an Added Kong;
- Heavenly Hand, when East is structurally complete after initial replacement and before any player action;
- Earthly Hand, when a non-dealer wins during their first personal front-draw sequence before any Chow, Pong, or Kong has occurred;
- Eight Flowers instant win.

Initial Flower replacement completes before structural special-win evaluation. Eight Flowers is checked first. East then receives Heavenly Hand for a structurally complete hand before any player action; initial replacement does not disqualify it, but Heavenly Hand does not also receive Zimo or Win After Replacement. A non-dealer whose first front draw is a Flower may complete Earthly Hand on its chained replacement and also receive Win After Replacement.

The final drawable tile is the tile whose removal from either end of the wall deque leaves exactly the 16-tile reserve. A winning front draw of that tile scores Last Tile Zimo. A winning replacement draw of that tile scores both Win After Replacement and Last Tile Zimo. The final drawable tile may also be discarded and claimed normally, but a Win from that discard receives no last-tile event Tai. Seven Flowers Rob One, human-hand variants, wins by robbing a concealed Kong, and other unlisted events are not supported. There are no deal-in responsibility, pao, or redirected-liability rules.

Special wins are offered, never auto-declared:

- **Eight Flowers offer:** when a player's eighth bonus tile is exposed, the server offers Eight Flowers as an explicit Win action — during initial replacement, immediately after that player's replacement sequence completes and before the next seat's replacement begins; during play, within the player's own turn before their discard. A Pass or timeout does not forfeit the win: while the player holds all eight exposed bonus tiles, the offer reappears at the start of each of that player's turns, after draw and mandatory replacement and before discard. A turn timeout follows the normal auto-discard rule and never auto-declares.
- **Heavenly Hand offer:** after initial replacement completes, if East is structurally complete, the server offers Win in East's first turn action set before any discard. If East passes or times out, the Heavenly Hand opportunity lapses permanently; East may still win later under normal rules. Declining it creates no Section 5.8 lock because it is not a discard win.

Both offers and their lapses are recorded in the event log and covered by golden cases.

### 5.10 Action timing

| Context | Decision time |
| --- | --- |
| Tutorial | No timer |
| AI Practice | No timer by default; optional 30-second training timer |
| Public Quick Play draw/discard | 15 seconds |
| Public Quick Play interception, Bamboo Courtyard | 10 seconds |
| Public Quick Play interception, other lobbies | 7 seconds |
| Ranked Full Rotation draw/discard | 12 seconds |
| Ranked Full Rotation interception | 5 seconds |
| Private Full Rotation | Host chooses 12, 15, 20, or 30 seconds; interception is half, rounded up |

The prior "3.0s mask" concept is removed. There is no hidden interval, time bank, or overtime. For each decision, the server calculates one common absolute deadline from the base time plus the largest eligible player's smoothed half-round-trip estimate, capped at 500 ms. The same deadline is sent to every affected client; input closes at that deadline.

Animation time before the action is available is not charged. Mechanically: the deadline clock starts at server dispatch time plus a fixed per-action animation allowance taken from the versioned configuration table, bounded by the standard 600 ms animation budget in Section 9.11. The allowance is identical for every seat and never varies with an individual player's animation-speed or Reduced Motion settings, because the deadline is shared; it is included in the published absolute deadline, and a client that finishes animating early simply gains decision time.

Public timer values are pacing presentation, not rules content: live configuration may adjust them within approved bounds — turn 10 to 30 seconds, interception 5 to 15 seconds — for new matches only, under Section 13.4 approval. An active match keeps the values with which it started. The longer Bamboo interception window exists because claim decisions are the hardest beginner moment.

The local timer always shows a number and a shrinking shape. At 3 seconds it changes from neutral to amber, announces "3 seconds" to assistive technology, and may play one optional tick/haptic cue; at 1 second it changes to red and repeats the non-color cue. Opponent turns show "Thinking" and the shared countdown without exposing which interception choices exist. Claim windows show only the local player's legal choices. Audio and haptics are never the sole warning.

On a claim timeout, the server selects Pass; a timeout Pass never creates the Section 5.8 discard-Win lock. On a turn timeout, it discards the most recently drawn playable tile; if none is distinguishable after a claim, it discards the rightmost tile in the server's canonical sorted hand. The server never auto-declares Win.

Three consecutive player-action timeouts mark the player AFK and activate a disclosed takeover bot for the rest of the hand. Reconnection may restore control at the next legal personal turn.

### 5.11 Exhaustive draw and dealer continuation

When 16 wall tiles remain and no terminal claim is pending, the hand is an exhaustive draw. No Jade or table-point transfer occurs.

Only the dealer's Ting status affects an exhaustive-draw continuation. Other players are not required to reveal, receive no noten payment, and do not affect the result.

| Completed-hand outcome | Dealer result | Continuation k |
| --- | --- | --- |
| East wins by Zimo or discard | East retains deal | Increment by 1 |
| Only non-East player(s) win | Rotate counterclockwise | Reset to 0 |
| East and any non-East player both win the same discard | Rotate counterclockwise | Reset to 0 |
| Exhaustive draw; East is Ting | East reveals and retains deal | Increment by 1 |
| Exhaustive draw; East is not Ting | East reveals; rotate counterclockwise | Reset to 0 |
| Player disconnect/timeout with a valid terminal result | Use the applicable row above | Use the applicable row above |
| Administrative void, accepted impossible state, or server interruption | Replay with same East | Keep existing k; do not increment |

Rotating when East is among multiple winners of the same discard differs from tables that continue the dealer whenever the dealer wins at all. The Rulebook must call out this divergence, and the recorded Rules Lead and zh-TW expert approval covers it.

There are no rules-based abortive draws, Chombo continuations, or four-Kong aborts in v1.1.

The maximum continuation count is ten. After the hand played at k = 10, dealer rotates regardless of outcome.

### 5.12 Dealer Tai

The dealer relationship modifier is additive, not exponential:

**Dealer Tai = 1 + 2k**

k is the number of completed qualifying continuations before the current hand. Therefore, the initial dealer hand has 1 Dealer Tai, first continuation has 3, second has 5, and tenth has 21.

Dealer Tai is applied to a payment whenever the winner or that specific payer is the dealer. It is not a pattern in the winner's displayed hand; the tally sheet shows it as a settlement modifier.

### 5.13 Fouls and impossible actions

The client displays only legal Chow, Pong, Kong, and Win actions calculated by the authoritative server. A user cannot intentionally submit a false Win or produce a wrong tile count through normal UI.

| State or attempted action | Product behavior |
| --- | --- |
| False Win, illegal Chow/Pong/Kong, action out of turn, stale claim, or illegal discard | Do not offer it in normal UI; reject a forged command without changing state |
| Wrong concealed count, duplicate tile ID, impossible wall, or accepted illegal transition | Freeze the hand, preserve evidence, administratively void, and follow Section 8.8 |
| Premature reveal or concealed-data request | Never supported by normal UI; reject and log a forged request |
| Structurally complete low-Tai hand | Legal because Base Win supplies 1 Tai; no minimum-Tai foul exists |
| Four or five Kongs | Continue normally while replacements remain; no abortive draw |
| Player disconnect, timeout, or quit | Follow Section 8.7; it is not a Mahjong foul |

Repeated malicious commands trigger anti-cheat review. No ordinary player receives a Chombo-style balance penalty in v1.1.

## 6. Scoring patterns

Resolves: SCO-01 through SCO-03 and scoring portions of SCO-04 through SCO-07.

### 6.1 Pattern table

All legal wins receive Base Win. Pattern values are additive subject to Section 6.2.

| Pattern | Tai | Exact condition |
| --- | ---: | --- |
| Base Win | 1 | Any legal winning hand |
| Zimo | 1 | Winning tile drawn from front or replacement draw; superseded by Concealed Zimo when applicable |
| Concealed | 1 | No Chow, Pong, exposed Kong, or added Kong; concealed Kong is permitted; superseded by Concealed Zimo |
| Concealed Zimo | 3 | Concealed plus Zimo; replaces, rather than stacks with, Concealed and Zimo |
| Dragon Set | 1 each | Pong or Kong of Red, Green, or White Dragon |
| Seat Wind Set | 1 | Pong or Kong matching the winner's seat wind |
| Prevailing Wind Set | 1 | Pong or Kong of East during the v1 East round; can stack with Seat Wind Set |
| Matching Flower | 1 each | Season and Flower associated with the player's seat: East Spring/Plum, South Summer/Orchid, West Autumn/Chrysanthemum, North Winter/Bamboo |
| Complete Seasons | 2 | All four Season tiles; stacks with matching Flower |
| Complete Flowers | 2 | All four plant/Flower tiles; stacks with matching Flower |
| No Honors or Flowers | 2 | No Wind, Dragon, Flower, or Season tile in the completed hand |
| Single Wait | 1 | Exactly one tile identity can legally complete the hand at the moment before winning; does not stack with Fully Exposed |
| Three Concealed Pongs | 2 | Three concealed Pongs/Kongs |
| Four Concealed Pongs | 5 | Four concealed Pongs/Kongs; supersedes Three Concealed Pongs |
| Five Concealed Pongs | 8 | Five concealed Pongs/Kongs; supersedes Three and Four Concealed Pongs |
| All Chows | 2 | Five Chows, non-Honor pair, no Flowers, discard win, and not Single Wait |
| Fully Exposed | 2 | Five open melds and discard win on the pair; does not stack with Single Wait |
| Exposed/Added Kong | 1 each | Each completed exposed or added Kong |
| Concealed Kong | 2 each | Each completed concealed Kong; does not also score Exposed/Added Kong |
| All Pongs | 4 | Five Pongs/Kongs and one pair |
| Half Flush | 4 | One numbered suit plus Honors; mutually exclusive with Full Flush and All Honors |
| Full Flush | 8 | One numbered suit and no Honors; mutually exclusive with Half Flush and All Honors |
| All Honors | 8 | Only Winds and Dragons; mutually exclusive with Half Flush and Full Flush |
| Small Three Dragons | 4 | Two Dragon Pongs/Kongs plus Dragon pair; exclusive with Big Three Dragons |
| Big Three Dragons | 8 | Three Dragon Pongs/Kongs; exclusive with Small Three Dragons |
| Small Four Winds | 8 | Three Wind Pongs/Kongs plus Wind pair; exclusive with Big Four Winds |
| Big Four Winds | 16 | Four Wind Pongs/Kongs; exclusive with Small Four Winds |
| Last Tile Zimo | 1 | Zimo on the final drawable tile as defined in Section 5.9, from a front or replacement draw; stacks with Win After Replacement when both apply |
| Win After Replacement | 1 | Zimo on a Kong or Flower replacement draw |
| Robbing an Added Kong | 1 | Win by robbing an added Kong |
| Eight Flowers | 8 | Instant win after collecting all eight bonus tiles |
| Earthly Hand | 16 | Section 5.9 condition |
| Heavenly Hand | 24 | Section 5.9 condition |

### 6.2 Combination rules

- Base Win always applies.
- Concealed Zimo replaces Concealed and Zimo.
- Three, Four, and Five Concealed Pongs are one progression; only the highest applies.
- Half Flush, Full Flush, and All Honors are mutually exclusive.
- Small and Big versions of the same Dragon/Wind family are mutually exclusive.
- All Chows has the restrictions in the table and cannot stack with Zimo, Single Wait, or any Kong/Pong pattern because its own definition excludes those states. An All Chows hand necessarily also satisfies No Honors or Flowers; to avoid scoring one constraint twice, the two patterns do not stack, and the server awards the hand as All Chows.
- Fully Exposed does not stack with Single Wait.
- A Dragon or Wind set can score its set Tai in addition to larger Dragon/Wind patterns.
- Kong Tai can stack with concealed-Pong progressions, All Pongs, and suit patterns.
- Matching Flower can stack with Complete Seasons or Complete Flowers.
- Event Tai can stack unless a row explicitly excludes it.
- Exposed bonus tiles are outside the structural hand and are ignored for Pong/Kong, Wind/Dragon, and suit-composition tests unless a pattern explicitly mentions Flowers. Any bonus tile disqualifies No Honors or Flowers and All Chows.
- Eight Flowers ends the hand immediately and scores only Base Win, Eight Flowers, two Matching Flowers, Complete Seasons, and Complete Flowers, for 15 raw Tai. It does not score Zimo, Concealed, Concealed Zimo, Single Wait, Win After Replacement, or structural hand patterns.
- Heavenly Hand does not stack with Zimo, Concealed Zimo, Single Wait, or Win After Replacement. It may stack with Concealed and valid structural, set, suit, and Flower patterns.
- If a hand has multiple legal decompositions, the server chooses the decomposition producing the highest raw Tai. If tied, it chooses the lexicographically lowest canonical decomposition so replay is deterministic.
- Raw Tai is never reduced by a lobby cap. The cap applies only to Jade transfer.
- The maximum raw Tai under v1.1 is 69: Base Win 1 + Heavenly Hand 24 + Concealed 1 + Five Concealed Pongs 8 + All Pongs 4 + All Honors 8 + Big Four Winds 16 + one Dragon Set 1 + Seat Wind Set 1 + Prevailing Wind Set 1 + at most 4 Flower Tai. This maximum is a mandatory golden fixture. At k = 10, the maximum effective payment value is 90 Tai after the separate 21 Dealer Tai.
- Tai and Jade calculations use signed 64-bit integer arithmetic. No floating point or currency fraction is used; only proportional cap allocation can round, using the stated largest-remainder rule.

## 7. Jade settlement and lobby economy

Resolves: SCO-04 through SCO-15.

### 7.1 Lobby tiers

Only public human Quick Play uses Jade settlement.

| Lobby | Minimum account balance | Stake per Tai | Maximum total debit per player per hand |
| --- | ---: | ---: | ---: |
| Bamboo Courtyard | 1,000 Jade | 10 | 300 |
| Sparrow Pavilion | 10,000 Jade | 100 | 3,000 |
| Wind and Cloud Lounge | 100,000 Jade | 1,000 | 30,000 |
| Dragon's Den | 1,000,000 Jade | 10,000 | 300,000 |

The PRD's uncapped Dragon's Den is rejected. Every public table has a finite debit cap.

Version 1 launches with Bamboo Courtyard and Sparrow Pavilion open. Wind and Cloud Lounge and Dragon's Den are fully implemented but ship configured closed, so their queues are never visible dead content. Each opens through audited live configuration when its opening criteria are met: at least 2,000 accounts in good standing meet the tier's minimum balance, and projected queue times for the tier stay within Section 2.5 targets at observed concurrency. Live Operations reviews the criteria at least monthly and records each opening decision. An account in good standing has no active sanction and is not pending deletion; queue-dodge and abandonment cooldowns do not affect good standing. This definition applies wherever this specification uses the phrase. The faucet-to-cap ratio per tier — total daily grant potential versus the per-hand debit cap — is a tracked design parameter.

Before seating, the server checks the minimum balance and reserves the debit cap. The reserve remains owned by the player but cannot be spent elsewhere until settlement. Balance never becomes negative.

Full Rotation, AI Practice, Tutorial, and private rooms do not transfer Jade. Full Rotation uses table points only for placement.

### 7.2 Terminology

- **Minimum balance:** an eligibility check; it is not deducted.
- **Stake per Tai:** the integer Jade multiplier for raw Tai plus applicable Dealer Tai.
- **Debit cap:** the maximum Jade one player can lose across all settlements from one hand.
- **Reserve:** a temporary lock equal to the debit cap.
- There is no entry fee, rake, house cut, wager, or permanent system deduction.

### 7.3 Settlement formula

For one winner-payer relationship:

**Raw payment = Stake per Tai x (winner raw Tai + applicable Dealer Tai)**

Dealer Tai applies if the winner is dealer or the payer is dealer. It is applied at most once per winner-payer relationship; because the winner and the payer of one relationship can never both be the dealer, no relationship ever applies it twice.

- On a discard Win, the discarder is the only payer.
- On Zimo, each of the three opponents is a payer.
- Heavenly Hand and Eight Flowers use the three-opponent payer model even though they do not receive Zimo pattern Tai. Robbing an Added Kong uses the discard payer model with the Kong declarer as payer.
- On multiple discard winners, the discarder owes each winner independently before the discarder cap is applied.
- A player's aggregate debit for the hand is capped at the lobby debit cap.
- If multiple winning claims exceed one payer's cap, the cap is allocated proportionally to raw claims using integer largest-remainder allocation. Winner seat order breaks equal remainders.
- Credits equal debits exactly. The system creates or destroys no Jade through settlement.

### 7.4 Worked examples

For a 5-Tai discard Win with no dealer relationship, the same formula scales by lobby:

| Lobby | Calculation | Transfer |
| --- | --- | ---: |
| Bamboo Courtyard | 10 x 5 | 50 Jade |
| Sparrow Pavilion | 100 x 5 | 500 Jade |
| Wind and Cloud Lounge | 1,000 x 5 | 5,000 Jade |
| Dragon's Den | 10,000 x 5 | 50,000 Jade |

Additional mandatory examples are:

1. Dealer at k = 2 wins by Zimo with 5 raw Tai. Dealer Tai is 5, so each opponent pays 10 effective Tai: 100/1,000/10,000/100,000 Jade by ascending lobby, and the winner receives three times that amount.
2. Non-dealer wins by Zimo with 5 raw Tai while the dealer is at k = 2. The dealer pays 10 effective Tai and each other non-dealer pays 5. In Bamboo that is 100 + 50 + 50 = 200 Jade.
3. A non-dealer Zimo hand has Base Win, Zimo, one Matching Flower, and one Exposed Kong: 4 raw Tai. At k = 0, the dealer pays 5 effective Tai and the other two opponents pay 4 each. Bamboo transfer is 50 + 40 + 40 = 130 Jade. Kongs never create a separate immediate payment.
4. A non-dealer Eight Flowers win is 15 raw Tai. At k = 0, the dealer pays 16 effective Tai and the other two opponents pay 15 each. Bamboo transfer is 160 + 150 + 150 = 460 Jade.
5. Dragon's Den, one payer's uncapped raw amount is 450,000 Jade: debit is capped at 300,000 and the winner receives 300,000 from that payer.
6. Maximum v1.1 hand: a dealer at k = 10 has 69 raw Tai plus 21 Dealer Tai. In Dragon's Den each payer's raw 900,000-Jade obligation is capped to 300,000; the winner receives 900,000 total.
7. Bamboo, two discard winners have uncapped claims of 200 and 150 against the discarder cap of 300: proportional largest-remainder allocation pays 171 and 129 Jade. Winner seat order breaks only an exactly equal remainder.
8. A Zimo payer cap is independent for each opponent. A multiple-winner cap applies to the one discarder across all winning claims; no other player's reserve subsidizes that payer.
9. Exhaustive draw, administrative void, Tutorial, AI Practice, private room, or Full Rotation produces zero Jade transfer. Full Rotation uses the separate table-point formula in Section 8.4.

### 7.5 Account economy

Every new account receives 3,000 Jade. Completing or intentionally skipping onboarding grants a one-time 2,000 Jade, leaving every new player with 5,000 and access to Bamboo.

Version 1 sources are:

- first completed public human Quick Play hand each UTC day: 250 Jade;
- complete three public human Quick Play hands in one UTC day: 500 Jade;
- one-time onboarding grant: 2,000 Jade;
- support compensation approved and audited by Live Operations;
- welfare top-up described below.

The first-hand and three-hand grants are the same Daily mission rewards listed in Section 13.3, not duplicate automatic grants.

There are no Jade sinks in Version 1 other than transfers to other players. Cosmetics, titles, and frames use XP/achievement unlocks, not Jade.

If a balance is below the 1,000-Jade Bamboo minimum, the player may claim one welfare top-up per UTC day that sets the balance to 1,000 Jade. It requires completion of one AI Practice hand that day, is not ad-supported, and cannot be banked. This prevents permanent lockout while limiting account farming.

Jade cannot be purchased, converted from another currency, gifted, traded, transferred, redeemed, cashed out, inherited, or used for a real-world prize. It expires only when an account is deleted. Terms must state that it has no monetary value and is a revocable gameplay license.

All grants, reserves, settlements, reversals, and support adjustments are server-authoritative double-entry ledger events with an idempotency key, reason code, actor, rules version, match ID where applicable, and immutable audit record.

The economy is an access/recovery loop, not a scarce store of value. Settlement must have exactly zero net issuance. Product health targets are at least 95% of weekly active accounts eligible for Bamboo, fewer than 10% using welfare in a week, and no valid account permanently unable to play. There is no stable-money-supply or deflation target; grant-driven balance inflation is measured by source, median, and percentile on a per-tier balance-percentile dashboard that is an acceptance deliverable. A formal economy review is triggered when the median active-account balance exceeds the Wind and Cloud Lounge minimum, or when an upper tier meets its Section 7.1 opening criteria; that review decides prospective tuning and whether a first Jade sink must be specified before tier gates lose meaning. Tuning may change future grants or lobby gates prospectively through audited configuration, but may not claw back, expire, or devalue an existing balance.

## 8. Modes, matchmaking, and match lifecycle

Resolves: MOD-01 through MOD-13.

### 8.1 Tutorial

The tutorial is a deterministic, open-hand, three-chapter curriculum with no timer. Each chapter uses legal server-authored snapshots from one or more practice hands so a learner can repeat a concept without replaying unrelated turns.

| Chapter | Required content | Completion |
| --- | --- | --- |
| 1. Build a Hand | Suits and Honors; five melds plus a pair; draw, select, and discard; legal Win | Player completes a scripted discard Win |
| 2. Claims and Replacements | Chow eligibility, Pong priority, all three Kong forms at concept level, mandatory Flower replacement, Pass | Player performs one Chow, one Pong, one replacement, and passes an inferior claim |
| 3. Ready, Defend, and Score | Ting panel, visible-tile counts, safe versus dangerous visible information, Zimo versus discard Win, Base Win, Tai breakdown, dealer modifier | Player chooses between two discards, reaches Ting, wins, and reads the complete tally sheet |

Tutorial fixture notation is M = Characters, P = Dots, S = Bamboos, E/S/W/N = Winds, RD/GD/WD = Red/Green/White Dragon, and F1-F8 = Spring, Summer, Autumn, Winter, Plum, Orchid, Chrysanthemum, Bamboo. Production UI uses localized tile names rather than notation.

The planning-authoritative script is:

| Step | Exact state and scripted actors | Required learner action | Guide intent and correction |
| --- | --- | --- | --- |
| 1.1 Hand shape | Static open example `123M 456M 234P 678P 345S RD-RD` | Select each highlighted group, then Continue | "A Taiwanese winning hand has five melds and one pair." Selecting elsewhere is harmless and re-highlights the next group. |
| 1.2 Draw and discard | Learner is South with `12M 456M 234P 678P 345S RD-RD`; East has just discarded a harmless 8S. Wall front is `9S, 1P, 1S`. | Draw 9S, select it, and confirm discard | "Draw one, then discard one to return to 16 tiles." Discarding another tile opens a nonblocking explanation and restores the pre-discard snapshot. |
| 1.3 Complete the hand | West draws 1P and discards 9P; North draws 1S and discards 3M from its scripted hand. | Select Win | "The 3M completes 123M. Five melds plus one pair is a legal Win." Pass asks for confirmation; confirming Pass explains the missed Win and restores the claim snapshot. |
| 2.1 Flower replacement | Learner is North and draws Winter/F4; wall back replacement is 5P. | Acknowledge the automatic exposure and replacement | "Flowers never stay in your hand. They are exposed and replaced from the back of the wall." There is no decline action. |
| 2.2 Choose a Chow | Learner is next after the discarder and holds 1M, 2M, 4M, and 5M among the concealed tiles; 3M is discarded. | Choose Chow, then choose 1M + 2M | "Only the next player may Chow. Choose the two tiles that define the sequence." Other legal pairs preview their resulting sequence; the step continues only with 1M + 2M. |
| 2.3 Pong priority | Learner holds RD-RD; the player opposite discards RD. | Choose Pong, then make the highlighted discard | "Any player may Pong. Win would have priority; Pong/Kong has priority over Chow." Pass is allowed, explains that declining is legal, then restores the snapshot for completion. |
| 2.4 Strategic Pass | Learner could Chow a discarded 3S using 4S + 5S, but the scripted hand is one draw from a higher-value concealed wait. | Choose Pass | "A legal claim is optional. Passing can preserve a better hand." Choosing Chow shows the resulting lower-value shape, then restores the snapshot. Strategic advice appears only in Tutorial/Practice. |
| 2.5 Kong forms | Interactive snapshot gives the learner four concealed 7P; replacement tile from the wall back is 2P. Follow-up read-only snapshots show three held copies claiming a discarded fourth and a self-drawn fourth added to an exposed Pong. | Declare Concealed Kong, observe replacement, then advance through Exposed and Added Kong explanations | "A Kong is one meld, draws a replacement, and may change openness and Tai." Illegal ordering is unavailable; Back repeats each animation. |
| 3.1 Reach Ting | Learner is West after drawing 9M with `123M 456M 234P 678P 34S RD-RD 9M`. One 5S is visible in an opponent's exposed `456S`. | Discard 9M | "Discard 9M to wait for 5S." The Ting panel shows 5S and Visible remaining = 3. Any other discard previews why it is not Ting and restores the snapshot. |
| 3.2 Visible danger | North draws 1P and discards a harmless tile. East, the dealer at k = 1, then draws 2P and discards 5S from its scripted hand. | Inspect the matching visible tiles and choose Win | "Visible counts never use hidden hands. This 5S completes your hand. A discard Win is paid by the discarder; a Zimo is paid by all three opponents." Pass produces a confirmation and restores the claim snapshot if confirmed. |
| 3.3 Read the tally | Result is Base Win 1 + Concealed 1 + Single Wait 1 = 3 raw Tai. East is the payer at k = 1, adding 3 Dealer Tai. Tutorial transfer is 0 Jade; the hypothetical Bamboo payment is 60 Jade. | Expand the three hand-pattern rows, Dealer Tai row, and practice/no-transfer row; choose Complete | "Raw hand Tai and Dealer Tai are shown separately. Tutorial never changes Jade." Each unviewed row receives focus; completion remains available after all required rows are viewed. |

Unspecified opponent concealed tiles and wall positions are fixed in versioned fixtures `TUT-C1-v1`, `TUT-C2-v1`, and `TUT-C3-v1`; they cannot introduce an additional legal claim or alter the scripted wait. Those fixtures, the states above, and both language string IDs are part of the golden rules suite.

Every step specifies permitted input, expected focus, explanatory string ID, and a recovery prompt. A wrong selection explains why and restores the same decision without penalty. The core English guide lines above are meaning-authoritative; a professional zh-TW localizer and Taiwanese Rules Lead approve natural equivalents. Chapter progress is server-saved after each step.

Players may skip before or during any chapter, resume later, replay any completed chapter, or reset the tutorial. The one-time onboarding grant and 500 XP are awarded whether the player completes or intentionally skips, so experienced players are not penalized. Replays grant no additional currency or XP.

There is no separate advanced tutorial in Beta or Version 1. Experienced players use a chapter picker, searchable Rulebook examples, and AI Practice; this is the approved rules-refresher path.

### 8.2 AI Practice

AI Practice is one Quick Play hand or one private Full Rotation against three disclosed bots. The player selects Easy, Medium, or Hard for all opponents. There is no Jade, rating, leaderboard, mission, or public-stat impact. Limited daily XP applies under Section 12.

### 8.3 Public Quick Play

Quick Play is exactly one hand:

- four human players;
- one selected Jade lobby;
- a uniformly random dealer and seats;
- standard Section 5 rules;
- Jade settlement after Win or exhaustive draw;
- no public rating;
- profile hand statistics and eligible XP;
- target duration of 8 to 15 minutes.

Quick Play has no 1st-through-4th placement and no placement tie-breaker; a hand can have zero, one, two, or three winners. It contributes to the Quick Play seasonal ladder in Section 12.9 but never to Elo rating. The result screen shows winner(s), raw Tai, Dealer Tai, each ledger transfer, XP, applicable mission progress, ladder points, an Add Friend action for eligible opponents per Section 10.6, and the result-card export in Section 8.10. "Play Again" returns the player to a fresh queue; it does not preserve opponents or seats.

Because dealer assignment in a one-hand mode is a pure variance injection, the dealer versus non-dealer net Jade delta is a mandatory telemetry dashboard; a sustained material imbalance triggers a product review of dealer assignment in Quick Play.

### 8.4 Full Rotation

Full Rotation is one East round in which every player is scheduled to become dealer once, subject to continuations and the 60-minute match limit. At 60 minutes, the current hand finishes and the match ends even if the base rotation is incomplete. Target duration is 30 to 45 minutes. A match ended by the limit before every player has dealt is structurally asymmetric; the share of ranked matches ended by the limit is a mandatory telemetry metric, and a season in which it exceeds 5% triggers a pacing review.

All players start at 0 table points. For each winner-payer relationship, table-point transfer equals winner raw Tai plus applicable Dealer Tai, following the same payer and multiple-winner rules as Jade but with no cap and no stake multiplier. Table points may be negative and are not an account currency.

Final placement uses net table points. Equal table points are rating ties. For a displayed podium only, ties sort by:

1. fewer discard deal-ins;
2. more Zimo wins;
3. greater total raw Tai won;
4. the uniformly randomized initial seat order.

Public Full Rotation is ranked and uses no Jade. Private Full Rotation is unranked.

### 8.5 Public matchmaking

There are separate queues for each Quick Play Jade lobby and one public Full Rotation queue. Matchmaking prioritizes:

1. identical rules version and mode;
2. network region and estimated latency below 150 ms;
3. eligibility and, for Full Rotation, rating proximity;
4. wait time;
5. avoiding the same opponent within the previous three public matches when population permits.

Full Rotation starts with a rating search band of plus/minus 150, expands by 100 every 20 seconds, and becomes unrestricted after 80 seconds within the same network region. Quick Play does not use rating. Language, platform, and account level are not matchmaking constraints.

Public queues require four humans and never fill or backfill with bots. At 90 seconds the UI offers AI Practice, a lower eligible Jade tier, or continued waiting. Queue cancellation before seating has no penalty. Leaving after the match reservation is accepted creates a 60-second queue cooldown; repeated reservation dodges within 24 hours escalate to 5 and 15 minutes.

### 8.6 Private rooms and friends

Private rooms are present in Closed Beta (Quick Play only) and Version 1 (Quick Play and Full Rotation) and support:

- a six-character join code and direct friend invitation;
- four human seats, with disclosed bots allowed in empty seats;
- Quick Play or Full Rotation;
- timer presets from Section 5.10;
- open-hand practice toggle;
- Easy/Medium/Hard bot selection;
- rematch with the same seats.

Initial seats and dealer are server-randomized; the host cannot assign or swap them. Spectators are not supported; friend-only spectating in private rooms is the recorded first step of future spectator scope. Private rooms do not support Jade, rating, public leaderboards, public statistics, achievements, daily missions, or configurable scoring/house rules. They use the same immutable rules version as public play. Room codes expire when the room closes and are not user-named.

### 8.7 Disconnect, reconnect, AFK, and quit

The authoritative match continues during disconnection. The reconnect contract is:

- client displays Reconnecting immediately;
- server retains the seat for 90 seconds in Quick Play and private rooms and 60 seconds in ranked Full Rotation, sized to real mobile interruptions;
- current decisions time out normally;
- after three consecutive action timeouts, a disclosed Medium takeover bot acts for the remainder of the hand;
- a returning player regains control at the next legal personal turn;
- hidden state is sent only after session re-authentication and state-version validation.

A linked account may resume its active match from a different device after full re-authentication; the previous device's match session is revoked at that moment. Guest accounts remain bound to their single device credential.

In Quick Play, absence through hand end records a disconnect and the result, Jade, XP, and statistics still apply.

In Full Rotation, the takeover bot continues. A player absent for two consecutive hand endings is marked as having abandoned the match. The match completes, the player's results remain, and Section 12.6 applies the abandonment rating rule. The account receives a 15-minute ranked cooldown, escalating to 1 hour and 24 hours for the second and third abandonment in seven days. Server-caused disconnects do not count.

Voluntary mid-match quit follows the same rules as abandonment. Closing a mobile browser or backgrounding beyond the grace period is not an exception.

### 8.8 Abnormal termination

- A match reservation failing before the initial deal releases all Jade reserves.
- An administrative hand void reverses provisional hand ledger events and replays with a new committed shuffle.
- A match that cannot resume within the service recovery target ends. Unsettled hand events are reversed; prior settled Quick Play hands do not exist because Quick is one hand; Full Rotation rating and XP are not awarded for an incomplete match.
- If a completed settlement is later proven wrong, the ledger posts an auditable compensating transaction rather than rewriting history.
- Confirmed cheating can void rating, XP, statistics, and Jade after investigation; affected innocent players receive compensation.
- If all players disconnect and the match cannot recover within the service target, use the same incomplete-match rule; no special last-player result is created.
- Tournament cancellation behavior is not applicable because tournaments are outside Beta and Version 1.

Player-facing spectator and replay features are not in Beta or Version 1. The server retains an internal event replay for support, rules verification, and anti-cheat.

### 8.9 Mode effects matrix

| Mode | Jade | Rating | XP | Achievements | Missions | Public profile statistics | Leaderboard |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tutorial | No | No | 500 once for complete or intentional skip | No | Onboarding only | No; onboarding state is private | No |
| AI Practice | No | No | 25/hand, 200/day cap | No | Only an explicitly labeled onboarding task; completes welfare prerequisite | No | No |
| Public Quick Play | Transfer settlement | No | Completion and action XP | Yes | Yes | Quick Play section | Seasonal Quick Play ladder |
| Public Full Rotation | No | Once at completed match end | Hand and placement XP | Yes | Yes | Full Rotation section | Seasonal rating |
| Private Quick/Full | No | No | 25/completed match, 200/day cap | No | No | No | No |
| Tournament | Not in scope | Not in scope | Not in scope | Not in scope | Not in scope | Not in scope | Not in scope |
| Future ruleset | Requires its own approved economy | Separate if approved | Account XP contract requires approval | Ruleset-specific | Ruleset-specific | Separate | Separate |

### 8.10 Match history and replay visibility

Beta shows the most recent 20 public Quick Play summaries. Version 1 shows the most recent 50 public matches, filterable by Quick Play and Full Rotation. Each summary contains date, mode, rules version, participants, terminal outcome, the user's seat/dealer state, Tai and pattern lines for winner(s), final transfers/table points, XP, rating delta where applicable, and Match ID.

History never reveals another player's concealed hand beyond the required dealer Ting reveal. It has no turn-by-turn playback, in-game share link, spectator view, streamer overlay, or downloadable seed. The result screen and each history summary offer a local result-card image export of the tally sheet; the card contains no join link, seed, hidden information, or another player's private data. Player-facing replay of the player's own matches is the recorded future path and will be built on the internal event replay. Account export can include the user's full retained summary history; raw event retention follows Section 10.4.

## 9. User experience, assists, and accessibility

Resolves: UX-01 through UX-14.

### 9.1 Information architecture

Beta signed-in navigation contains:

- Play: Quick Play and AI Practice;
- Friends and Private Room (Quick Play);
- Learn: Tutorial and Rulebook;
- Profile: name, level placeholder, basic history;
- Settings;
- Feedback and Support.

Version 1 adds:

- Full Rotation, including private Full Rotation rooms;
- Progression, achievements, cosmetics, and statistics;
- Mail and Announcements.

Store, premium-currency display, tournament, battle-pass, and spectator destinations are absent rather than disabled placeholders.

### 9.2 Table presentation

The match is a fixed, responsive 2D top-down/oblique table. The local concealed hand is a horizontal face-up row. Opponent concealed hands show tile backs and count only. Every player has a separate chronological discard grid and a separate exposed-meld area. The remaining drawable-tile count excludes the 16-tile reserve and is always visible.

The local player is always rendered at the bottom, regardless of logical seat. The other seats are remapped around the screen while retaining counterclockwise turn order and explicit wind labels. The local hand is the largest tile treatment; exposed melds are second; opponent hands and the decorative wall are smallest.

The wall is shown as four abbreviated two-high sides whose depletion is derived from the canonical deque. On compact layouts it may collapse to a wall outline plus front/back depletion and the exact drawable count. It never reveals tile identities. The camera is fixed. Players cannot rotate or zoom the table, but a setting can enlarge the local hand and action row. Tile identity, claim source, most recent discard, active player, dealer, seat wind, continuation count, countdown, and all legal actions must remain visible without opening another panel at every supported match viewport. This simultaneous-visibility requirement must be validated with wireframes and on-device tests at the 360 by 640 CSS pixel landscape minimum before UI implementation is accepted; if it cannot be met there, the UX Lead records an approved revision of this requirement rather than letting the layout silently drop elements.

### 9.3 Input and sorting

On touch, first tap selects and raises a tile; second tap or upward drag confirms discard. On mouse, click selects and double-click confirms; drag is optional. Keyboard supports arrow navigation, Enter to select/confirm, Escape to cancel, and number-key action shortcuts when they do not conflict with text input. A mirrored left-handed layout option places the action row and confirmation controls on the left; every gesture and shortcut has an equivalent in both layouts.

The discard action can be cancelled until the client submits it. After server acknowledgement it is final.

Players may manually reorder their concealed hand. Auto-sort options are Off, by Suit then Rank, and by Sets/Connections. Auto-sort runs after deal, draw, claim, and manual toggle but never while a tile is selected. Server state is tile-identity based and does not depend on client order.

### 9.4 Player assists

| Assist | Tutorial | AI Practice | Public Quick | Ranked Full | Private |
| --- | --- | --- | --- | --- | --- |
| Legal-action buttons only | Yes | Yes | Yes | Yes | Yes |
| Identical visible-tile highlight | Yes | Yes | Yes | Yes | Yes |
| Recent discard highlight | Yes | Yes | Yes | Yes | Yes |
| Auto-sort | Yes | Yes | Yes | Yes | Yes |
| Ting detection and wait list | Yes | Yes | Yes | Yes | Yes |
| Remaining visible copies | Yes | Yes | Yes | Yes | Yes |
| Recommended discard | Tutorial script only | Optional | No | No | Host open-hand practice only |
| Danger/safety recommendation | Tutorial script only | Hard-training overlay optional | No | No | Host open-hand practice only |
| Score preview before Win | Yes | Yes | Yes | Yes | Yes |

Tournament and spectator availability is not configurable because neither mode exists in Beta or Version 1. Any future competitive format must explicitly reapprove its assist matrix rather than inherit the Private column.

Ting remaining count is four copies minus copies in the player's own hand, all discards, all exposed melds, and all exposed bonus/replacement information. It never reads opponent hands or wall order. The UI labels this "Visible remaining," not "Tiles left," and may show zero for a structurally legal but exhausted wait.

When more than one legal decomposition is possible, the wait panel shows the deduplicated union of every tile identity that completes at least one legal hand under the active rules version. A zero-copy wait remains listed with 0 and an "All visible" explanation; it is not removed or falsely presented as drawable.

The server returns only legal actions. Illegal actions are absent; disabled explanatory examples appear only in Tutorial and Rulebook. There is no player-triggered Chombo.

### 9.5 Visual claim and discard rules

- Most recent discard has a pulsing outline until the next discard or claim resolves.
- Claimed tiles rotate toward their source player.
- Each discard remains in its original chronological grid position; claimed discards leave a labeled placeholder.
- Selected-tile matches receive both outline and brightness change, never color alone.
- Claim responses remain private until resolution.
- Action animations are interruptible and cannot delay the authoritative deadline.
- Timer presentation and warnings follow Section 5.10. Color is always paired with number, shape, text/assistive announcement, and optional sound/haptic cues.

### 9.6 Automation

Flower/Season replacement and legal-state maintenance are mandatory server behavior. User settings may control only hand sorting, animation speed, and whether a confirmation is required for discard. There is no auto-win, auto-claim, auto-pass, or strategic auto-discard setting. Timeout behavior is fixed by Section 5.10.

Defaults are Sort by Suit then Rank, Normal animation, and discard confirmation On for touch and Off for mouse/keyboard double-confirm. A player may change those defaults before or during any non-Tutorial hand. Tutorial can temporarily force confirmation and focus behavior for its current step but restores the saved preference afterward. No public, ranked, or private mode can enable additional automation.

### 9.7 Results and explanation

The hand result presents, in order:

1. winning hand(s) and winning tile;
2. canonical decomposition;
3. every scoring pattern and Tai;
4. raw Tai subtotal;
5. Dealer Tai, if any;
6. stake, raw payments, caps, and final transfers for Quick Play, or table-point transfers for Full Rotation;
7. dealer continuation/rotation;
8. XP, achievements, missions, and rating where applicable;
9. Add Friend for eligible opponents and the Section 8.10 result-card image export;
10. Match ID, rules version, Report, Play Again/Continue, and Return.

After a hand, all concealed hands remain private except the dealer reveal required for a Ting exhaustive draw. Opponent hands are not exposed for curiosity.

An expandable "Why this scored" view shows superseding and exclusion rules relevant to the hand, including Concealed Zimo replacing Concealed/Zimo, highest concealed-Pong tier only, incompatible suit families, All Chows restrictions, and any debit cap. It does not list every impossible pattern.

### 9.8 Errors and recovery

Every loading, empty, and failure state has a localized explanation, stable error code, safe retry, and support path. Required states include unsupported browser, orientation, version mismatch, maintenance, authentication failure, no eligible lobby, insufficient Jade, reserve conflict, queue timeout, invite expiry, reconnect, state desync, service unavailable, mail claim conflict, and account restriction.

Purchase failure, receipt restoration, and ad failure states are absent because payments and ads are absent. "Client update required" is the version-mismatch state and links to a cache refresh/update instruction appropriate to the web/PWA context.

### 9.9 Accessibility

The web interface targets WCAG 2.2 AA wherever the criterion applies to an interactive real-time game. Required product behavior includes:

- complete keyboard operation outside gestures that have an equivalent button;
- visible focus and no keyboard trap;
- text scaling to 200% without loss of functionality;
- minimum 4.5:1 text contrast and 3:1 large-text/UI contrast;
- 44 by 44 CSS pixel targets for action buttons and menu controls; compact hand tiles may use a minimum 32 by 44 CSS pixel hit area when all 17 tiles must fit, with selection-before-confirmation and spacing that still satisfies WCAG 2.2 AA Target Size (Minimum);
- tile identities conveyed by symbol, numeral/letter, and accessible name, not color alone;
- High Contrast tile skin available to every player at no cost;
- Reduced Motion setting that removes pulsing, camera movement, and nonessential particle effects;
- no content flashing more than three times per second;
- screen-reader labels and live announcements for turn, draw count, legal actions, claim result, timer warnings, and scoring;
- captions/text equivalents for every sound and voice-like declaration;
- independent music, effects, declaration, and haptic controls;
- visible timer cues and optional haptic cues;
- Tutorial usable with keyboard, screen reader, Reduced Motion, and no timer.

Ranked timers are not extended per user setting because opponents require one shared deadline. AI Practice and private-room presets provide slower alternatives, and an untimed unranked human queue is recorded as explicit future scope for players who cannot use shared deadlines. The mirrored left-handed layout in Section 9.3 is an accessibility requirement, not a cosmetic option. The zh-TW screen-reader experience, including accessible tile names in Traditional Chinese, is audited separately from the English pass.

### 9.10 Settings persistence

| Setting group | Before account link | Authenticated behavior | Ruleset/mode behavior |
| --- | --- | --- | --- |
| Language | Device-local | Account-synced, with per-device temporary override | Terminology bundle follows active ruleset |
| Text scale, contrast, tile labels, Reduced Motion | Device-local | Account-synced | Never overridden by mode |
| Music, effects, declarations, haptics | Device-local | Account-synced; unsupported hardware is ignored | Never changes authoritative timing |
| Graphics/effects quality | Device-local | Device-local because capability differs | Reduced Effects can be forced by device health, never increased |
| Sort and discard confirmation | Device-local | Account-synced | Tutorial may temporarily force its current teaching step |
| Presence and social privacy | Not available to Guest | Account-synced | Block/invisible rules always win |
| Push/email notifications and quiet hours | Device-local permission plus server preference | Account-synced preference; permission remains device-specific | Policy/security notices cannot be disabled in-app |
| Optional analytics consent | Device-local consent record | Server-recorded and account-synced where legally permitted | Region/policy can force optional analytics Off, never On |
| Account link, export, deletion, logout-all | Server state | Server state | Not ruleset-specific |
| Timers, stakes, rules, legal assists | Read-only display | Read-only display | Fixed by selected mode/rules version |

When a Guest links, device settings migrate unless the established account already has an explicit value. A conflict summary is shown for language, privacy, and notification choices.

### 9.11 Audio, haptics, motion, and cosmetic effects

Version 1 audio has three independently adjustable buses: instrumental music/ambient room tone, tile/action effects, and nonverbal declaration cues. There are no spoken character voices or voice packs. Every declaration has visible localized text and an assistive announcement.

Audio starts only after a user gesture. Music/ambient audio pauses when the page is backgrounded; action effects do not queue for later playback. On foreground return, only the current synchronized state is announced. Haptics are optional, default Off, and used only for the local turn, 3/1-second timer warnings, accepted discard, and terminal result.

Reduced Motion replaces pulses, particles, sliding camera-like motion, and long meld animations with fades at or below 150 ms. Standard nonessential action animation completes within 600 ms. Opponent cosmetics can affect only frames, titles, emote styling, and nonessential local effects; a player can suppress those effects. No cosmetic may change tile geometry, symbols, hit targets, information visibility, deadline, input availability, or animation lockout.

## 10. Identity, social features, safety, and privacy lifecycle

Resolves: ACC-01 through ACC-12.

### 10.1 Guest accounts

A Guest account is a server record authenticated by a revocable device credential. It can use Tutorial, AI Practice, public Quick Play, Jade, and XP. In both Beta and Version 1, guests cannot add friends, create private rooms, enter the public ranked Full Rotation queue, use cross-device recovery, or change devices without linking. Ranked play requires a linked identity in good standing (Section 12.5).

Guests complete the same age confirmation and versioned Terms/Privacy acceptance before play. They can receive in-product maintenance, policy, and support mail but cannot receive email or web push. Purchases do not exist. Clearing browser storage loses the local credential but does not immediately delete server data. A Guest warning explains the risk. Guest accounts inactive for 180 days are deleted after a 30-day pending-deletion period.

### 10.2 Linking and sign-in

Closed Beta supports Guest identity and email magic link; magic link in Beta protects accounts against browser-storage loss and enables friends and private rooms. Version 1 supports:

- email magic link;
- Google sign-in;
- Apple sign-in.

Facebook, WeChat, username/password, passkeys, phone/SMS, and platform-native accounts are out of scope.

A Guest can link to a new identity and preserve all data. If the identity already maps to an established account, the user must choose that established account; two established accounts are never automatically merged. Support may transfer verified Guest data once when there are no conflicting public matches or sanctions. Unlinking the last recoverable identity is prohibited.

### 10.3 Age and consent

The minimum stated age is 13. Date of birth is collected as month and year plus an age-confirmation statement; full birth date is not retained. Accounts indicating an age below 13 cannot proceed and no persistent gameplay account is created.

Because the product has no purchase, ad, open communication, or real-world prize, no child-directed mode is offered. Regional counsel must confirm the age gate and privacy notice before public release. If a future monetized/native product changes risk classification, it requires a new age-rating and consent review.

The web product is positioned and labeled 13+. There is no parental-consent route for an under-13 account in current scope. If native storefront submission is later approved, the target is the applicable Teen/13+ equivalent, subject to the then-current questionnaire and counsel review rather than a guaranteed rating.

Terms of Service and Privacy Policy acceptance is versioned. Material changes require renewed acceptance before public play.

### 10.4 Data rights and retention

Authenticated users can request machine-readable export and account deletion. Deletion has a 30-day recovery window, after which identity and profile are removed or irreversibly anonymized.

Retention defaults are:

| Data | Retention |
| --- | --- |
| Raw match event logs | 180 days |
| Anti-cheat cases and sanction evidence | 24 months after case close |
| Security/audit logs | 12 months |
| Support tickets | 24 months |
| Aggregated, anonymized product metrics | 24 months |
| Jade ledger | Life of account plus legally required post-deletion period, stored pseudonymously |

Deleted users appear in historical opponent records as "Deleted Player." Public leaderboard entries are removed at the next refresh.

### 10.5 Player identity

Every account has an opaque, non-sequential Player ID and a display name. Default names are generated from a curated adjective/noun list. Names are 3 to 16 Unicode grapheme clusters, normalized, profanity/impersonation filtered in both launch languages, and not globally unique. Search uses the exact Player ID, not display-name discovery.

Users may rename once every 30 days at no cost. There are no custom avatar uploads. Avatars, frames, and titles come only from the approved catalog. Reports can target a display name or profile cosmetic.

### 10.6 Friends and presence

Authenticated accounts may have up to 200 friends and 50 pending outgoing requests. Requests use exact Player ID or a post-match Add Friend action. Users can accept, decline, cancel, unfriend, block, and report. Rate limits are 20 outgoing requests per day and 5 per minute.

The Recent Players list contains the last 20 eligible public opponents for 30 days, excluding blocked/deleted accounts, and permits Add Friend, Block, or Report. Friendship works across the three launch markets. A friend who is In Match can receive one queued invitation notification but cannot join or reveal room/mode details until returning Online.

Presence values are Offline, Online, In Queue, and In Match. Away is not a separate state. Mode and Jade tier are private. Last-seen time is not shown. Users may appear Offline. There is no additional streamer mode because invisible presence, no open chat, and hidden tier/mode provide the required privacy. Blocked users see Offline, cannot send requests/invites, and are avoided in matchmaking when population permits. Minor accounts default to appearing Offline until changed.

### 10.7 Communication

There is no text chat, voice chat, direct message, custom room name, image sharing, or user-authored status. Version 1 offers eight localized, positive preset emotes such as Hello, Good game, Nice hand, and Thanks, plus a curated palette of 24 localized, positive or neutral table phrases such as "That was close" and "Lucky draw." Phrases are fixed strings from a reviewed catalog; there is no free text, and the zh-TW versions are localized through the Section 15.12 process, not transliterated. Emotes and phrases share one rate limit of one every five seconds, can be muted globally or per player, and are disabled for blocked players.

### 10.8 Reporting and enforcement

Report categories are cheating/collusion, intentional AFK/quit, offensive display name, harassment through preset-emote spam, and other technical issue. A report automatically includes Match ID, rules version, relevant event slice, involved Player IDs, client version, and reporter text limited to 500 characters for support only.

The user receives a receipt ID. Trust and Safety can warn, rename, mute emotes, apply queue cooldowns, reverse rewards, suspend, or permanently ban. Account sanctions do not confiscate unrelated cosmetics or Jade except amounts tied to proven abuse. Appeals are accepted within 14 days and reviewed by someone other than the original reviewer.

Credible account compromise, hidden-information exploit, threat, or imminent safety issue is routed to the security/urgent queue immediately. The reporter receives a generic closed/status notice when review finishes, but never private sanction or opponent-account details. Knowingly repeated false reports can lead to a warning and report-rate restriction; an unsupported good-faith report is never penalized.

Product anti-abuse signals include repeated fixed groups, unusual surrender/feeding patterns, shared device/network identifiers, impossible action timing, automation fingerprints, reserve/ledger anomalies, and private-room farming. Signals trigger review; no permanent sanction is based solely on one heuristic. Friends and parties cannot enter the same public queue as a coordinated group.

### 10.9 Mail and notifications

Version 1 mail types are Announcement, Reward, Support, and Policy. Targeting can use market, language, account cohort, eligibility event, and Player ID, but not sensitive inferred traits. Read/unread state is account-synced. Reward mail is idempotent, displays expiry, and can be claimed individually or with Claim All. Claim All skips ineligible/already-claimed items and reports each result. Entitlements have no inventory-cap overflow. Standard reward mail expires after 30 days; policy and sanction notices do not expire while relevant.

Web push is opt-in and limited to friend invitations, service restoration, and expiring reward reminders. Quiet hours default to 21:00-09:00 local time. Deep links may open Mail, Friends, or a private-room join confirmation after authentication; they never join a match or spend/claim automatically. Email is used only for authentication, security, policy, and support unless marketing consent is separately granted. Accounts ages 13-17 default all optional push/email Off and cannot receive marketing in current scope.

## 11. AI behavior and bot policy

Resolves: AI-01 through AI-08.

### 11.1 Permitted jobs

Bots are used for Tutorial scripts, voluntary AI Practice, private-room empty seats, disconnect takeover, internal simulation, and automated rules testing. They do not fill public queues, substitute into tournaments, impersonate humans, or enter public leaderboards.

Every bot seat is labeled Bot and displays difficulty. A takeover seat retains the player's display identity plus an "Auto-playing" badge so match responsibility remains clear.

### 11.2 Information boundary

Bots may read only:

- their own concealed hand;
- public discards and exposed melds;
- public Flower/Season tiles;
- seat/dealer/continuation state;
- remaining drawable count;
- prior public actions.

They may not inspect opponent hands, unrevealed wall order, future random values, hidden claim responses, private profile data, or anti-cheat signals. Easy and Medium may intentionally use less public information but never hidden information.

### 11.3 Decision behavior

| Decision area | Easy | Medium | Hard |
| --- | --- | --- | --- |
| Hand building | Favors immediately completed melds; high random variation | Minimizes distance to a legal hand and maximizes visible effective draws | Maximizes estimated expected table points across speed, Tai, and risk |
| Chow/Pong | Claims most immediate progress | Claims when effective-draw count improves and value is not materially harmed | Evaluates openness, value ceiling, dealer state, and opponent threat |
| Kong | Declares most legal Kongs | Avoids Kongs that damage waits | Models replacement value, information exposure, and robbing risk |
| Win | Always declares legal Win | Always declares legal Win | Always declares legal Win |
| Defense | None beyond discarding isolated tiles | Uses obvious visible exhaustion and late-hand caution | Ranks provably safe, strongly inferred safe, and unknown-risk tiles |
| Value pursuit | Low | Moderate | Contextual to score, dealer, and wall |
| Timing | 0.8-1.8 seconds | 0.9-2.0 seconds | 1.0-2.3 seconds |

All difficulties immediately expose mandatory Flowers, always declare a legal Win, and otherwise Pass when a claim does not satisfy their row. Discard selection considers every legal discard. Easy samples with a strong bias toward isolated tiles; Medium optimizes effective visible draws; Hard compares expected table-point gain/loss, including dealer relationship, continuation, remaining wall, and cap/table-point context. No bot waits beyond its reaction interval to gain timing advantage.

"100% safe" means the public-state solver proves that no assignment of still-unseen tiles consistent with the rules could make the candidate discard complete any currently eligible opponent hand. A current temporary discard-Win lock is part of that proof. An opponent's own prior discard does not create permanent safety in Taiwanese v1.1, and a merely exhausted-looking tile is not called safe if the candidate itself could be claimed. All non-proven tiles retain non-zero risk. Hard may fold when an opponent is visibly Ting/high-value, fewer than 24 drawable tiles remain, and preserving expected loss is better than hand completion.

### 11.4 Strength and reproducibility

In at least 10,000 same-seed seat-rotated simulations:

- Easy against three Medium bots should finish first 10% to 18% of the time;
- Medium mirror matches should place approximately uniformly, each first-place rate 22% to 28%;
- Hard against three Medium bots should finish first 34% to 42% of the time.

Against a deterministic one-ply efficiency reference on nonterminal discard decisions, Easy intentionally chooses outside the reference's top set 35% to 50% of the time, Medium 10% to 20%, and Hard no more than 5%. Each seat receives a seeded style offset of at most 5% toward Speed, Value, or Caution so repeated bots are not identical. Difficulty never adapts to the human, reads rating, rubber-bands, or changes after wins/losses.

AI decisions must be deterministic from rules version, AI version, difficulty, complete legal observation, and a recorded bot-randomness seed. Production uses controlled random variation within the deterministic seed. Decision calculation has a 250 ms server budget; timeout falls back to the Medium legal policy, then canonical auto-discard if needed. Replays retain the AI version and seed; executable behavior or an equivalent decision fixture remains available for at least the 180-day raw-match retention window.

### 11.5 System impact

AI Practice and private bot results grant no Jade, rating, public statistics, achievements, ordinary missions, or leaderboard progress. AI Practice hands and completed private matches grant only the capped participation XP in Section 12.1. Completing one AI Practice hand can satisfy the same-day welfare prerequisite and an explicitly labeled onboarding mission; neither is treated as competitive progress.

Disconnect-takeover results remain part of the original human public match. Jade settlement and opponent rewards remain valid; the absent player receives no action bonus XP after takeover and may receive an abandonment rating penalty. Bot bankroll does not exist because public bots are not seated.

Hong Kong and Riichi AI are deferred with those modules. Future difficulty labels must be calibrated separately rather than assumed equivalent.

## 12. Progression, rating, statistics, and leaderboards

Resolves: PRO-01 through PRO-09.

### 12.1 XP awards

XP measures participation and mastery; it never changes matchmaking strength or table eligibility.

| Event | XP |
| --- | ---: |
| Complete or intentionally skip onboarding, once | 500 |
| Complete AI Practice hand | 25, maximum 200 per UTC day |
| Complete public human Quick Play hand | 100 |
| Win a public human hand | 75 |
| Win by Zimo | 25 |
| Raw Tai bonus | 10 per Tai, maximum 100 per hand |
| Chow or Pong claim | 0 |
| Declare a legal Kong | 5 each, maximum 20 per hand |
| Complete each public Full Rotation hand | 50 |
| Full Rotation final placement | 1st 400, 2nd 250, 3rd 150, 4th 100 |
| Complete private match | 25, maximum 200 per UTC day |
| Achievement | As listed in Section 12.3 |

Action bonuses apply only to public human matches. A player whose seat is under takeover control for more than half of a hand receives completion XP only. Voided or incomplete matches grant no XP. Repeated same-opponent private play and AI play cannot advance achievements or missions.

Mission XP uses Section 13.3 and achievement XP uses Section 12.3; neither is silently included in hand XP. All daily caps reset at 00:00 UTC. Server event IDs make every award idempotent.

### 12.2 Level curve and rewards

Accounts start at Level 1. XP needed to advance from level L to L+1 is:

**500 + 100 x (L - 1)**

The Version 1 cap is Level 50. Excess XP is retained but does not display a higher level. There is no prestige reset.

All gameplay modes unlock after onboarding; level never gates a lobby. Rewards are:

- Level 2: "Student" title;
- Level 5: Tea House table theme;
- Level 10: Jade tile skin;
- Level 15: Bamboo avatar frame;
- Level 20: Night Market table theme;
- Level 25: "Steady Hand" title;
- Level 30: Jade Ring avatar frame;
- Level 35: "Wall Reader" title;
- Level 40: Tea Blossom avatar frame;
- Level 45: "Table Veteran" title;
- Level 50: "Mahjong Master" title and Master frame.

High Contrast tiles are accessibility content and are available at Level 1. If the curve changes, the server recomputes level from lifetime XP and grants newly earned rewards retroactively; it never revokes an already granted entitlement.

### 12.3 Launch achievements

All achievements are visible, account-wide, non-repeatable, and require eligible public human play unless stated.

| Achievement | Exact trigger | Reward |
| --- | --- | ---: |
| First Hand | Complete first public hand | 100 XP |
| First Win | Win first public hand | 200 XP, "First Victory" title |
| Self Reliant | Win by Zimo 10 times | 300 XP |
| Claim Student | Complete 50 Chow or Pong claims | 300 XP |
| Kong Collector | Complete 25 legal Kongs | 300 XP |
| Ready Regular | Reach Ting in 100 completed public hands | 500 XP |
| All Pongs | Win with All Pongs | 500 XP, "Pong Specialist" title |
| Pure Hand | Win with Full Flush | 750 XP, Pure Hand frame |
| Dragon Caller | Win with Big Three Dragons | 1,000 XP, "Dragon Caller" title |
| Four Winds | Win with Big Four Winds | 1,500 XP, Four Winds frame |
| Full Rotation Regular | Complete 10 public Full Rotation matches | 750 XP |
| Clean Defense | Complete a Full Rotation without dealing into a Win | 1,000 XP, "Clean Defender" title |
| High Value | Win with at least 5 raw Tai | 300 XP |
| Master Craft | Win with at least 10 raw Tai | 750 XP |
| Kong Robber | Win by Robbing an Added Kong | 500 XP |
| Replacement Artist | Win with Win After Replacement | 300 XP |
| Last Chance | Win with Last Tile Zimo | 500 XP |
| Quiet Strength | Win with Concealed Zimo | 300 XP |
| Three of a Mind | Win with Three Concealed Pongs or a higher concealed-Pong tier | 500 XP |
| Half and Half | Win with Half Flush | 300 XP |
| Garden Party | Win with Complete Seasons or Complete Flowers | 500 XP |
| Honor Guard | Win with All Honors | 1,000 XP, "Honored" title |
| Eightfold Bloom | Win with Eight Flowers | 1,500 XP, "Eightfold" title |
| Self Reliant II | Win by Zimo 50 times | 750 XP |
| Claim Scholar | Complete 250 Chow or Pong claims | 500 XP |
| Kong Master | Complete 100 legal Kongs | 750 XP |
| Ready Veteran | Reach Ting in 500 completed public hands | 1,000 XP |
| Hundred Hands | Complete 100 public hands | 500 XP |
| Centurion of the Table | Complete 500 public hands | 1,000 XP, "Centurion" title |
| Rotation Master | Complete 50 public Full Rotation matches | 1,000 XP |
| Podium Regular | Finish 1st in 10 public Full Rotation matches | 750 XP |
| Stone Wall | Reach a no-deal-in streak of 10 eligible public hands | 500 XP |

Achievement counters are event-log derived and rules-version aware. Corrected historical events update counters; revoked cheating results are removed.

There are no hidden launch achievements, and every numbered progression (for example Self Reliant and Self Reliant II) is fully visible. Every trigger is derivable from the retained event log and the Section 12.7 statistics definitions. The UI shows exact current/target progress for count achievements and a localized requirement/reward description for every achievement. English and zh-TW ship together. Rules changes may recalculate a counter only from retained canonical events; an already granted cosmetic is never revoked for an ordinary rules correction.

### 12.4 Rating algorithm

"ELO Matrix" is replaced by a transparent four-player pairwise Elo rating for public Full Rotation only.

For every pair of players i and j:

**Expected(i,j) = 1 / (1 + 10 ^ ((Rating(j) - Rating(i)) / 400))**

Actual pair score is 1 for higher final table points, 0 for lower, and 0.5 for equal table points.

For player i:

**Delta(i) = K / 3 x sum over the other three players of (Actual(i,j) - Expected(i,j))**

K is 40 for a player's first 20 completed rated matches and 24 afterward. Deltas are rounded to integers using largest-remainder allocation while preserving an exact table-wide sum of zero. The result screen shows old rating, expected placement band, raw delta, abnormal penalties if any, and new rating.

Worked examples:

- Four established players all rated 1500 finish strictly 1st through 4th. Every pair expectation is 0.5; K = 24 produces deltas +12, +4, -4, and -12.
- The same result during provisional K = 40 produces +20, +7, -7, and -20 after zero-sum integer allocation.
- If players finish on exactly equal table points, their pair score is 0.5 regardless of the display-podium tie-break; four equal ratings and four equal point totals therefore produce 0 each.

If an ordinary negative delta would cross the 500 floor, that player's loss is reduced to the floor and positive deltas are reduced proportionally, with largest-remainder allocation, until the match Elo deltas again sum to zero. The floor never creates rating from a match.

### 12.5 Rating lifecycle

- Public ranked Full Rotation requires a linked, non-Guest identity in good standing; free disposable guest accounts cannot enter ranked queues.
- Starting rating: 1500.
- First 20 matches: Provisional; rating is visible with a Provisional label, and leaderboard rows for provisional players carry the same label.
- Rating floor: 500.
- Display precision: whole rating points only.
- No inactivity decay.
- Season length: 12 weeks.
- Season reset: 1500 + 0.75 x (ending rating - 1500), rounded to integer.
- Tiers: Bronze below 1300; Silver 1300-1499; Gold 1500-1699; Jade 1700-1899; Dragon 1900 and above.
- Rating is one Taiwanese Full Rotation rating across regions and timer presets. Quick Play, private rooms, AI, and future rulesets do not use it.

Matchmaking uses the current pre-match rating. A season reset occurs between matches only.

There are no separate placement matches or hidden uncertainty value. The first-20 K factor is the provisional acceleration. Multi-account/device signals, impossible improvement, collusion, and repeated opponent patterns enter anti-abuse review; rating, cosmetics, or history cannot transfer between established accounts. Together with the linked-identity requirement for ranked play, this is the current smurf-mitigation contract.

### 12.6 Abnormal rating results

- Equal table points are pairwise ties even if podium display tie-breakers differ.
- Multiple winners and exhaustive draws affect table points normally and need no special rating rule.
- A player who disconnects but returns and does not abandon receives the normal result.
- Match Elo is calculated normally and remains zero-sum. An abandoned player then receives a separate disciplinary adjustment so their total change is the lower of the normal delta and -40 established / -60 provisional, without crossing the 500 rating floor. That extra loss is not distributed to opponents and is labeled separately from Elo.
- Server-voided or incomplete Full Rotation matches produce no rating.
- Private, AI, or mixed-bot matches produce no rating.
- Confirmed cheating removes the match from every affected rating history and recomputes from the season checkpoint; sanctions are separate.

### 12.7 Statistics

Public profile statistics are split into Quick Play and Full Rotation and can be filtered by current season, lifetime, and rules version:

- hands completed;
- hand Win rate = hands won / eligible completed hands;
- Zimo share = Zimo wins / all wins;
- deal-in rate = hands in which the player discarded at least one winning tile / eligible completed hands;
- Ting reach rate = hands in which the player entered a legal Ting state before the terminal event / eligible completed hands;
- average raw Tai per win;
- Chow, Pong, and Kong counts;
- Full Rotation 1st/2nd/3rd/4th percentages;
- Full Rotation average table-point delta;
- disconnect and abandonment counts;
- longest Win and no-deal-in streaks.

The product does not collapse Mahjong into a binary Win/Loss ratio. It shows Win rate, exhaustive-draw share, and non-winning-hand rate, where non-winning includes another player's Win or an exhaustive draw in which the player did not win. Full Rotation placement percentages use completed rated matches as their denominator and sum to 100%. A Win streak is consecutive eligible public hands with at least one Win; a no-deal-in streak is consecutive eligible public hands in which none of the player's discards completed an opponent hand. One multiple-winner discard counts as one deal-in hand for the discarder and one Win for each winner. Administrative voids and ineligible bot/private matches are excluded. Profiles show percentages only after 20 eligible hands. Users may set statistics to Friends or Private; rating tier and current season leaderboard rank remain public.

### 12.8 Leaderboards

Version 1 has one seasonal Taiwanese Full Rotation rating leaderboard per launch region and one global view. Region is the account's supported market, recorded at account creation from the onboarding market declaration and never derived from IP geolocation at read time. Region is pinned at season start and cannot change during that season; Support may correct a verified region between seasons. Eligibility requires 10 completed rated matches and a linked account in good standing; players still inside the 20-match provisional window are listed with the Provisional label. Sort order is rating, then more rated matches up to 100, then lower abandonment rate, then earlier achievement of the rating.

The leaderboard refreshes at least every 15 minutes. It grants profile titles and frames only, never Jade or real-world value. At season end, participants with at least 10 completed rated matches receive the "Seasoned Player" title, the top 10% receive the numbered Season Crest frame, and the top 1% also receive the "Season Champion" title. Rewards are mailed within seven days; the highest earned tier includes lower-tier rewards.

### 12.9 Quick Play seasonal ladder

The Quick Play ladder gives the high-volume, short-session mode a seasonal goal without touching Elo, matchmaking, or Jade.

- Seasons share the 12-week ranked calendar.
- Ladder points accrue only in public human Quick Play: 3 points per hand won plus 1 point per completed hand, counted for at most the first 10 completed public Quick Play hands each UTC day.
- Points never affect matchmaking, Jade settlement, rating, or lobby eligibility, and are not a currency.
- Per-region and global ladder leaderboards refresh on the Section 12.8 cadence. Listing requires a linked account in good standing; guest accounts accrue points that become visible after linking.
- Season rewards are cosmetic only and are mailed on the Section 12.8 schedule: at least 150 ladder points earns the "Quick Study" title; the top 10% per region earns the numbered Quick Crest frame. The higher tier includes the lower-tier reward.
- Ladder points from voided hands or sanctioned abuse are removed by the same event-log recomputation contract as achievements.

## 13. Monetization, missions, live operations, and content

Resolves: MON-01 through MON-12.

### 13.1 Monetization decision

Beta and Version 1 are free and have:

- no premium currency;
- no Tael/Jade purchase or exchange;
- no in-app purchase or checkout integration;
- no rewarded or interstitial advertising SDK;
- no paid or free battle-pass interface;
- no rotating shop;
- no paid ticket or tournament;
- no loot box, random purchase, or paid tier skip.

Purchase, receipt, refund, chargeback, restore, ad-failure, price, discount, and paid-pass requirements are therefore not applicable to the current scope. No placeholder store or premium balance is shown.

Any future monetization requires a new approved specification, market-by-market legal and platform review, updated age rating, economy simulation, refund/support policy, and explicit decision on whether gameplay currency remains permanently non-purchasable. Current development planning must not include dormant payment or ad code.

### 13.2 Earned cosmetic catalog

Version 1 cosmetics are permanent, account-bound entitlements:

| Slot | Launch catalog |
| --- | --- |
| Tile face, one equipped | Classic Ivory, High Contrast, Jade |
| Table theme, one equipped | Classic Green, Tea House, Night Market |
| Avatar frame, one equipped | None, Bamboo, Jade Ring, Tea Blossom, Pure Hand, Four Winds, Master, numbered Season Crest, numbered Quick Crest |
| Title, one equipped | Mahjong Player, Student, First Victory, Steady Hand, Wall Reader, Table Veteran, Mahjong Master, Pong Specialist, Dragon Caller, Clean Defender, Seasoned Player, Season Champion, Honored, Eightfold, Centurion, Quick Study |
| Emote visual style, one equipped | Default styling for the eight approved preset emote meanings and the 24-phrase palette; no alternate paid styles at launch |

Tile faces and table themes are local-only presentation choices. Frames, titles, and the selected preset-emote styling are visible to opponents, subject to their suppress-opponent-effects setting. Every item has a preview and Reset to Default action. There are no gameplay animations, music packs, voice packs, random entitlements, duplicates, consumables, trading, gifting, expiry, or inventory capacity.

Cosmetics are earned through levels, achievements, or seasons. Every tile skin must preserve standard symbols, accessible names, contrast, size, and color-independent identity. Cosmetics work across Quick, Full Rotation, AI, and private modes. A future ruleset can use an item only when its compatibility metadata confirms that every required tile/symbol exists; otherwise the UI equips that ruleset's default without unequipping the account choice.

Cosmetic production capacity is the long-lead prerequisite for the Section 2.8 monetization hypothesis; the catalog and the Section 13.5 cadence are sized to grow rather than restart if that hypothesis is ever approved.

### 13.3 Daily and weekly missions

Version 1 uses free missions only.

Daily reset is 00:00 UTC. Daily missions are:

- complete one public Quick Play hand: 250 Jade;
- complete three public Quick Play hands: 500 Jade;
- reach Ting twice in public human play: 100 XP.

Weekly reset is Monday 00:00 UTC. Each account receives three deterministic, rules-eligible missions selected from a reviewed catalog, such as complete ten public hands, win twice, declare three Kongs, or finish one Full Rotation. Weekly rewards are XP and progress toward the free seasonal cosmetic.

AI Practice, private rooms, abandoned matches, and voided hands do not progress missions except an explicitly labeled AI Practice onboarding mission. Missions never require a rare named hand. No reroll is needed at launch. Progress is event-log based; completed rewards remain claimable for seven days after reset.

If a future ruleset is unavailable to an account, missions specific to that ruleset are not selected or shown. A rules change cannot invalidate already-earned progress; a retired mission is auto-completed only when its event was already satisfied, otherwise it is replaced with an equivalent eligible mission without a reroll charge.

### 13.4 Live configuration

Authorized Live Operations roles may remotely configure:

- lobby open/closed state, minimum balance, stake, and debit cap;
- queue region routing and rating expansion bands;
- public timer presets within the Section 5.10 approved bounds, new matches only;
- queue-offer thresholds such as the 90-second alternative offer;
- XP and welfare grants within approved bounds;
- mission catalog, dates, and rewards;
- announcement banners and mail;
- season dates and cosmetic IDs;
- maintenance messages;
- feature flags for already-shipped, approved capabilities;
- minimum supported client and rules version for new matches.

Rules patterns, legal actions, settlement algorithms, account age gate, data retention, payment capability, and hidden-information boundaries cannot be changed by ordinary live configuration.

Every change requires a ticket/reason, author, approver, effective time, environment, before/after value, and rollback value. Economy, rules, or reward changes require two-person approval. Production preview and staging validation are mandatory. Emergency rollback is one action and is audit logged.

### 13.5 Content cadence

Ranked seasons last 12 weeks. The sustainable Version 1 cadence is:

- one free seasonal frame or table accent;
- one culturally reviewed announcement/theme treatment;
- one refreshed weekly mission catalog;
- maintenance and rulebook notes as needed.

Seasonal content is additive and may be delayed without blocking core play. No event may change rules, settlement, or public matchmaking without a separately versioned requirement. Lunar New Year and Mid-Autumn are anchor moments for the core audience: each receives, at minimum, a themed table accent or frame, an event mission set drawn from the reviewed catalog, and a reviewed announcement treatment, all inside the standard content-lock lead times. Their content requires review by a fluent zh-TW cultural reviewer. Music and art licenses must permit global web distribution for the product's lifetime.

The Live Operations Lead owns the calendar and release checklist. Source copy, reward IDs, and art must be content-locked at least 15 business days before activation; English/zh-TW localization and cultural review receive at least 10 business days. If an asset or translation misses approval, the team delays or omits that content and uses the evergreen mission catalog; it does not ship untranslated, unreviewed, or substitute scarcity content.

Ticketed tournaments, bracket administration, qualification, prizes, spectator delay, and tournament substitution are deferred in full. If tournaments are later approved, they must not offer cash, transferable value, or paid entry under the current product identity.

## 14. Future ruleset module boundaries

Resolves: FUT-01 through FUT-10.

### 14.1 Current commitment

Hong Kong and Riichi are **architecture-ready only**. Current planning must preserve product-level extension contracts but must not estimate or implement playable rules, scoring, tutorials, AI, queues, economy tuning, achievements, or release content for either module.

The extension contract must be capable of supplying, without Taiwanese constants leaking across the boundary:

- tile catalog and hand size;
- setup/deal/wall/dead-wall procedure;
- legal state transitions and claims;
- claim precedence and multiple-winner policy;
- legal hand evaluator;
- scoring patterns and canonical decomposition;
- settlement and match-end rules;
- dealer/round/match progression;
- terminology and localization;
- player-assist visibility;
- tutorial content;
- AI observation/action contract;
- rules version and deterministic replay metadata;
- cosmetic compatibility metadata.

This is a product interoperability requirement, not an implementation design.

### 14.2 Release order

The PRD preference of Hong Kong before Riichi is retained as a hypothesis, not a release commitment. A future Product Owner may select order based on market demand, rules-authority availability, localization, and operational capacity. Neither module is assigned to Beta or Version 1.

### 14.3 Authoritative future sources

If approved:

- Hong Kong uses the Hong Kong Mahjong Association's English Hong Kong Mahjong rules in force when module specification begins.
- Riichi uses World Riichi Championship Rules 2025 or its formally adopted successor, pinned at specification approval.

Each module requires its own fluent Rules Lead and full golden suite before development planning for that module.

### 14.4 Deferred Hong Kong decisions

The PRD's 136/144 tile toggle, Flower scoring, minimum Fan, Fan-to-points table, caps, special hands, multiple winners, Chombo, and public/private options are not current requirements. They will be copied from and reconciled against the selected HKMA source in a separate specification.

The phrase "4 Fan -> 8 Fan -> 16 Fan" is rejected as an invalid mixing of Fan and payout. A future module must maintain separate Fan count and point/payment conversion.

A future digital Hong Kong client will show only legal Win actions. A sub-threshold completed shape is not a player Chombo through normal UI; malicious invalid submissions are rejected. Any tournament penalty system belongs to the separate module specification.

### 14.5 Deferred Riichi decisions

The PRD's four red fives are rejected. WRC Rules 2025 uses **no red fives**, so a future WRC-based module defaults to none.

All Riichi details, including Yaku, Yakuman, Han/Fu, limits, starting points, East/South rounds, Honba, Riichi deposits, Dora/Ura/Kan Dora, Ippatsu, Furiten, Chankan, one-winner precedence, exhaustive draws, no abortive draws, no Nagashi Mangan, liability payment, and Chombo/penalties, come from the pinned WRC rules and are not redefined here.

### 14.6 Shared and separate account systems

Future modules share identity, friends, account level, general cosmetics, accessibility settings, mail, and non-rules-specific achievements. They have separate:

- rules versions;
- tutorials;
- AI calibration;
- queues and matchmaking ratings;
- gameplay statistics and leaderboards;
- lobby/economy configuration;
- rules-specific missions and achievements;
- tile art compatibility where the tile catalog differs.

The navigation shell and settings model are shared, but rules terminology, action labels, timer presets, score presentation, assists, tutorials, and rulebook content come from the active module. The store remains absent unless a later account-wide monetization specification approves it.

Jade may remain an account-wide non-purchasable balance, but no future module may use it until that module's settlement and economy are explicitly approved. There is no rating, statistic, mission, achievement, or lobby-tier conversion between rulesets. Account XP remains shared only for explicitly eligible module events, with rates approved in that module's specification.

## 15. Beta, analytics, privacy, reliability, security, and support

Resolves: OPS-01 through OPS-15.

### 15.1 Closed Beta design

Beta is a six-week, invite-only web test for at least 500 unique players in the United States, Canada excluding Quebec, and Taiwan. It supports English and Traditional Chinese on the device/browser matrix in Section 3.

Required Beta capabilities are Tutorial, AI Practice, public human Bamboo Quick Play, Guest accounts, email magic link, friends, private Quick Play rooms, Jade ledger, basic XP tracking, Rulebook, Settings, accessibility, Feedback, support Match IDs, analytics, live maintenance notices, and operations/admin access needed to run the test. Other Jade tiers may be enabled for controlled economy tests but are not a public Beta promise.

Experiments may change onboarding copy, UI placement, and non-economic visual presentation. They may not change rules, shuffle, timers, hidden information, settlement, welfare, rating, or reward values without a versioned product decision.

The Product Owner approves Beta exit only after every Section 2.5 gate and the acceptance requirements in Section 16 pass.

### 15.2 Analytics events and funnels

The minimum event model includes:

- app load, compatibility result, consent state, localization, and session end;
- Guest creation, link start/success/failure, login, logout, recovery, policy acceptance, and deletion request;
- onboarding choice, tutorial chapter/step start, error, retry, skip, and completion;
- lobby impression, eligibility, queue enter/expand/cancel, reservation, and match start;
- every authoritative gameplay command and resulting state transition, using tile IDs opaque to general analytics;
- claim offered/responded/resolved, timeout, reconnect, takeover, quit, Win, draw, scoring, cap, and dealer transition;
- Jade reserve, transfer, grant, welfare, reversal, and reconciliation result;
- XP, level, achievement, mission, rating, statistic, and leaderboard events;
- friend request/invite/block, preset emote/mute, mail claim, report, sanction, and appeal;
- settings/accessibility changes;
- client/server errors, latency, frame time, crash, desync, and service dependency health.

Core funnels are load-to-playable, identity-to-onboarding, tutorial completion, queue-to-match, first-match completion, repeat play, welfare recovery, and Full Rotation completion. Product analytics must use event schemas and reason codes, not parse display text.

The Closed Beta minimum is the subset above for capabilities actually shipped in Section 15.1: load/consent, Guest and magic-link identity, onboarding/tutorial, Bamboo lobby/queue, every game transition, reconnect/quit, scoring/dealer, Jade ledger, basic XP, friends/private rooms, feedback, reliability, and errors. Version 1 adds the remaining identity providers, Full Rotation/rating, progression, Quick Play ladder, mail, safety, and leaderboard events. Store, purchase, ad, and tournament events do not exist.

Named health dashboards, required as acceptance deliverables, include: tutorial step-level funnel; claim-window timeout rate segmented by account age; queue-abandonment rate and the take-rate of the 90-second alternative offer; dealer versus non-dealer net Jade delta in Quick Play; the 60-minute capped-match share in ranked Full Rotation; and per-tier Jade balance percentiles with faucet-to-cap ratios.

### 15.3 Analytics consent and privacy

Essential operational telemetry covers authentication, security, authoritative gameplay, ledger, reliability, and support; it is required to provide the service and is documented in the Privacy Policy. Optional product analytics and user-experience measurement require consent where applicable and can be disabled without blocking play.

General analytics uses pseudonymous account IDs and coarse country/region, never raw email, full IP, birth date, access token, free-form support text, or opponent concealed tiles. Raw authoritative match logs are segregated from analytics and access-controlled for support, rule verification, and anti-cheat.

Data access follows least privilege. Export and deletion use Section 10.4. Launch data stores are in the United States with a documented Taiwan transfer notice; a future region with localization/data-residency requirements requires separate review.

The product uses a first-party event contract and server-side collection endpoint. No advertising, attribution, session-replay, fingerprinting, or social-marketing SDK is permitted. A hosted analytics or crash-reporting processor may be selected only after Privacy/Security review, a data-processing agreement, regional transfer review, field allowlist, deletion support, and proof that concealed tiles and credentials are excluded. The provider choice is not a product dependency.

### 15.4 Capacity targets

| Measure | Closed Beta | Version 1 |
| --- | ---: | ---: |
| Registered accounts | 1,000 | 100,000 |
| Monthly active users | 750 | 30,000 |
| Daily active users | 300 | 10,000 |
| Peak concurrent users | 150 | 2,500 |
| Concurrent matches | 45 | 750 |
| Event/launch burst | 2x normal peak for 30 minutes | 3x normal peak for 60 minutes |

No tournament capacity is included. Traffic is expected to split primarily between western North America and Taiwan/nearby Asia.

### 15.5 Real-time performance

Measured for players within the supported region and at up to 150 ms round-trip network latency:

| Operation | Target |
| --- | --- |
| Client command acknowledgement | p50 100 ms, p95 200 ms, p99 400 ms |
| Authoritative state update after accepted command | p95 250 ms, p99 500 ms |
| Claim resolution after final response/deadline | p95 300 ms |
| Reconnect to interactive synchronized state | p95 3 seconds, p99 8 seconds |
| Queue time with at least 16 eligible players | p50 30 seconds, p95 90 seconds |
| Result settlement visible after terminal event | p95 2 seconds |

At estimated latency above 150 ms, the UI warns the player before queueing. Above 300 ms or with sustained packet loss over 10%, public ranked Full Rotation is disabled for that session; Quick Play remains available with warning. Jitter and reconnect behavior must not reveal private claim responses.

Supported quality is smoothed round-trip latency at or below 150 ms, p95 jitter at or below 50 ms, and packet loss at or below 2%. Between those values and the ranked-disable threshold, the connection indicator warns amber and telemetry records degraded play. Nonessential standard animations complete within 600 ms and Reduced Motion transitions within 150 ms, as specified in Section 9.11; neither blocks input acknowledgement.

### 15.6 Client performance

Targets on the minimum device matrix are:

- initial application shell at or below 5 MB compressed;
- first-play required assets at or below 25 MB compressed;
- routine incremental deployment download at or below 10 MB compressed, with optional cosmetics fetched on demand;
- cached repeat load to interactive at or below 3 seconds p75 on broadband;
- 60 frames per second target and no sustained period below 30;
- JavaScript heap plus graphics memory below 300 MB on mobile and 500 MB on desktop;
- gameplay network traffic below 5 MB per player-hour after required assets, excluding an explicit user-requested export;
- no sustained thermal-throttling state in a 60-minute reference-device soak and no more than 10% battery use in a 30-minute Wi-Fi match at 50% screen brightness on the selected launch reference devices;
- no unbounded battery/network activity while backgrounded;
- foreground resume to synchronized state within 5 seconds p95, verified against the iOS interruption matrix in Section 16.1;
- persistent-storage request where the browser supports it, with the Guest data-loss warning surfaced when persistence is not granted;
- crash-free sessions at least 99.5% Beta and 99.8% Version 1.

When backgrounded, rendering and audio stop, no local timer assumption is made, and only platform-permitted connection/notification work remains. Reduced Effects lowers animation density, shadow quality, and background motion without changing rules, timers, or tile readability.

### 15.7 Availability, durability, and recovery

- Beta monthly availability objective: 99.5%; Version 1: 99.9%, excluding announced maintenance.
- Announced maintenance should provide 24-hour notice and block new queues at least 10 minutes before shutdown.
- Accepted gameplay events are durably appended before acknowledgement.
- A settled Jade ledger event has effective RPO 0.
- Account/profile configuration RPO is at most 1 minute.
- Service RTO is 60 minutes for a region-wide failure and 15 minutes for an ordinary rollback.
- Match instances are recoverable from deterministic snapshots plus event logs; snapshot interval is no greater than 30 seconds.
- Production changes support one-version rollback. Schema/data changes require a tested forward-recovery path.
- Encrypted backups are taken daily, retained for 35 days, access-tested continuously, and restored in a non-production exercise at least quarterly.
- A region failure routes new sessions to a healthy region only when identity, rules version, and ledger consistency are available there. Active matches recover from replicated state when safe; otherwise Section 8.8 voids them rather than inventing results.

Incident compensation is based on evidence: reverse invalid debits first, then mail a fixed service grant only when a documented incident materially blocked or invalidated play. Compensation cannot be improvised without an audited Live Operations reason.

### 15.8 Server authority and anti-cheat

The server is authoritative for shuffle, wall, hands, legal actions, deadlines, claims, AI observation, scoring, settlement, XP, rating, achievements, missions, and match completion. Clients render authorized state and submit intent only.

Every command contains session, match, actor, expected state version, action ID, and idempotency token. The server validates authorization, turn, deadline, legal action, and replay protection. Clients never receive opponent concealed tiles, unrevealed wall order, other players' unresolved claims, or future randomness.

Security controls include request rate limits, command anomaly detection, session/device risk signals, automation timing analysis, ledger reconciliation, repeated-opponent/collusion analysis, and tamper-evident admin audit logs. Web browser integrity signals may inform risk but may not categorically exclude rooted/jailbroken devices because the product is web-based.

Sanctions require human-reviewable evidence for permanent action. False positives have the appeal process in Section 10.8.

### 15.9 Shuffle fairness

Each hand uses a cryptographically secure random seed and unbiased Fisher-Yates shuffle on the server. The seed, rules version, ordered tile catalog hash, and resulting wall hash are committed to the private immutable match log before the deal. Production operators cannot select or retry a seed except through an auditable administrative void.

Acceptance includes statistical uniformity tests, deterministic replay tests, property tests, and one million randomized hands per release candidate. Beta does not publish seeds because public verifiable-shuffle UX is future scope. Trust and Safety and Rules Lead can retrieve an audit package by Match ID.

No external gambling/RNG certification is required for Beta or Version 1 because there is no purchase, cash-out, or prize. The public Rulebook includes a plain-language fairness statement covering server shuffle, no operator seed retry, and audit by Match ID. Raw seeds remain available only to specifically authorized Security/Rules staff after a hand and are never exposed through ordinary support or analytics.

### 15.10 Security baseline

The web service targets OWASP ASVS Level 2 controls appropriate to the selected technology. Mandatory product requirements are:

- TLS 1.2 or later in transit and managed encryption at rest;
- secrets stored outside source and rotated;
- short-lived access tokens and rotating revocable refresh sessions;
- session invalidation on passwordless identity compromise, account deletion, sanction, or explicit logout-all;
- administrator MFA and role-based least privilege;
- no general-purpose support impersonation; time-limited audited read-only account views and explicit approved ledger adjustments;
- two-person approval for economy/rules production changes;
- dependency and container scanning, secure headers, CSRF protection where cookies are used, output encoding, and rate limiting;
- security/audit logs that exclude secrets and hidden hand content unless in the segregated match log;
- a documented incident response and breach-notification process;
- security review of every third-party identity, analytics, error-reporting, and hosting vendor.

Access tokens expire within 15 minutes. Recoverable-account refresh sessions have a 30-day inactivity window and 90-day absolute lifetime; rotation/reuse detection revokes the session family. Sensitive identity link/unlink, export, deletion, and logout-all actions require recent reauthentication. Guest credential inactivity follows Section 10.1.

A suspicious login creates an in-product/email notice where possible, can require identity reauthentication, and revokes high-risk sessions. Security intake is continuously monitored. Incident response must preserve evidence, assess notification duties immediately, and notify users/regulators within the applicable legal deadline. Critical vendors receive pre-launch review and at least annual reassessment.

### 15.11 Legal and platform policy

Before public Version 1, qualified counsel must review the United States, Canada excluding Quebec, and Taiwan product for privacy, age gate, simulated-stakes presentation, Jade terms, promotional claims, contest law, and consumer protection.

The approved baseline deliberately removes real-money value, purchase, cash-out, transfer, paid entry, and real-world prizes. It also avoids casino imagery and player-facing "wager" language. This lowers but does not replace legal and age-rating review.

The Trust, Privacy, and Legal Lead owns the review matrix and records approval separately for the United States, Canada excluding Quebec, and Taiwan. Any future purchase, ad, tournament, prize, native-store, Quebec release, or under-13 feature reopens the relevant gambling/contest, consumer-refund, tax, language, privacy, age-rating, advertising, and platform-policy reviews before planning approval.

Native app publication is not in scope. If pursued, the team must re-check then-current Apple and Google policies and age-rating questionnaires. A future feature that accepts money or something purchased with money for a chance-based real-world prize is prohibited without a wholly separate licensed product decision.

### 15.12 Localization and cultural quality

All English and zh-TW player text uses a shared terminology glossary keyed by semantic identifier. Translation is performed by a professional game localizer and reviewed by a fluent Taiwanese Mahjong expert. Machine translation alone is not acceptable for rules, scoring, safety, or support.

Layouts support at least 30% text expansion. Dates, times, numbers, and pluralization use locale APIs. Event art and copy receive a cultural review. Tile symbols remain traditional and are paired with accessible text names. Rulebook changes require simultaneous English and zh-TW release.

Simplified Chinese and Japanese terminology are not produced for current scope. Cantonese/Mandarin spoken declarations are also absent because Version 1 has no voice content. A future Hong Kong or Riichi module must commission its own terminology glossary and expert reviewer rather than transliterating the Taiwanese glossary.

### 15.13 Support and disputes

Support is available through an in-product form and email in English and Traditional Chinese. Every request receives a receipt immediately.

General support is staffed on local business days from 09:00 to 17:00 in the team's published Pacific and Taiwan coverage windows. Security/credible-exploit intake is monitored 24/7. Holiday closures and reduced Beta coverage are shown before submission.

Targets are:

- account/security lockout or credible exploit: first response within 4 hours during staffed coverage;
- missing Jade, scoring dispute, sanction appeal: 2 business days;
- ordinary feedback/bug: 3 business days.

Support tools search by Match ID, Player ID, ledger event, and report receipt. A scoring dispute can be escalated to Rules Lead. Support can issue only cataloged compensation reason codes within role limits. Known incidents appear in the service-status banner. No support agent can change rating or rewrite a match directly.

Account recovery uses the configured identity provider or verified possession of the Guest credential; support cannot bypass identity proof. Purchase recovery is not applicable. A sanction appeal follows Section 10.8, and an unresolved widespread defect is linked to a known-issue/status entry rather than answered as unrelated tickets.

### 15.14 GTM product requirements

Closed Beta requires:

- one-use and limited-use invite codes;
- a persistent Feedback entry and optional post-match survey;
- Match ID copy action;
- status/maintenance banner;
- rules-version display;
- opt-in research contact consent;
- public privacy, terms, community, and known-issues pages.

Beta does not require tournament administration, live spectating, replay links, creator accounts, streamer overlays, referrals, promotional carousel, or public leaderboard. Version 1 adds the rating and Quick Play ladder leaderboards; friends are already present in Beta. The other items remain excluded.

Community moderation requirements are limited to curated names/catalog content, exact-ID friends, preset emotes, reports, blocks, sanctions, and appeals in Section 10. There is no external forum, Discord, creator community, or user-content moderation commitment in the product scope.

## 16. Acceptance and planning-readiness gate

### 16.1 Product acceptance

The product baseline is ready for a detailed development plan when the plan treats every requirement here as in scope, future, or explicit non-goal and does not silently reintroduce rejected PRD features.

Mandatory acceptance evidence before public release includes:

- all Section 1.3 rules evidence;
- requirements-to-test traceability for every "must" statement;
- English and zh-TW content parity;
- WCAG 2.2 AA audit plus documented game-specific exceptions;
- supported-device/browser pass, including an iOS Safari interruption matrix: incoming call, tab switch, five-minute background, storage-pressure eviction, and orientation churn, each followed by resume to synchronized state within target;
- wireframe and on-device validation of the Section 9.2 simultaneous-visibility requirement at 360 by 640 CSS pixels landscape;
- load and soak tests at Section 15.4 burst targets;
- latency, reconnect, recovery, and rollback tests;
- ledger conservation and idempotency tests;
- hidden-information and claim-privacy penetration tests;
- account export/deletion and retention tests;
- legal/privacy/security sign-off;
- Beta gates for Version 1 progression.

### 16.2 Resolved contradiction register

| Original ambiguity | Final decision |
| --- | --- |
| Broad live service versus web prototype | Beta and Version 1 matrix in Section 2.3; paid/live-service expansion deferred |
| "Four rounds" terminology | Full Rotation is one East round with four base dealer seats |
| No Taiwanese authority | Product-owned v1.1 rules, GameTower reference, Rules Lead, and golden suite |
| Exponential dealer scaling | Additive Dealer Tai = 1 + 2k, maximum k = 10 |
| "Tilted draw" | Typo; exhaustive draw uses dealer Ting rule |
| Flower automation toggle | Replacement mandatory; only animation speed is configurable |
| "3.0s mask" | Removed; explicit turn/claim deadlines in Section 5.10 |
| Tael/Jade/両 | One non-purchasable soft currency: Jade/玉 |
| Uncapped Dragon's Den | 300,000-Jade total debit cap |
| Four-player ELO Matrix | Pairwise zero-sum Elo for public Full Rotation only |
| Bots in human play | No public bot fill; disclosed disconnect takeover only |
| HK Fan ambiguity | Entire playable module deferred to HKMA-based separate specification |
| Four Riichi red fives | Rejected; future WRC-based module uses no red fives |
| Spectator-friendly GTM | Spectator/replay explicitly future, not Beta/V1 |

### 16.3 Questionnaire resolution matrix

Every clarification ID has a final disposition:

| Questionnaire IDs | Resolution section | Status |
| --- | --- | --- |
| SCP-01 through SCP-09 | Sections 1-3 | Resolved |
| PLT-01 through PLT-07 | Section 3 | Resolved |
| GOV-01 through GOV-07 | Sections 1 and 4 | Resolved |
| TWN-01 through TWN-20 | Section 5 | Resolved |
| SCO-01 through SCO-15 | Sections 6 and 7 | Resolved |
| MOD-01 through MOD-13 | Section 8 | Resolved |
| UX-01 through UX-14 | Section 9 | Resolved |
| ACC-01 through ACC-12 | Section 10 | Resolved |
| AI-01 through AI-08 | Section 11 | Resolved |
| PRO-01 through PRO-09 | Section 12 | Resolved |
| MON-01 through MON-12 | Section 13 | Resolved, with paid features explicitly out of scope |
| FUT-01 through FUT-10 | Section 14 | Resolved, with playable modules explicitly deferred |
| OPS-01 through OPS-15 | Sections 15 and 16 | Resolved |

No questionnaire item remains open. Future and non-goal decisions are deliberate scope answers, not unresolved requirements.

### 16.4 Version 1.1 review-incorporation register

Version 1.1 incorporates the 2026-07-17 design review ([mahjong-spec-review.md](mahjong-spec-review.md)). Rules-affecting changes bump the named house standard to Mahjong Taiwanese 16-Tile Rules v1.1; no public match was played under v1.0, so no migration is needed.

| Review finding | Decision | Sections |
| --- | --- | --- |
| Timeout-Pass vs discard-Win lock | Server-selected Pass never creates the lock; mandatory golden case | 5.8, 5.10, 1.3 |
| Eight Flowers / Heavenly Hand declaration undefined | Explicit offer, re-offer, and lapse mechanics defined; server still never auto-declares | 5.9, 1.3 |
| "Final drawable tile" vs back-of-wall draws | Defined as either-end removal reaching the reserve; final replacement draw stacks Win After Replacement and Last Tile Zimo | 5.9, 6.1 |
| Kong at exhaustion boundary | Counts as a completed meld for statistics, achievements, and XP | 5.2 |
| All Chows / No Honors rationale backwards | Wording corrected; non-stacking retained as anti-double-count | 6.2 |
| Dealer among multiple winners rotates | Retained with mandatory Rulebook divergence callout and expert sign-off | 5.11 |
| Pong/Kong proximity rule unconstructible | Marked as defensive server invariant | 5.6 |
| "Dealer-impossible roles" wording | Rewritten plainly | 7.3 |
| Guests could enter ranked | Ranked Full Rotation requires a linked identity in good standing | 10.1, 12.5 |
| 20-match leaderboard gate too high | Reduced to 10 with Provisional labeling; season rewards follow | 12.5, 12.8 |
| Upper lobbies dead content for years | Wind and Cloud and Dragon's Den ship closed behind population/queue-health opening criteria | 7.1, 2.3 |
| Quick Play had no progression hook | Seasonal Quick Play ladder with cosmetic rewards | 12.9, 8.3, 8.9, 13.2, 2.3 |
| Beta lacked social and durable identity | Email magic link, friends, and private Quick Play rooms move into Closed Beta; retention gates annotated | 2.3, 2.5, 8.6, 9.1, 10.1, 10.2, 15.1, 15.2, 15.14 |
| 7-second claim window punishes beginners | Bamboo interception window 10 seconds; public timers live-configurable within approved bounds | 5.10, 13.4 |
| iOS Safari/PWA lifecycle risk | Hardening requirements plus interruption acceptance matrix | 3.2, 15.6, 16.1 |
| 360 px layout feasibility unproven | Wireframe and on-device validation gate before UI implementation | 9.2, 16.1 |
| Endgame too shallow | Achievement catalog expanded from 12 to 32; three new titles | 12.3, 13.2 |
| Sociality too thin for the audience | 24-phrase curated palette; Add Friend on the result screen; result-card image export | 10.7, 9.7, 8.3, 8.10 |
| 60-second seat retention too short on mobile | 90 seconds for Quick Play and private rooms; second-device resume defined for linked accounts | 8.7 |
| Cultural moments underused | Lunar New Year and Mid-Autumn anchor events with missions and cosmetics | 13.5 |
| Faucet-only inflation unbounded | Economy review triggers, per-tier balance dashboards, faucet-to-cap tracking | 7.5, 7.1, 15.2 |
| Capped ranked matches asymmetric | Telemetry with a 5% seasonal review trigger | 8.4 |
| Quick Play dealer variance unmeasured | Mandatory dealer-delta telemetry dashboard | 8.3, 15.2 |
| No business thesis | Sustainability hypothesis recorded without approving monetization | 2.8 |
| Accessibility gaps | Mirrored left-handed layout; untimed-queue future scope; separate zh-TW screen-reader audit | 9.3, 9.9 |
| Roadmap opportunities | Discard puzzle mode, friend spectating, own-match replay, and first Jade sink recorded as prioritized future scope | 2.3, 7.5, 8.6, 8.10 |

### 16.5 Version 1.2 clarifications

Version 1.2 (2026-07-17) applies three clarifications from the technical readiness review ([mahjong-tech-readiness-review.md](mahjong-tech-readiness-review.md)). The rules standard remains Mahjong Taiwanese 16-Tile Rules v1.1; no gameplay behavior changes.

| Clarification | Sections |
| --- | --- |
| Animation-allowance mechanism defined for "animation time is not charged": fixed per-action allowance from versioned configuration, identical for all seats, independent of personal animation/Reduced Motion settings | 5.10 |
| Leaderboard region source defined: onboarding market declaration recorded at account creation, never IP-derived at read time | 12.8 |
| "Account in good standing" defined: no active sanction and not pending deletion; cooldowns do not affect it; applies specification-wide | 7.1 |
