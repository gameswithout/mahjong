# Codex Implementation Brief: Achievements & My Mahjong Journey

**Project:** Games Without — Taiwanese Mahjong
**Repository:** https://github.com/gameswithout/mahjong
**Status:** Approved product requirements + implementation guidance
**Objective:** Implement the achievement foundation and initial My Mahjong Journey UI.

## 1. Product Vision

My Mahjong Journey is the player's personal history and identity within Mahjong.

It brings together three forms of recognition:

1. **Legacy:** Dedication, longevity, and community participation.
2. **Skill:** Competitive performance and Ranked progression.
3. **Highlights:** Extraordinary Mahjong hands and memorable moments.

The experience should celebrate players without forcing daily engagement, login streaks, or unnecessary competition.

The player should be able to answer:

- How far have I come?
- What have I accomplished?
- What am I working toward?
- What makes my Mahjong story unique?
- What can I proudly show other players?

## 2. Information Architecture

My Mahjong Journey is the player's private, owner-facing progression hub.

The Public Profile is the customizable, visitor-facing presentation of that journey.

These are related but distinct experiences.

### My Mahjong Journey

Include:

- Legacy Level and XP
- Games Played and Progressive Prestige
- Living Mahjong Chronicle
- Anniversary milestones
- Community achievements
- Ranked Elo, current tier, and peak tier
- Skill achievements
- Highlight achievements
- Personal Mahjong records
- Recent milestones
- Progress toward the next meaningful achievement
- Access to cosmetic inventory and profile customization

### Public Profile

Include:

- Avatar, display name, title, nameplate, and profile frame
- Prestige title and emblem
- Public Living Chronicle
- Player-selected cosmetic showcases
- Featured achievements
- Featured verified Mahjong Highlight
- Publicly eligible statistics

Public Profiles have no comments, reactions, gifts, or guestbook in MVP.

## 3. Legacy Achievement System

Legacy measures participation and belonging, not competitive skill.

There are three Legacy categories:

### A. Games Played — Dedication

**Approved counting rule:**

One completed full dealer rotation equals one completed game.

- Ranked and Unranked both count.
- Games involving Bots count.
- Wins and losses count equally.
- Incomplete rotations do not count.
- Individual completed hands are tracked separately.
- A completed rotation must be credited exactly once.

Games Played milestones award **Progressive Prestige** and advance the **Living Mahjong Chronicle**.

#### Proposed Prestige Milestones

| Completed Games | Proposed Title |
|---|---|
| 1 | Newcomer |
| 10 | Table Regular |
| 50 | Familiar Face |
| 100 | Mahjong Veteran |
| 500 | Table Elder |
| 1,000 | Mahjong Luminary |
| 5,000 | Living Legend |

**Important:** The milestone structure is approved, but these exact thresholds and titles are still proposals.

Prestige rules:

- Prestige never decreases.
- The latest unlocked title is equipped by default.
- Previously unlocked titles remain available.
- Prestige emblems visually evolve with progression.
- Prestige represents dedication, not Skill.
- Prestige cannot be purchased with Jade.

Do not use Skill-associated titles such as competitive Grandmaster for participation milestones.

### B. Living Mahjong Chronicle

The Chronicle is a visual representation of the player's accumulated Mahjong history.

It begins as a simple Mahjong environment and develops as the player reaches Games Played milestones.

Approved behavior:

- Chronicle progression is tied to completed rotations.
- Chronicle progression is permanent.
- The Chronicle is visible from public player profiles.
- Players can personalize it with owned cosmetics.
- Prestige determines the unlocked progression stage.
- Cosmetic customization determines how the stage is presented.
- Players cannot purchase higher Prestige stages.
- No social interactions in MVP.

#### Initial Implementation

Use a small set of illustrated 2D Chronicle stages rather than an interactive 3D room.

Suggested stages:

1. First Seat — simple Mahjong table.
2. Familiar Table — decorations and signs of regular play.
3. Veteran's Room — richer environment and collectible displays.
4. Living Legend — elaborate Mahjong environment.

The exact stage-to-milestone mapping and artwork are not finalized.

For initial UI development, use clearly labeled placeholder illustrations or existing project assets.

Avoid creating a large room-building system in MVP.

### C. Anniversaries — Longevity

Anniversaries celebrate the number of calendar years since the player's first completed full dealer rotation.

**Approved rules:**

- Award an anniversary badge every year.
- Anniversary eligibility is automatic, even when the player is inactive.
- Show the celebration on the player's next visit.
- No login streak or annual activity requirement.
- Anniversary badges and rewards are permanent.
- Major milestones grant exclusive material-themed cosmetics.
- Anniversary cosmetics cannot be purchased with Jade.

#### Major Anniversary Milestones

| Year | Theme | Proposed Cosmetic |
|---|---|---|
| 5 | Wood | Wooden Mahjong tile set |
| 10 | Tin | Metallic table theme |
| 15 | Crystal | Crystal tile set |
| 20 | Porcelain | Porcelain tile set |
| 25 | Silver | Silver-themed cosmetics |
| 30 | Pearl | Pearlescent tile set |
| 40 | Ruby | Ruby-themed cosmetics |
| 50 | Gold | Golden Mahjong tile set |
| 60 | Diamond | Diamond-themed collection |

The milestone years and material themes are approved. Exact cosmetic artwork remains subject to design.

All intervening years receive numbered anniversary badges.

Use calendar anniversary calculations, including an explicit leap-day policy.

### D. Community — Relationships

Community achievements celebrate playing Mahjong with others and inviting new players.

#### Approved Referral Achievement

**Friend of Mahjong**

Unlock after three unique invited new players establish verified full accounts through email sign-in.

- No gameplay completion required.
- No self-referrals.
- No duplicate or existing-account credit.
- Preserve referral attribution through guest-to-account conversion.
- Award an exclusive permanent Friend Tile cosmetic.
- No Jade referral payout.
- Unlock must be validated server-side.

The exact Friend Tile artwork is not finalized.

#### Proposed Additional Community Achievements

- First Game Together — complete a rotation with an invited friend.
- Full Table — complete a rotation with three other humans in the party.

These additional achievements are not yet approved and should not be treated as finalized gameplay requirements.

## 4. Legacy Level and XP

Legacy Level is separate from Prestige.

**Legacy Level** provides continuous XP progression through gameplay.

**Prestige** provides milestone-based recognition through completed rotations.

Approved principles:

- Legacy Level never decreases.
- XP primarily reflects participation.
- Wins are not required for progression.
- Both Ranked and Unranked contribute.
- Bot-supported games can contribute.
- No daily streak requirements.

Exact XP awards, level thresholds, and progression curves are not yet finalized.

Implementation should use configurable rules rather than hard-coded speculative values.

## 5. Skill Progression and Achievements

Skill reflects competitive performance in Ranked Mahjong.

### Approved Ranked Rating

- Starting Elo: 1200.
- Pairwise four-player Elo calculation.
- K-factor: 24.
- Placement and ties determine rating changes.
- Ranked matches use a full dealer rotation.
- Current Elo can rise or fall.
- Peak Elo and highest-ever tier are permanent records.

#### Proposed Tier Thresholds

| Tier | Elo |
|---|---|
| Bronze | Below 1000 |
| Silver | 1000–1199 |
| Gold | 1200–1399 |
| Platinum | 1400–1599 |
| Diamond | 1600–1799 |
| Master | 1800+ |

Tier thresholds remain subject to balancing.

First-time tier promotions can grant permanent cosmetics.

There are no Ranked seasons or seasonal Elo resets in MVP.

### Skill Achievement Catalog

The exact catalog is not finalized.

Potential achievements include:

- First Ranked Victory
- First Tier Promotion
- Reach Gold
- Reach Platinum
- Reach Diamond
- Reach Master
- New Personal Elo Record

Treat these as candidate definitions until approved.

Do not automatically issue rewards for speculative achievements.

## 6. Highlight Achievements

Highlights commemorate extraordinary Mahjong moments.

Examples include:

- Rare winning hands
- Self Draw victories
- Unusual Taiwanese Mahjong patterns
- Exceptional Tai
- Personal records

### Approved Rules

- Highlight achievements are based on verified game events.
- The game engine or authoritative backend determines eligibility.
- Personal achievements can unlock in Bot-supported games.
- Players receive the full personal celebration regardless of Bot participation.
- Store the game mode and human/Bot composition as provenance.
- Public competitive recognition may apply stricter eligibility.
- Highlights are permanent entries in My Mahjong Journey.
- Shareable Highlights can link to a verified public match result.

The exact Taiwanese Mahjong pattern catalog, rarity classifications, and thresholds remain undefined.

Do not invent Mahjong pattern detection logic or statistical rarity estimates.

### Sharing

A shareable Highlight may include:

- Verified winning tiles
- Winning pattern
- Tai
- Achievement name
- Match context
- Link to the original match
- Come Play Mahjong CTA

Only expose information appropriate for a completed, publicly shareable game.

## 7. Cosmetic Collection and Public Showcase

**Approved principle: Any owned cosmetic can be showcased.**

Cosmetics may originate from:

- Jade Shop
- Legacy achievements
- Anniversary rewards
- Skill achievements
- Highlight achievements
- Friend referrals
- Future special events

### Three Independent Cosmetic States

**Owned:** The cosmetic belongs to the player's collection.

**Equipped:** The cosmetic is currently used in gameplay or the player's active identity configuration.

**Showcased:** The cosmetic is selected for display on the Public Profile or Living Chronicle.

A cosmetic does not have to be equipped in gameplay to be showcased publicly.

### Customizable Public Profile

Support these conceptual areas:

1. Identity: avatar, title, nameplate, frame.
2. Chronicle: unlocked environment and cosmetic presentation.
3. Showcase: selected owned cosmetics and achievements.
4. Personal history: featured Highlight and selected records.

The player controls which eligible cosmetics appear.

All owned cosmetics are eligible for display, subject only to available showcase capacity and compatible display types.

The number of showcase slots and whether Prestige unlocks additional capacity remain open decisions.

For MVP, use a configurable slot-based layout with a reasonable temporary capacity. Do not make additional capacity an earned Prestige reward until approved.

## 8. Suggested My Mahjong Journey UI

Build a responsive interface that supports both desktop and mobile.

### Section 1 — Journey Overview

Display:

- Avatar and display name
- Legacy Level
- Legacy XP progress
- Current Prestige title and emblem
- Completed games
- Next Prestige milestone
- Current Ranked Elo and tier
- Featured recent achievement

The overview should distinguish Legacy from Skill visually and conceptually.

### Section 2 — Living Chronicle

Display:

- Current Chronicle stage
- Illustrated environment
- Prestige progression
- Next chapter unlock
- Owner customization entry point
- Public profile preview

### Section 3 — Achievement Collections

Three top-level collections:

**Legacy | Skill | Highlights**

Within Legacy, group achievements by:

- Games Played
- Anniversaries
- Community

Each achievement should support:

- Name
- Description
- Icon or illustration
- Locked/unlocked state
- Unlock timestamp
- Progress toward unlock, if applicable
- Reward information
- Eligibility/provenance where relevant

Avoid displaying invented achievements as real unlocked accomplishments.

### Section 4 — Personal Records

Examples:

- Total completed rotations
- Total completed hands
- Current and peak Elo
- Highest-ever Ranked tier
- Highest Tai recorded
- Notable winning hands

Only display statistics supported by available authoritative data.

### Section 5 — Recent Milestones

A chronological view of recently unlocked achievements, promotions, anniversaries, and notable Highlights.

### Section 6 — Cosmetic Collection

Allow the owner to:

- Browse owned cosmetics.
- Filter by type or acquisition source.
- Equip compatible cosmetics.
- Select cosmetics to showcase.
- Preview the Public Profile.

Do not add purchasing functionality to this screen unless the existing app architecture supports it.

## 9. Data Model Guidance

Inspect the existing repository's architecture and data models before making changes.

Prefer reusing existing systems over introducing parallel achievement or profile implementations.

Conceptual entities:

### PlayerProgress

- playerId
- legacyXp
- legacyLevel
- completedRotations
- completedHands
- firstCompletedRotationAt
- currentPrestigeId
- currentElo
- peakElo
- currentRankedTier
- highestRankedTier

### AchievementDefinition

- id
- collection: legacy / skill / highlights
- category
- name
- description
- triggerType
- targetValue
- eligibilityRules
- rewardDefinition
- visibility
- status: approved / proposed

### PlayerAchievement

- playerId
- achievementId
- unlockedAt
- sourceMatchId
- provenance
- rewardGrantedAt

### ChronicleProgress

- playerId
- unlockedStageIds
- currentStageId
- customizationConfiguration

### CosmeticOwnership

- playerId
- cosmeticId
- acquiredAt
- acquisitionSource
- acquisitionReference

### ProfileShowcase

- playerId
- selectedTitleId
- selectedAvatarId
- selectedFrameId
- selectedChronicleStageId
- showcasedCosmeticIds
- featuredAchievementIds
- featuredHighlightId

Adapt names and structures to the existing repository.

Do not duplicate authoritative match records or wallet data.

## 10. Technical Requirements

- Achievement unlocks must be server-authoritative.
- Completed rotations must be credited exactly once.
- Achievement grants and cosmetic rewards must be idempotent.
- Anniversary calculations must use a consistent date policy.
- Guests must retain progress when upgrading to full accounts.
- Public profiles must not expose private account identifiers or wallet data.
- Public-facing achievement records must respect privacy settings.
- Ranked Elo must come from authoritative settlement.
- Cosmetic ownership must be validated before equipping or showcasing.
- Bot provenance must be retained for relevant achievements.
- Existing player data should be handled through backward-compatible migrations or safe defaults.
- UI must work with loading, empty, locked, and populated states.

## 11. Implementation Phases

### Phase 1 — Journey UI Foundation

Implement the My Mahjong Journey page and reusable components.

Prioritize:

- Overview
- Legacy / Skill / Highlights collections
- Prestige progress
- Anniversary section
- Chronicle preview
- Personal records
- Recent milestones

Use existing authoritative data where available and clearly identified mock fixtures elsewhere.

### Phase 2 — Progression Integration

Connect the UI to completed rotation counts, XP, Elo, achievement records, and anniversary eligibility.

Implement approved Prestige and anniversary logic with configurable definitions.

Do not finalize speculative rewards or thresholds.

### Phase 3 — Public Profile and Showcase

Implement:

- Public player profile
- Chronicle display
- Owned cosmetic collection
- Profile customization
- Showcase slots
- Equipped versus showcased state
- Profile preview

### Phase 4 — Achievement Events and Celebrations

Implement:

- Achievement unlock events
- Milestone notifications
- Anniversary celebrations
- Cosmetic reward grants
- Highlight achievement display
- Shareable Highlight entry points where supported

## 12. Acceptance Criteria

The implementation is ready for review when:

- A completed full rotation increases Games Played exactly once.
- Incomplete rotations do not increase Games Played.
- Ranked, Unranked, human, and Bot-supported eligible rotations count.
- Prestige progress displays the correct current and next milestones.
- Annual anniversary eligibility is derived from the first completed rotation.
- Major anniversary rewards follow the approved milestone schedule.
- Legacy, Skill, and Highlights appear as distinct collections.
- Players can view locked and unlocked achievements.
- The Chronicle reflects earned Prestige progression.
- Another player can view the Chronicle on a public profile.
- Players can showcase any owned compatible cosmetic.
- Showcased cosmetics do not have to be gameplay-equipped.
- Players cannot showcase cosmetics they do not own.
- Guests retain progress through account conversion.
- The interface works on mobile and desktop.
- Proposed achievements are not silently treated as approved rewards.
- No public profile social interactions are introduced.

## 13. Instructions to Codex

Inspect the current repository, existing product specification, UI components, and game data models first.

Implement an initial, reviewable My Mahjong Journey experience using the project's existing framework and design language.

Prioritize a working UI and clean, extensible architecture over completing every achievement rule.

Use mock data only where necessary, keep it clearly isolated from production data, and never invent authoritative gameplay results.

Keep approved decisions separate from proposed content.

Document any assumptions, missing backend dependencies, or conflicts with the existing specification.

Create or update tests for progression, unlock eligibility, idempotency, and cosmetic showcase ownership.

Deliver the work in reviewable phases, with a clear summary of implemented features and remaining decisions.
