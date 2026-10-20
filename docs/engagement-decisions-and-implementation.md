# Engagement Decisions and Implementation Record

- Status: Supplemental decisions and preserved implementation history
- Recorded: 2026-10-19
- Source: [Mahjong engagement loop](https://chatgpt.com/share/6ad6d265-c898-83ea-8419-ec10887895b6)
- Requested by: Product Owner in this repository's engagement-model chat

This update captures the latest consolidated decisions in the shared conversation. Per the Product Owner’s 2026-10-19 instruction, it replaces the earlier engagement and progression design. Existing implementations are placeholders, not product constraints. It supersedes conflicting engagement requirements in the older specification. It does not certify that any capability is implemented. Proposed values and assistant recommendations that were not approved remain open.

## 2. Game Modes

Implementation starts here, in the source model’s chapter order. Existing mode, lobby, queue, and economy implementations are placeholders. Work already started on Journey is preserved, but further downstream implementation is deferred until the earlier chapters are handled.

### 2.1 Unranked — Accessible and Social Mahjong

Confirmed from the accessible source summary: accessible social play, bot fallback, and guest-friendly party invitations. Completed full rotations qualify for Legacy regardless of wins, losses, or bot participation.

**Source text pending:** the shared snapshot available during import did not contain the complete chapter body. Format, timing, party/bot behavior, progression eligibility, and economy details must be transcribed from Chapter 2 rather than inferred from the old implementation.

### 2.2 Ranked — Competitive Mahjong

Confirmed from the accessible source summary: competitive play with Elo ratings and Jade stakes. The established economy direction includes fixed entry stakes and proportional positive-Tai prize distribution.

**Source text pending:** the complete Ranked chapter body is needed to define eligibility, format, matching, stakes, settlement, and recovery behavior accurately. These are not supplied by the old placeholder implementation.

### Chapter 2 implementation checklist

- [ ] Import and verify the full text of 2.1 and 2.2.
- [ ] Turn each mode requirement into acceptance criteria and map client, queue, runtime, and economy changes.
- [ ] Implement 2.1 Unranked and its focused regressions.
- [ ] Implement 2.2 Ranked and its focused regressions.
- [ ] Validate the complete mode flows before moving to the next source chapter.

Artwork is tracked in the [Artwork Register](artwork-register.md). Provisional illustrations remain explicit placeholders.

## Captured downstream requirements

The sections below preserve the consolidated import and work already started. They are not a verified transcription of the original chapter order; do not assign them source chapter numbers until the full model is available.

### Engagement loop

The engagement loop is Discover → Join → Play → Progress → Celebrate → Share → Invite → Return.

Two primary modes organize play: Unranked offers accessible social play with bot fallback; Ranked offers competitive play with Elo ratings and Jade stakes. Legacy, Skill, and Highlights are independent progression dimensions presented together in My Mahjong Journey. Legacy recognizes dedication and longevity, Skill recognizes competitive performance, and Highlights commemorate extraordinary Mahjong moments.

The core Mahjong engine remains the gameplay foundation. Existing queue labels and formats may be replaced to implement this mode model.

## Confirmed Legacy requirements

| ID | Requirement |
| --- | --- |
| ENG-LEG-01 | One completed full dealer rotation counts as one game. Ranked and Unranked count equally, as do wins, losses, and bot-supported games. Incomplete rotations do not count. Individual hands are tracked separately. |
| ENG-LEG-02 | Games Played awards Progressive Prestige through evolving titles and emblems, paired with a Living Mahjong Chronicle that develops through completion milestones. |
| ENG-LEG-03 | The Chronicle is viewable from public player profiles. Its earned progression is permanent and never resets. Prestige cannot be purchased. |
| ENG-LEG-04 | Anniversaries start from the first completed full dealer rotation. Every calendar anniversary automatically grants a permanent numbered badge, including during inactivity. Celebration appears on the next visit. No streak, daily login, or annual activity requirement applies. |
| ENG-LEG-05 | Major anniversaries grant permanent, exclusive material-themed cosmetics unavailable for Jade purchase: year 5 Wood, 10 Tin, 15 Crystal, 20 Porcelain, 25 Silver, 30 Pearl, 40 Ruby, 50 Gold, and 60 Diamond. |
| ENG-LEG-06 | Community recognizes playing with and inviting friends. Three successful referrals unlock an exclusive Friend Tile. A referral qualifies when a new player establishes a verified full account; gameplay completion is not required. |

Proposed Games Played milestones are 1, 10, 50, 100, 500, 1,000, and 5,000 rotations. The Product Owner approved using these thresholds and the proposed Prestige titles as editable implementation defaults on 2026-10-19. Chronicle names and artwork remain provisional. Legacy XP and its relationship to Prestige also remain open.

## Confirmed profile and collection requirements

| ID | Requirement |
| --- | --- |
| ENG-PRO-01 | The public profile is customizable and serves as the player's Mahjong identity, collection showcase, and trophy room. It should support showcasing the majority of collected cosmetics. |
| ENG-PRO-02 | Any owned cosmetic may be showcased regardless of acquisition source. The player controls which items are displayed. |
| ENG-PRO-03 | Ownership, gameplay equipment, and profile showcase are independent states. Equipping an item must not implicitly replace its showcase selection or vice versa. Multiple collections may be displayed together within available capacity. |
| ENG-PRO-04 | The Living Chronicle is publicly viewable and customizable. Earned chapter progression and cosmetic personalization are distinct; purchasing cosmetics cannot advance Prestige. |
| ENG-PRO-05 | MVP has no profile or Chronicle comments, reactions, visitor gifts, guestbook, or other visitor interactions. |
| ENG-PRO-06 | Cosmetics can originate from achievements, anniversaries, referrals, the Jade Shop, or future events. Ownership is permanent unless an item explicitly has an expiration. |

Showcase capacity is undecided. Increasing slots with Prestige was recommended but not approved. Specific customization slots, featured Highlight placement, and freeform versus slot-based decoration require final design; suggested MVP layouts in the source are proposals.

## Confirmed sharing and acquisition requirements

| ID | Requirement |
| --- | --- |
| ENG-SHR-01 | Unranked party invitations support guests. |
| ENG-SHR-02 | Every completed match generates a public results URL. Shared results include a tracked Come Play Mahjong invitation. |
| ENG-SHR-03 | Notable winning hands can become verified, shareable Highlights. The complete qualifying hand catalog remains open. |

Live spectating, Twitch integration, and NFT-based Highlight collectibles are future possibilities, not MVP requirements. Public-result fields, player visibility controls, retention, link access, and referral attribution/abuse handling require design before publication is implemented.

## Established economy direction

The source summary records one shared Jade wallet, fixed Ranked entry stakes, proportional positive-Tai prize distribution, Bamboo Recovery for insufficient Jade, and cosmetic purchases through the Jade Shop. Monetization includes advertising by default, an ad-free subscription, Jade-based ad-free passes, and lifetime ad-free access for OG Founders.

Exact prices, stake values, recovery rules, prize calculations, monetization eligibility, and OG Founder qualification remain unspecified here. This direction is not a sufficiently complete replacement settlement algorithm. Active and historical matches must retain their recorded rules and economy versions.

## Reconciliation with the existing baseline

| Existing specification area | Difference to resolve |
| --- | --- |
| §2 release scope; §8.3–8.6 modes and queues | Quick Play / Full Rotation and Ranked / Unranked need an explicit format, eligibility, bot fallback, and private-room matrix. Do not assume a renamed queue preserves the intended behavior. |
| §7 settlement; §8.4 Full Rotation | Existing public Quick Play transfers Jade and ranked Full Rotation uses no Jade. The new direction places stakes in Ranked and needs a versioned entry, payout, draw, abandonment, void, and refund policy. |
| §12 progression and achievements | Add rotation-based Legacy completion, Prestige, anniversaries, and Chronicle without conflating hand counts, XP, and Elo. Determine historical backfill from verified records. |
| §8.10 sharing; §10 identity/social/privacy | Expand to public results, tracked invitations, verified-account referrals, public profiles, and profile visibility controls. Define public-safe data projections. |
| §2 scope; §13 economy/live operations | Jade Shop, ads, subscriptions, and ad-free passes expand the earlier release scope. Their release phase and operational requirements need explicit revision. |
| §15 analytics and reliability | Measure the full engagement loop and implement idempotent completion/reward attribution. Keep authoritative rewards and public records derived from committed server events. |

## Implementation sequence (revised to follow source chapters)

1. Start with Chapter 2, in order: 2.1 Unranked, then 2.2 Ranked. Obtain the full source text and finalize the mode/format matrix and economy replacement, including release scope, rule versions, migration impact, and accountable approval. Replace placeholder behavior in reviewable slices while preserving core Mahjong correctness.
2. Define server-authoritative rotation completion and backfill semantics, separating complete rotations from time-limited, abandoned, or void outcomes. Specify reward idempotency and the anniversary date policy, including leap-day handling.
3. Add the Legacy/Journey data contract and projections, then Prestige and Chronicle presentation once thresholds and titles are finalized.
4. Define inventory ownership, equipment, and showcase contracts; add owner editing and public-safe profile views with entitlement validation.
5. Add public results, verified Highlights, guest invitations, and verified-account referral rewards with privacy and attribution safeguards.
6. Implement the approved economy and monetization changes only after their detailed policies and migration are recorded.

Each implementation slice requires focused regression coverage. Visible changes require UI evidence; repository review requires `make test` and `npm run build`.

## Open product decisions

- Final Prestige thresholds, titles, emblems, and Chronicle chapters/art direction.
- Legacy XP curve and relationship to existing levels and rewards.
- Showcase capacity and exact customization controls.
- Remaining Community achievements and Highlight qualification catalog.
- Ranked/Unranked formats, eligibility, bot fallback, and release phases.
- Complete Ranked stake/payout and Bamboo Recovery rules; prices and ad-free entitlements.
- Historical migration, public visibility defaults, referral attribution, and anniversary calendar rules.

These are decision points, not approval of illustrative recommendations in the source chat.

## Implementation record — 2026-10-19

Implemented the first Journey slice: authenticated progression now includes a server-derived completed-rotation total, first completion timestamp, seven-step editable Prestige catalog, and calendar anniversary history. The lobby opens My Mahjong Journey instead of the XP curve, including before the first game. Journey presents rotation-based Prestige, chapter previews with locked future chapters, and anniversary history.

The read model uses natural rotation completion records directly, excluding time-limit endings and avoiding duplicate counts across hand rows or XP grants. This also reads existing verified records without inventing a historical completion total. Calendar defaults are UTC, with February 29 anniversaries on February 28 in non-leap years. Major material gifts have stable milestone identifiers; inventory fulfillment and cosmetic artwork are not yet implemented. Chronicle illustrations are provisional CSS scenes.

Remaining replacement work: public profile persistence and cosmetic ownership/equipment/showcase separation; permanent inventory rewards; Skill and verified Highlight experiences; results URLs and referral attribution; mode/queue replacement; economy and monetization. Existing XP rewards and achievements remain legacy backend paths pending those replacements. Skill and Highlights are named Journey dimensions, not functioning screens in this slice.

### Sequencing correction — 2026-10-19

The Product Owner directed implementation to follow the source chapters, starting at **2. Game Modes**, **2.1 Unranked — Accessible and Social Mahjong**, then **2.2 Ranked — Competitive Mahjong**. Journey work is retained without further expansion while those chapters are addressed. The original import was a consolidated closing summary, not a complete chapter-by-chapter import. The missing Chapter 2 body is requested; requirements will not be invented from the older placeholder implementation.

All provisional visuals remain placeholders. The linked Artwork Register is the handoff inventory for an external Art team and must be updated whenever a new visual is introduced.


## Canonical source imported — 2026-10-19

The complete [User Engagement Model](user-engagement-model.md) is now imported from the Product Owner’s Google Doc, **v1.7, updated October 14, 2026**. It includes all chapters 1–21. The source starts with Product Vision; implementation begins at Chapter 2 as directed. This file preserves later approved chat decisions (including the Prestige defaults), earlier summary material, and the implementation record; it is not the canonical chapter structure.

The earlier “source text pending” entries above describe the import history and are now resolved by the complete canonical import. Chapter 2's actual requirements and acceptance checklist are in [Chapter 2 implementation](chapter-02-game-modes.md). Journey work is preserved. No additional Journey feature work should precede the earlier chapters.
