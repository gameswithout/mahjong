# Mahjong Artwork Register

Status: Outsourcing handoff inventory · updated 2026-10-19

Owner: Product / Art. Product source: [User Engagement Model](user-engagement-model.md). Implement chapters in source order; register entries do not authorize implementing later chapters early.

Source: the complete v1.7 model is now imported. Ranked tiers and social-preview sizes below reflect that source. All artwork below is pending final Art direction and remains a placeholder. No final artwork has been commissioned or generated. Technical sizes are proposed delivery targets, not approved visual designs. Confirm them with the Art team before commissioning. Existing core tile faces and table rendering are reusable gameplay assets, not replacement commissions in this engagement pass.

## Delivery and replacement conventions

- Use the stable asset ID as the filename. Deliver layered/editable source alongside web exports.
- Scenes: proposed 1600 × 800 WebP/PNG, with essential content safe for narrower crops; provide a composition guide. Do not bake UI text, player names, counters, or progress bars into the illustration.
- Emblems, badges, tile collectibles: proposed 512 × 512 transparent PNG plus editable vector/source. Keep silhouettes readable at 32–64 px. Gameplay tile skins also need a separate tile-face specification, preserving tile identity and legibility.
- Table themes: proposed 2048 × 2048 repeat-safe background plus source; verify contrast with tiles and controls. Profile banners/nameplates require responsive variants after the profile layout is approved.
- Proposed final web location: `public/artwork/<asset-id>.<extension>`. These paths are reserved conventions; files do not exist yet. Use explicit placeholders until approved exports are available.
- For each delivery, record its final path, source-file link, artist/vendor, license, revision, approval date, and integration check here. Replace the placeholder by its ID and verify desktop/mobile, crop, contrast, and Reduced Motion behavior where relevant.

## Chapter 2 — Game Modes (first implementation priority)

| Asset ID | Asset / brief | Use and replacement location | Delivery | Status |
| --- | --- | --- | --- | --- |
| mode-unranked | Accessible, welcoming, social Mahjong; final brief follows full 2.1 text | Unranked menu card in `client/GameModeMenu.tsx`; launcher wiring in `client/App.tsx` | Scene | Chapter 2 verified; final composition brief pending; no final art |
| mode-ranked | Competitive Mahjong; visually distinct from Unranked without implying purchased skill | Ranked menu card in `client/GameModeMenu.tsx`; launcher wiring in `client/App.tsx` | Scene | Chapter 2 verified; final composition brief pending; no final art |

## Preserved Journey work — Living Chronicle

Replacement hook: `client/JourneyScreen.tsx`, `.journey-chronicle[data-artwork-id]`. Current art is CSS geometry in `client/styles.css`; retain it as an explicit illustration placeholder until replaced. Each chapter should add to the same environment rather than discard its history. Chapter names beyond the source examples are provisional implementation copy.

| Asset ID | Chapter / unlock | Art brief | Delivery | Status |
| --- | --- | --- | --- | --- |
| chronicle-00 | Before first completed rotation | Quiet room awaiting the player's first seat; distinguish from an earned chapter | Scene | CSS placeholder |
| chronicle-01 | First Seat · 1 game | Simple Mahjong table and chairs; base composition for additive progression | Scene | CSS placeholder |
| chronicle-02 | Familiar Table · 10 games | Add tea and signs of regular play | Scene | CSS placeholder |
| chronicle-03 | A Place of Your Own · 50 games | Add personal shelves/keepsakes to the familiar room | Scene | CSS placeholder; chapter name provisional |
| chronicle-04 | Veteran’s Room · 100 games | Richer established Mahjong space, preserving earlier additions | Scene | CSS placeholder |
| chronicle-05 | Gathering Place · 500 games | Extend the veteran room with further furnishings and plant life | Scene | CSS placeholder; brief/name provisional |
| chronicle-06 | Hall of Memories · 1,000 games | Accumulated history with celebratory lighting and display details | Scene | CSS placeholder; brief/name provisional |
| chronicle-07 | A Lifetime at the Table · 5,000 games | Grand but recognizable continuation of the original Mahjong home | Scene | CSS placeholder; brief/name provisional |

## Progressive Prestige emblems

Titles and thresholds are editable defaults approved by the Product Owner. Emblems represent dedication, not Elo or competitive skill. Final emblem mounting points at profile/table/Journey are pending; catalog defaults live in `mahjong-match-service/pkg/progression/journey.go`.

| Asset ID | Title / unlock | Art brief | Delivery | Status |
| --- | --- | --- | --- | --- |
| prestige-01 | Newcomer · 1 game | First stage of one evolving emblem system | Emblem | Placeholder needed; no image currently rendered |
| prestige-02 | Table Regular · 10 games | Evolve the same silhouette | Emblem | Placeholder needed |
| prestige-03 | Familiar Face · 50 games | Add a recognizable intermediate detail | Emblem | Placeholder needed |
| prestige-04 | Mahjong Veteran · 100 games | Established participation | Emblem | Placeholder needed |
| prestige-05 | Table Elder · 500 games | Deep community history | Emblem | Placeholder needed |
| prestige-06 | Mahjong Luminary · 1,000 games | Distinguished long-term participation | Emblem | Placeholder needed |
| prestige-07 | Living Legend · 5,000 games | Culmination of the same evolving identity | Emblem | Placeholder needed |

## Anniversary badges and exclusive material collections

Badge years are dynamic: use one reusable numbered badge template, with accessible year text rendered by UI. Do not commission one static bitmap per possible year. Award definitions currently project from `mahjong-match-service/pkg/progression/journey.go`; physical inventory fulfillment is future work. Exclusive material gifts cannot be bought with Jade.

| Asset ID | Anniversary | Required artwork | Delivery | Status |
| --- | --- | --- | --- | --- |
| anniversary-badge-template | Every year | Permanent anniversary badge base with a clear number area | Badge/source template | Text-only placeholder |
| anniversary-05-wood | 5 years | Wooden Mahjong tile set | Tile skin / showcase collectible | Brief approved in source; production tile template pending |
| anniversary-10-tin | 10 years | Metallic table theme | Table theme / showcase preview | Material theme approved; art pending |
| anniversary-15-crystal | 15 years | Crystal tile set | Tile skin / showcase collectible | Material theme approved; art pending |
| anniversary-20-porcelain | 20 years | Porcelain tile set | Tile skin / showcase collectible | Material theme approved; art pending |
| anniversary-25-silver | 25 years | Silver-themed cosmetics; exact item composition to be specified | Collection, contents TBD | Material approved; item brief pending |
| anniversary-30-pearl | 30 years | Pearlescent tile set | Tile skin / showcase collectible | Material theme approved; art pending |
| anniversary-40-ruby | 40 years | Ruby-themed cosmetics; exact item composition to be specified | Collection, contents TBD | Material approved; item brief pending |
| anniversary-50-gold | 50 years | Golden Mahjong tile set | Tile skin / showcase collectible | Material theme approved; art pending |
| anniversary-60-diamond | 60 years | Diamond-themed collection; exact item composition to be specified | Collection, contents TBD | Material approved; item brief pending |

Artwork IDs differ from reward entitlement codes (for example, `anniversary-5`); keep that mapping explicit during inventory integration.

## Community, profiles, sharing, and collection families

These entries capture known downstream art needs without inventing a final cosmetic catalog. Split each family into individual asset IDs when its approved item list is available.

| Asset ID / family | Intended use | Replacement location | Delivery | Status |
| --- | --- | --- | --- | --- |
| community-friend-tile | Exclusive reward for three verified-account referrals | Future inventory and public-profile showcase | Collectible / tile treatment | Reward approved; appearance pending |
| profile-avatar-* | Owned avatar cosmetics | Future public profile; current tile-based profile in `client/PlayerProfile.tsx` is scaffolding | Avatar portraits/icons | Catalog and art direction pending |
| profile-frame-* | Avatar/profile frames | Future public profile and inventory | Transparent frame overlays | Catalog/slot layout pending |
| profile-nameplate-* | Nameplates and title presentation | Future public profile and table identity | Responsive vector/source | Catalog/layout pending |
| profile-background-* | Profile backgrounds and Chronicle personalization | Future profile / Chronicle customization | Responsive scenes | Catalog/layout pending |
| showcase-display-* | Display stands/shelves/slots for any owned cosmetic | Future profile showcase | Layered UI/environment pieces | Capacity and layout undecided |
| highlight-card-template | Verified winning-hand share card | Future Highlight and public-result surfaces | 1200 × 630 social preview plus responsive card source | Highlight catalog/layout pending; tiles and verified facts rendered by UI |
| result-card-template | Completed-match public results and invitation | Future public results URL surface | 1200 × 630 social preview plus responsive card source | Layout pending; no final art |
| skill-bronze | Bronze tier, below 1000 Elo | Future Ranked/profile Skill surfaces | Emblem | Placeholder; threshold illustrative |
| skill-silver | Silver tier, 1000–1199 Elo | Future Ranked/profile Skill surfaces | Emblem | Placeholder; threshold illustrative |
| skill-gold | Gold tier, 1200–1399 Elo | Future Ranked/profile Skill surfaces | Emblem | Placeholder; threshold illustrative |
| skill-platinum | Platinum tier, 1400–1599 Elo | Future Ranked/profile Skill surfaces | Emblem | Placeholder; threshold illustrative |
| skill-diamond | Diamond tier, 1600–1799 Elo | Future Ranked/profile Skill surfaces | Emblem | Placeholder; threshold illustrative |
| skill-master | Master tier, 1800+ Elo | Future Ranked/profile Skill surfaces | Emblem | Placeholder; threshold illustrative |
| jade-shop-* | Cosmetic catalog thumbnails and previews | Future Jade Shop; existing `client/StoreScreen.tsx` sells Founder Pack scaffolding | Per-item thumbnails/exports | Catalog pending; track each approved item separately |
| founder-identity-* | OG Founder cosmetic identity, if defined in the final Founder requirements | Existing founder profile entitlement/UI | Family TBD | Ad-free benefit alone does not imply a cosmetic commission |

## Maintenance checklist

When adding a visual, add or refine its asset ID here in the same change. Record the source chapter and approved brief, mount point, target dimensions, variants, status, and final replacement path. Keep TBD families explicitly unresolved. Preserve core tile readability and make locked/earned status understandable without relying only on art or color.

### Main menu update — 2026-10-19

The two-mode menu currently uses text-only cards. No final mode artwork is rendered or commissioned. `mode-unranked` and `mode-ranked` remain the reserved Art team asset IDs; add approved imagery to the corresponding cards in `client/GameModeMenu.tsx` later.

## NEO click-through placeholders — 2026-10-19

Source: [New Player Onboarding](new-player-onboarding.md). Lesson sequence, final instructional art, and exact orientation content remain provisional. Do not commission final lesson diagrams before the scripted hands are approved.

| Asset ID | Intended artwork | Current placeholder / replacement hook | Delivery | Status |
| --- | --- | --- | --- | --- |
| neo-tutorial-tile-placeholder | Draw/discard instructional tile presentation | `client/NeoExperience.tsx`, `data-artwork-id`; CSS tile and text | Reuse core tile assets with UI highlighting; additional illustration only if approved | Reserved for future tutorial; no longer rendered |
| neo-guided-table-placeholder | Guided full-rotation instructional table | `client/NeoExperience.tsx`, `data-artwork-id`; four labeled dealership blocks | Final game table plus guidance overlays; scene art brief pending | Reserved for future tutorial; no longer rendered |
| neo-ranked-table-placeholder | Ranked entry/sample table visual | `client/NeoExperience.tsx`, `data-artwork-id`; four text seats | Reuse live table assets; final tutorial layout pending | Interactive placeholder |

The familiarity choices, orientation panels, and recaps currently use text-only layouts. No custom character, portrait, illustration, or badge is required or commissioned for those screens yet. Prepared tile examples are illustrative lesson content, not shareable verified Highlights.

### NEO simplification — 2026-10-19

The active familiarity experience is now a text-only widget on the main menu. New Player opens a deliberately blank tutorial page with one return button. `neo-tutorial-tile-placeholder` and `neo-guided-table-placeholder` are inactive future reservations; their previous CSS samples are removed. Do not commission assets for those examples. No new artwork is required by this simplified widget or blank page. `neo-ranked-table-placeholder` belongs to the separate Ranked preview and remains active there.

### Responsive main menu — 2026-10-20

The new layout reuses the existing Living Chronicle placeholders and profile tiles. The temporary brand mark in `client/MainMenu.tsx` is a CSS tile with the character 中 (`menu-brand-mark`); replace it with the approved game logo (SVG preferred, transparent background, legible at 32–44 CSS pixels). Jade currently uses the existing ◆ currency placeholder; replace it with the approved Jade icon (`menu-jade-icon`, transparent SVG, legible at 16–20 CSS pixels). No new promotional illustrations have been added. Future announcements should receive individual asset IDs and briefs here when designed.

Header utility controls (gear, envelope, edit pencil) use inline SVG UI icons in `client/MainMenu.tsx`. They require no commissioned raster assets. Profile display reuses the existing game tile assets. The provisional brand tile and Jade icon reservations above remain unchanged.

### Achievements & Journey foundation — 2026-10-20

No new final illustrations were commissioned. The four-stage Chronicle maps existing placeholders `chronicle-01` (First Seat), `chronicle-02` (Familiar Table), `chronicle-04` (Veteran’s Room), and `chronicle-07` (Living Legend); `chronicle-00` is the pre-first-rotation room. Other old stage placeholders remain reserved and inactive under the provisional mapping.

| Asset IDs / family | Brief | Current hook / delivery | Status |
| --- | --- | --- | --- |
| `prestige-emblem-00` through `prestige-emblem-07` | Eight states: awaiting first rotation plus seven evolving dedication emblems, unrelated to competitive tiers | `JourneyScreen.tsx`; CSS/text emblems, SVG preferred at 42–64 px | Placeholder; titles/thresholds provisional |
| `achievement-prestige-1`, `-10`, `-50`, `-100`, `-500`, `-1000`, `-5000` | Participation achievement icons matching evolving Prestige | `AchievementCard`, `data-artwork-id`; geometric glyphs | Placeholder |
| `achievement-anniversary-{year}` | Consistent numbered badge system for every calendar year | `AchievementCard`; parametric SVG with year, not 60 separate paintings | Placeholder |
| `anniversary-material-{5,10,15,20,25,30,40,50,60}` | Wood, Tin, Crystal, Porcelain, Silver, Pearl, Ruby, Gold, Diamond cosmetic milestone treatments | Material cards and future owned cosmetic previews; transparent SVG/small illustration | Eligibility preview only; exact cosmetic art TBD |
| `achievement-friend-of-mahjong` | Community badge and exclusive Friend Tile motif, visually distinct from purchased tiles | Community card glyph; final tile requires approved project tile dimensions | Placeholder; referral service pending |
| `achievement-{first-ranked-victory,first-tier-promotion,reach-gold,reach-platinum,reach-diamond,reach-master,personal-elo-record}` | Reserved candidate Skill badges | Candidate disclosure only | Proposed; do not commission until catalog approval |
| `cosmetic-{id}` | Collection preview fallback for connected owned cosmetics | Cosmetic card glyph; prefer existing inventory asset when available | Placeholder; currently Founder profile tile entitlement only |

The owner-only Public Profile preview reuses the same Chronicle/identity assets. Highlight artwork is not commissioned because the pattern catalog and qualification rules remain undefined.

### Simplified Journey layout revision — 2026-10-20

`lifetime-membership-tag` is a compact text/infinity-symbol treatment inspired by the owner's supplied membership reference. It currently requires no new illustration; an optional final anniversary insignia can replace the glyph later. The three equal scorecards use typography only. `prestige-emblem-00`–`07` are no longer rendered in the scoreboard and remain reserved rather than active art commissions. Chronicle assets are reused in the new Chronicle tab, and collection assets move to Inventory. No additional artwork is required for the tab labels.

### Achievement profile tile placeholders

The progression simulator generates cream Mahjong tiles with the achievement name printed on the face. These are code-rendered placeholders for profile slots, not final artwork. Replace with individual tile-face assets for Newcomer, Table Regular, Familiar Face, Mahjong Veteran, Table Elder, Mahjong Luminary, Living Legend, Legacy level recognition, and First Ranked Victory. Skill and level rewards remain provisional simulation content. Keep a legible name and accessible label for every replacement.

Revision: Legacy Level tile rewards are withdrawn from the current Journey design and simulation. Prestige milestone tiles and provisional Skill preview tiles remain; Highlights artwork awaits defined achievements.

Highlight simulation tile faces (provisional, not final approved achievements): Self Draw; Exceptional Tai; Personal Tai Best; Rare Winning Hand; Special Taiwanese Pattern. All currently use the achievement name printed on the standard placeholder tile face. Exact pattern art, thresholds, and rarity treatments await catalog approval.
