> Canonical import from [2026.10 Mahjong User Engagement Spec](https://docs.google.com/document/d/116kWUljlxc5Nt99L4XGTzCJUjr-EvbDA4xZoL5NbjQE/edit), retrieved 2026-10-19. Original chapter order and draft decision labels are preserved below. Per the Product Owner, this is the replacement engagement direction; core Mahjong gameplay remains the foundation. Implement in chapter order, beginning with Chapter 2. Preserve existing work.
>
> Latest Journey supplement: [Achievements & My Mahjong Journey brief](achievements-journey-brief.md), approved 2026-10-20; [phase implementation record](achievements-journey-implementation.md). This explicitly resumes downstream Journey work.
>
> Latest Chapter 5 supplement: [New Player Onboarding](new-player-onboarding.md), approved 2026-10-19; main-menu familiarity widget plus a blank tutorial placeholder.
>
> [Supplemental decisions and implementation record](engagement-decisions-and-implementation.md) · [Chapter 2 implementation](chapter-02-game-modes.md) · [Artwork Register](artwork-register.md)

# **Taiwanese Mahjong**

## **Engagement Loop & Product Specification**

**Version:** 1.7 — Consolidated Working Draft
**Updated:** October 14, 2026
**Status:** Product decisions and future roadmap
**Repository:** [https\://github.com/gameswithout/mahjong](https://github.com/gameswithout/mahjong)

---

# **1\. Product Vision**

We are building a traditional Taiwanese Mahjong experience that combines the familiarity of playing with family and friends with modern online competition, personal progression, and community.

Our engagement philosophy is simple:

**People come to play Mahjong, stay to improve and build their Mahjong legacy, and invite others through shared experiences and memorable moments.**

We want players to feel that their time playing Mahjong contributes to a lasting personal history.

We are not designing engagement primarily around compulsory daily check-ins, streaks, or artificial urgency.

Instead, we want to cultivate three motivations:

1. **Legacy:** I've been playing Mahjong for a long time, and my journey matters.
2. **Skill:** I'm becoming a better Mahjong player.
3. **Highlights:** Something extraordinary happened, and I want to remember and share it.

These motivations come together in a feature called **My Mahjong Journey**.

## **1.1 The Core Engagement Loop**

**Discover → Join → Play → Progress → Celebrate → Share → Invite → Return**

* Discover Mahjong through friends, shared results, or learning.
* Join immediately with minimal registration friction.
* Play Unranked socially or Ranked competitively.
* Progress through Legacy XP, competitive Elo, and achievements.
* Celebrate meaningful wins, rare hands, and milestones.
* Share verified results and memorable moments.
* Invite friends into the game.
* Return for another game, a new achievement, or a better competitive result.

The game should create reasons to return naturally through play.

---

# **2\. Game Modes**

## **2.1 Unranked — Accessible and Social Mahjong**

**Decision: Approved**

Unranked is a unified matchmaking queue supporting parties of one to four human players.

Players can join alone or invite friends through a shareable party link.

Friends may join as guests without creating full accounts.

### **Matchmaking**

* Four players are required for a game.
* A party of four humans can start immediately.
* Smaller parties enter the Unranked matchmaking queue.
* Matchmaking attempts to find additional human players.
* If not enough players are available or matchmaking takes too long, Bots fill the remaining seats.
* Players can rematch together after a completed dealer rotation.

### **Progression**

Unranked does not require Jade stakes and does not affect Elo.

Players earn Legacy XP and qualify for personal achievements.

The game records the match composition:

* Four humans
* Mixed humans and Bots
* One human and three Bots

This information is important for achievement provenance and future leaderboards.

### **Onboarding**

Bot-only Unranked play can support tutorials and guided learning.

A separate top-level Practice mode is unnecessary.

### **Product Intent**

Unranked should be the easiest way to enjoy Mahjong with friends.

It should never be difficult to start a game simply because matchmaking cannot find four humans.

**Open detail:** Whether to offer a human-players-only matchmaking preference.

---

## **2.2 Ranked — Competitive Mahjong**

**Decision: Approved**

Ranked is designed for players seeking competitive recognition.

Each Ranked match consists of four independently matched human players and a full dealer rotation.

Ranked matchmaking is solo-only to reduce collusion risks.

Guests may participate, subject to the account and eligibility rules.

### **Elo Rating**

Every player begins at 1200 Elo.

The system uses pairwise Elo comparisons across all four players.

K-factor: 24\.

For each pair of players:

Expected score:

E(i,j) \= 1 / (1 \+ 10^((Rj − Ri) / 400))

Actual score:

* 1 for finishing above the opponent
* 0.5 for a tie
* 0 for finishing below the opponent

Rating change:

ΔRi \= (24 / 3\) × Σ(S(i,j) − E(i,j))

All calculations use pre-match ratings.

### **Ranked Tiers**

| Tier | Elo |
| ----- | ----- |
| Bronze | Below 1000 |
| Silver | 1000–1199 |
| Gold | 1200–1399 |
| Platinum | 1400–1599 |
| Diamond | 1600–1799 |
| Master | 1800+ |

These thresholds are illustrative and subject to balancing.

Players may move down in tier as their Elo changes.

However, the game permanently records:

* Highest Elo achieved
* Highest tier achieved
* First-time tier promotions

First-time tier promotions may unlock permanent cosmetics.

Ranked seasons and Elo resets are not planned for MVP.

---

# **3\. Ranked Jade Stakes**

**Decision: Approved — Option D**

Ranked introduces meaningful stakes through Jade, the game's virtual currency.

Each player contributes 100 Jade.

The total match pool is 400 Jade.

### **Distribution**

At the end of a full dealer rotation, calculate each player's cumulative net Tai.

Players with positive net Tai share the entire 400 Jade pool proportionally to their positive net Tai.

Payout:

Payout(i) \= 400 × max(Tai(i), 0\) / Σ max(Tai(j), 0\)

Integer Jade payouts use deterministic largest-remainder rounding.

Players with zero or negative net Tai receive no payout.

If every player's net Tai is zero, all four players receive their original 100 Jade back.

A player with positive net Tai may still receive less than their 100 Jade entry fee.

Maximum normal stake loss is 100 Jade.

### **Abandonment and Fair Play**

The game must discourage abandonment without unfairly punishing temporary connection issues.

Rules include:

* Explicitly leaving a Ranked match triggers immediate forfeiture and permanent Bot takeover.
* Three timed-out turns while connected during a rotation trigger forfeiture.
* Three consecutive qualifying missed participation opportunities also trigger forfeiture.
* Disconnects receive a three-minute grace period with temporary Bot play.
* Reconnection allows the player to resume at an appropriate action boundary.
* Failure to reconnect within the grace period triggers permanent forfeiture.

A forfeiting player receives zero Jade payout and is ranked below completing players for Elo settlement.

If no eligible player has positive net Tai, the pool is distributed among completing players. A sole completing player receives the full pool.

If all four players forfeit, the match is administratively terminated.

Server outages should void affected matches, refund Jade, and prevent Elo changes.

### **Abandonment Cooldowns**

Within a rolling seven-day window:

| Incident | Cooldown |
| ----- | ----- |
| First | 5 minutes |
| Second | 15 minutes |
| Third | 1 hour |
| Fourth and beyond | 24 hours |

All settlement and penalties must be server-authoritative and idempotent.

**Open detail:** Exact definition of qualifying missed participation opportunities.

---

# **4\. Bamboo Recovery**

**Decision: Approved**

Players should never become permanently locked out of Ranked simply because they have insufficient Jade.

When available Jade falls below 100, an eligible player can complete one Unranked hand to restore their balance to 200 Jade.

Rules:

* Available Jade must be below 100\.
* The player cannot have an outstanding Ranked stake.
* Recovery can occur once per UTC day.
* After an initial recovery, a completed Ranked match is required before another recovery.
* The first eligible recovery does not require previous Ranked participation.

Bamboo Recovery is a safety net, not a repeatable Jade-farming system.

---

# **5\. New User Onboarding**

**Decision: Approved**

Mahjong attracts people with very different experience levels.

The onboarding experience should adapt rather than forcing every player through the same tutorial.

On first launch, ask:

**How familiar are you with Mahjong?**

### **Path A — New to Mahjong**

* Interactive scripted tutorial
* Guided actions
* Guaranteed initial success
* Transition into Bot-supported Unranked
* Contextual help during early games

### **Path B — Familiar but Not Confident**

* Lightweight interface orientation
* Guided Bot play
* Full dealer rotation experience
* Explanation of Tai and scoring
* Optional invitation to try Ranked

### **Path C — Mahjong Veteran**

* Immediate access to Ranked
* Optional quick reference for controls and rules
* No mandatory tutorial
* First Ranked entry confirmation explaining stakes, payouts, Elo, rotation length, and forfeiture

Players can revisit tutorials later.

Guests may onboard without registration, and progress should survive account upgrades.

### **Onboarding Metrics**

Measure:

* Time to first hand
* First hand completion
* First full dealer rotation
* First Ranked match
* Guest-to-account conversion
* Seven-day retention by onboarding path

The exact interactive tutorial script is deferred.

---

# **6\. My Mahjong Journey**

**Decision: Approved**

My Mahjong Journey is the central destination for a player's identity, progression, and memorable experiences.

It unifies three independent systems:

**Legacy, Skill, and Highlights.**

## **6.1 Legacy Level**

Legacy Level celebrates participation and dedication.

Players earn Legacy XP from completed Unranked and Ranked gameplay.

Legacy XP should primarily reward participation rather than wins.

The system should not imply that a high Legacy Level means a player is more skilled.

### **Principles**

* Legacy Level never decreases.
* Progress is permanent.
* Participation matters more than performance.
* No mandatory daily streaks.
* Long-term milestones should feel meaningful.

### **Possible Rewards**

* Profile badges
* Titles
* Avatars
* Frames
* Tile cosmetics
* Anniversary recognition

**Not yet specified:** Exact XP amounts, level thresholds, and reward catalog.

## **6.2 Skill Progression**

Skill is represented through Ranked Elo and competitive tiers.

Unlike Legacy, current Skill can rise or fall.

The Journey records current Elo, current tier, peak Elo, highest-ever tier, and major promotions.

Permanent cosmetic unlocks celebrate first-time tier achievements.

## **6.3 Achievement Collections**

The game has three collections.

### **Legacy Achievements**

Celebrate participation, longevity, and membership.

Examples include completed games, Legacy Level milestones, anniversaries, and future seasonal participation.

### **Skill Achievements**

Celebrate competitive success.

Examples include Ranked wins, Elo milestones, and tier promotions.

### **Highlight Achievements**

Celebrate extraordinary Mahjong events.

Examples include rare winning hands, exceptional Tai, and unusual winning patterns.

Highlights should evoke the emotional significance of a hole-in-one in golf.

### **Important Rule: Personal Celebration vs. Public Prestige**

A rare winning hand should receive a full personal celebration even when achieved against Bots.

It remains part of the player's permanent Journey.

However, the game records whether the hand occurred in Ranked, all-human Unranked, mixed Unranked, or Bot-only play.

Public leaderboards may apply stricter eligibility requirements.

We should never diminish a personally meaningful moment simply because Bots participated.

### **Achievement Catalog**

**Explicitly deferred for a future design session.**

We still need to define:

* Achievement names
* Exact Taiwanese Mahjong winning patterns
* Unlock criteria
* Thresholds
* Rarity classifications
* Cosmetic rewards
* Detection support in the game engine
* Eligibility and anti-farming rules

Do not invent unsupported statistical rarity claims.

---

# **7\. The Mahjong Journey Interface**

The Journey should show:

* Legacy Level and current XP progress
* Ranked tier and Elo
* Peak competitive achievements
* Legacy achievement collection
* Skill achievement collection
* Highlight achievement collection
* Personal Mahjong records
* Recent milestones
* One relevant next milestone

The experience should feel like a player's personal Mahjong history, not merely a statistics dashboard.

---

# **8\. Friend Invitations and Referral Rewards**

**Decision: Approved**

Friends are a primary acquisition and retention driver.

Players should be able to invite others directly into Unranked parties through shareable links.

Potential sharing channels include LINE, WhatsApp, iMessage, Discord, native sharing, and copied links.

A guest should be able to join and play without first creating an account.

## **8.1 Friend Referral Reward**

When a player successfully invites three new friends, they unlock an exclusive permanent Mahjong tile cosmetic.

### **Successful Referral Definition**

A referral counts when an invited new player signs in with their email and establishes a verified full account.

**The invited player does not need to finish a hand or dealer rotation.**

This was an explicit product decision intended to reduce conversion friction.

### **Requirements**

* Three unique new accounts
* No self-referrals
* No duplicate credit
* Existing accounts are ineligible
* Guest-to-account attribution must persist
* Server-side validation and idempotent reward issuance
* No Jade referral rewards

The exclusive cosmetic should be represented in the Legacy achievement collection.

A Chinese character meaning Friend, **友**, has been suggested as an art direction, but the final design is not approved.

The three-friend milestone is currently treated as a one-time reward.

### **Product Intent**

The incentive should reward genuine community building rather than encouraging players to farm virtual currency.

---

# **9\. Public Match Results and Shareable Highlights**

**Decision: Approved — Early Acquisition Priority**

Every completed Mahjong match should generate a unique, stable, public-facing results URL.

This turns gameplay into shareable content.

## **9.1 Public Match Result Page**

A match page should include:

* Final standings
* Hand-by-hand results
* Notable achievements
* Significant winning moments
* Match mode and relevant player-composition context

The result is based on verified server-side match data.

URLs should use stable, opaque identifiers.

## **9.2 Shareable Winning-Hand Highlights**

Notable winning hands should have their own shareable Highlight snapshots and potentially their own URLs.

A Highlight should display:

* Actual winning tiles
* Winning pattern
* Tai
* Match context
* Verified achievement
* Link to the parent match

Snapshots must faithfully represent the real game state.

No fabricated tile combinations or unsupported rarity descriptions.

## **9.3 Social Sharing**

Results and Highlights should generate attractive link previews for:

* Facebook
* X
* LINE
* WhatsApp
* Discord
* iMessage
* Other compatible social platforms

Technical requirements include:

* Open Graph metadata
* X large-image card metadata
* Suitable preview images, initially targeting approximately 1200 × 630
* Server-rendered or statically generated metadata accessible to social crawlers

The current GitHub Pages client-rendered app should not be assumed to support unique crawler-readable metadata without additional infrastructure.

## **9.4 Come Play Mahjong CTA**

Every public results page should feature a prominent:

**Come Play Mahjong**

This CTA leads visitors into the game with minimal friction.

Track the acquisition funnel:

**Shared result → Page visit → CTA click → Game launch → First hand → Full account → Retention**

Preview crawler traffic should not count as human visits.

## **9.5 Privacy and Fairness**

Public sharing must not expose:

* Real identities without appropriate consent
* Concealed opponent tiles
* Sensitive account information
* Internal wallet or transaction details

Visibility defaults, pseudonyms, participant consent, indexing, and share revocation still require product decisions.

Public URLs should not automatically imply broad discoverability.

## **9.6 Scope**

Early priority:

* Permanent match URLs
* Winning-hand snapshots
* Shareable Highlight links
* Social metadata
* Tracked acquisition CTA
* Basic privacy controls

Later:

* Interactive embeds
* Advanced replay viewers
* Rich community interactions

---

# **10\. Jade Shop and Cosmetics**

**Planned Core Economy**

Cosmetics give players ways to personalize their Mahjong experience and express identity.

Potential categories:

* Tile sets
* Table themes
* Avatars
* Profile frames
* Special achievement cosmetics

Illustrative Jade Shop pricing ranges from 500 to 10,000 Jade.

Exact prices and progression balance remain open.

Cosmetics must not provide competitive gameplay advantages.

Jade remains noncash and nonredeemable.

Existing daily Jade grants and the interaction between Jade earnings, Ranked stakes, Bamboo Recovery, and cosmetic spending require an economy audit.

If purchasable Jade can be used for Ranked stakes, legal review is required.

---

# **11\. Advertising and Monetization**

**Approved Direction; Pricing TBD**

The initial monetization model includes:

### **Advertising**

Ads are enabled by default but must not interrupt active gameplay, timed decisions, or reconnection.

### **Paid Ad Removal**

A simple subscription removes ads.

Pricing has not been defined.

### **OG Founder Entitlement**

Original Founders receive permanent ad-free access, verified server-side.

### **Jade Ad-Free Passes**

Illustrative options:

| Pass | Jade Cost |
| ----- | ----- |
| 7 days | 500 |
| 30 days | 1,500 |

Passes do not auto-renew.

Purchases extend the expiration date.

Players who already have permanent or subscription-based ad-free access should not be prompted to buy redundant passes.

### **Entitlement Priority**

OG Founder → Paid Subscription → Jade Pass → Ads

### **Deferred Monetization**

* Rewarded Jade advertisements
* Paid AI Trainer coaching
* NFT collectible monetization

AI coaching must not provide unfair live competitive assistance.

---

# **12\. Mahjong Clubhouse**

**Future Feature — Not MVP**

Mahjong Clubhouse is a lightweight community activity feed.

The goal is to make Mahjong achievements visible and socially meaningful.

### **Automatic Achievement Posts**

Potential events include:

* Rare winning hands
* Ranked tier promotions
* Major Legacy milestones
* Personal records

The feed uses verified game events rather than unrestricted user-generated posts.

### **Community Reactions**

Players can respond with simple Cheer reactions.

Freeform posts and comments are not an initial priority.

Participation in public recognition should respect player privacy and consent.

---

# **13\. Community Leaderboards**

**Future Feature — Not MVP**

Rather than one leaderboard measuring everything, we envision distinct types of recognition.

### **Ranked Champions**

Competitive skill and Elo.

### **Mahjong Veterans**

Legacy participation and longevity.

### **Rare Hand Collectors**

Verified extraordinary hands.

### **Season Standouts**

Future seasonal recognition.

Leaderboard eligibility should account for match provenance and prevent Bot farming or coordinated abuse.

The goal is to celebrate different forms of Mahjong accomplishment without equating time played with competitive skill.

---

# **14\. Seasons and Mahjong Yearbook**

**Future Feature — Not MVP**

The long-term community experience may include a seasonal Mahjong Yearbook inspired by a high-school yearbook.

## **14.1 Community Yearbook**

A retrospective featuring:

* Competitive champions
* Extraordinary Mahjong hands
* Community milestones
* Memorable achievements
* Interesting participation statistics

## **14.2 Your Season Story**

Each player receives a personalized recap of:

* Legacy progress
* Highest Ranked tier
* Rare winning hands
* Completed rotations
* Favorite achievements
* Memorable moments

Seasonal recognition does not require resetting Ranked Elo.

Avoid rewarding excessive daily hours or compulsive participation.

---

# **15\. Challenges and Quests**

**Future Feature — Not MVP**

Daily and weekly Challenges may eventually create additional reasons to play.

The preferred direction is a unified Challenge system rather than multiple disconnected reward mechanics.

Challenges should complement normal Mahjong play.

Mandatory login streaks and daily check-in rewards are deliberately deferred.

Potential community Mahjong events and daily puzzles remain exploration ideas rather than approved requirements.

---

# **16\. Etch This Moment**

**Long-Term Exploration — Not MVP**

Etch This Moment is an optional feature allowing players to commemorate a verified Mahjong Highlight as a blockchain collectible or NFT.

The original Highlight remains permanently accessible and free to view.

Minting should not influence:

* Elo
* Jade
* Legacy XP
* Achievement eligibility
* Gameplay

The collectible references a verified historical Mahjong event.

NFT ownership does not automatically grant intellectual-property ownership.

## **16.1 Personal Etch**

A player commemorates one of their own extraordinary Mahjong moments.

## **16.2 Community Etch**

A streamer or creator experiences an extraordinary Mahjong moment.

Members of the audience may wish to commemorate that same event through collectible editions linked to the original canonical Highlight.

This could support community identity around a particular moment.

The specific collectible model is still conceptual.

### **Open Questions**

* Blockchain selection
* Wallet requirements
* Minting fees
* Creator consent
* Licensing and IP
* Edition quantities
* Transferability
* Revenue sharing
* Privacy and legal implications

We should validate actual community interest before committing to blockchain infrastructure.

---

# **17\. Watch a Game**

**Decision: Explicitly Deferred Beyond MVP**

The long-term inspiration comes from watching family members play Mahjong, especially the anticipation when someone is Ting and waiting to Self Draw a winning tile.

The feature should prioritize live spectating rather than passive replay viewing.

## **17.1 Streamer Live Table View**

A streamer plays Mahjong and shares a unique spectator URL.

Viewers can follow the live table in parallel with the stream.

Potential future Twitch integration includes a Twitch Extension or overlay.

The goal is to let viewers participate emotionally in the match as it unfolds.

## **17.2 Fairness Requirements**

Live spectators must not gain access to strategically sensitive information that could facilitate collusion.

Concealed hands, Ting status, and waiting tiles require careful handling.

Public table information can be shown without revealing private game state.

## **17.3 Replay Viewing**

Replay viewing is not a priority as an entertainment feature.

It may later serve:

* Reviewing decisions
* Learning Mahjong
* Improving play
* AI-assisted coaching

## **17.4 Scope Decision**

No live spectating, Twitch integration, or interactive replay viewer in MVP.

Streamer-friendly **sharing of completed Highlights** remains an earlier priority.

---

# **18\. Product Roadmap**

## **Core Engagement Foundation**

* Unranked party matchmaking with Bot fallback
* Ranked Elo, tiers, Jade stakes, and fair-play rules
* Adaptive new player onboarding
* Legacy XP and levels
* My Mahjong Journey
* Achievement collections and personal celebrations
* Basic cosmetic progression

## **Early Acquisition Priorities**

* Shareable Unranked party invitations
* Guest-first friend joining
* Three-referral Friend Tile
* Permanent public match result URLs
* Verified winning-hand Highlights
* Social link previews
* Tracked Come Play Mahjong CTA

## **Later Engagement Features**

* Expanded achievement catalog
* Mahjong Clubhouse
* Community leaderboards
* Daily and weekly Challenges
* Seasonal events
* Community Yearbook
* Personalized Season Story
* Paid AI Trainer

## **Long-Term Exploration**

* Etch This Moment NFT collectibles
* Streamer/community collectible editions
* Live Watch a Game
* Twitch Extension or overlay
* Advanced analysis replays

These priorities describe product intent, not a commitment that all core features have already been implemented.

---

# **19\. Success Metrics**

## **Activation**

* First hand completion
* First dealer rotation completion
* Onboarding completion by experience level
* First Ranked match
* Guest-to-full-account conversion

## **Engagement**

* Completed hands and rotations
* Return play frequency
* Seven-day retention
* Unranked rematch rate
* Ranked participation
* Legacy progression
* Achievement unlocks
* Cosmetic unlock and equip rates

## **Social Acquisition**

* Party invitation shares
* Party joins
* Human versus Bot match composition
* Successful friend referrals
* Friend Tile unlock rate
* Shared results and Highlights
* Public result page visits
* Come Play CTA clicks
* New players acquired through shared results

## **Competitive Health**

* Ranked completion rate
* Abandonment frequency
* Elo distribution
* Jade economy health
* Bamboo Recovery frequency
* Fair-play violations

## **Community**

Later metrics may include:

* Clubhouse participation
* Cheer reactions
* Public leaderboard engagement
* Seasonal recap sharing
* Streamer-driven acquisitions

---

# **20\. Open Product Decisions**

The following areas require additional design or validation before implementation.

### **Achievement Catalog**

Define exact achievement names, Taiwanese Mahjong patterns, thresholds, rarity, rewards, and detection logic.

### **Legacy Progression**

Determine XP rates, level curves, milestone frequency, and rewards.

### **Jade Economy**

Balance earning, staking, recovery, cosmetic prices, and ad-free passes.

### **Public Sharing Privacy**

Define visibility defaults, consent, pseudonyms, indexing, and revocation.

### **Matchmaking**

Determine how long Unranked should wait for humans before filling seats with Bots.

### **Referral Attribution**

Determine whether conversions from public results can qualify as Friend referrals, and finalize anti-abuse rules.

### **Social Infrastructure**

Determine the hosting, storage, image-generation, and metadata infrastructure for public results and Highlights.

### **Cosmetic Art**

Finalize the Friend Tile design and permanent milestone rewards.

### **Competitive Integrity**

Specify the exact AFK participation criteria and complete edge-case settlement tests.

---

# **21\. Guiding Principles**

**1\. Mahjong is the reward.**

The game should be enjoyable without requiring external incentives.

**2\. Participation deserves recognition.**

Legacy should celebrate dedication without pretending it represents skill.

**3\. Skill deserves its own progression.**

Ranked Elo provides meaningful competitive recognition.

**4\. Extraordinary moments deserve to be remembered.**

Rare hands and memorable wins should become part of a player's permanent Mahjong story.

**5\. Playing with friends should be effortless.**

Guest access, party matchmaking, and Bot fallback minimize barriers.

**6\. Sharing should grow the community.**

Verified match results and Highlights create natural opportunities to invite others.

**7\. Fairness and trust come first.**

Competitive stakes, achievements, referrals, and public records must be verifiable.

**8\. Avoid engagement for engagement's sake.**

We should not pressure players with artificial urgency, forced streaks, or excessive notifications.

---

# **Final Product Thesis**

**Play → Progress → Celebrate → Share → Bring Friends → Play Again**

The engagement system should help players build a lasting relationship with Mahjong.

Some players will return because they want to reach a higher Ranked tier.

Others will return because they enjoy playing with friends.

Some will collect rare hands and memorable moments.

Others will gradually build their Mahjong Legacy over years.

Our goal is to support all of these motivations in one coherent Mahjong experience.

The most successful outcome is not simply more time spent in the game.

**It is a community where Mahjong players feel connected to their friends, proud of their progress, and excited to share the moments that make the game special.**

---

**Document status:** Working specification for peer review. Approved decisions, illustrative values, deferred features, and open questions are identified throughout. This document supplements the existing game product specification and does not replace the detailed Mahjong rules or implementation requirements.

### Journey dimension clarification — October 20, 2026

The three independent dimensions are Legacy (dedication and longevity), Skill (competitive performance), and Highlights (extraordinary Mahjong moments). Prestige is milestone-based identity within the Games Played category of Legacy, alongside the Living Chronicle. Anniversaries and Community are the other Legacy categories. Do not present Prestige as a separate overview dimension or XP-based Legacy Level as a fourth progression system. Existing draft Prestige milestones remain editable defaults pending final titles, thresholds, and chapter artwork.
