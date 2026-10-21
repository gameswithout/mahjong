# New Player Onboarding (NEO)

Status: Approved simplified interaction · 2026-10-19

Source: Product Owner's latest instructions in this chat. This replaces the earlier multi-page NEO prototype and supplements Chapter 5 of the [User Engagement Model](user-engagement-model.md).

## Current experience

A compact widget at the top of the main menu asks **What is your familiarity with Mahjong?** Both Unranked and Ranked remain visible below it.

| Choice | Response | NEO completion |
| --- | --- | --- |
| New Player | Open a blank scripted-tutorial placeholder containing only a Back to main menu button | Clicking Back to main menu completes NEO and hides the widget |
| Casual Player | Show the Casual description and highlight Unranked as the recommended starting point | Got it or starting a game completes NEO and hides the widget |
| Experienced Player | Show the Experienced description and highlight Ranked as the recommended starting point | Got it or starting a game completes NEO and hides the widget |

Choosing Casual or Experienced does not launch a game or open another page. The highlight is temporary guidance, not a permanent change to the menu. Completed onboarding stays hidden on subsequent visits.

There is no separate first-run questionnaire page, multi-step lesson, guided sample rotation, recap, resume widget, or Review onboarding control in the current NEO. The New Player placeholder is deliberately blank; its button represents completion for navigation purposes only. It grants no XP, Jade, Elo, achievement, or gameplay completion credit.

## Persistence and compatibility

`client/NeoExperience.tsx` saves the selected path and completion locally under `mahjong.neo.v1:<user-id>`. Existing completed records remain complete. Unfinished steps from the older prototype return to the menu widget rather than reopening removed pages. Accounts have separate records; the existing in-place guest upgrade retains the same ID. Cloud synchronization remains future work.

The independent preview is `/neo-evidence.html`. Reset walkthrough clears only its isolated preview identity so all three choices can be inspected. The real application at `/` embeds the same widget after guest/account sign-in.

Ranked's existing confirmation/sample experience is separate from NEO. Experienced selection only highlights the Ranked card. Play Ranked is temporarily disabled and greyed out for everyone. The internal preview remains preserved, but the main-menu button does not open it. The standalone tutorial button is hidden; New Player in the NEO widget still opens its blank tutorial placeholder. Prototype introduction flags must not substitute for acceptance of future production stake rules.

## Future tutorial design

The full in-game scripted tutorial, guided actions, guaranteed successful hand, UI orientation, contextual help, and Tai explanations remain to be designed. Implement them inside the tutorial experience when approved, without expanding the familiarity widget into another onboarding wizard.

Activation metrics must count real completed hands and full rotations. The widget records optional feature-engagement events only; placeholder completion is not a real gameplay milestone.

## Artwork

The current widget and blank tutorial page require no final artwork. Earlier instructional tile and guided-table artwork entries remain reserved in the [Artwork Register](artwork-register.md), marked inactive rather than treated as active commissions.

## Main menu layout — 2026-10-20

A compact identity/utility header sits above the flexible CTA slot. NEO is the first use of that slot; completion or “Not now” removes it and its space, including on later visits. Dismissal records `neo_dismissed` and does not count as tutorial completion. The same position is reserved for future dismissible announcements; no season system is implied.

Unranked and the currently disabled Ranked action sit beneath the banner, with Jade icon and available balance above the cards. My Journey is the default tab of the lower shared content panel; Friends / Party and Store replace its visible content. The section tabs form a folder-style horizontal row above a full-width content panel on all devices. On narrow screens the mode cards stack. Existing social and Store services retain their current capabilities; notifications are explicitly a placeholder.

### Shared temporary CTA treatment — 2026-10-20

`TemporaryCta` is the common banner for NEO and the optional analytics privacy question. Only one banner appears at a time: NEO first, then privacy when NEO is completed or dismissed. Privacy answers retain their existing persistence and consent behavior; closing its banner records a decline. The language settings announcement has been removed from the main menu. Language selection remains available in Settings.

The header is titled “Mahjong,” uses the existing three-tile/nickname profile badge with a separate edit icon and modal editor, and shows gear and envelope controls. The unread count is zero until a notification service is implemented; it is not a simulated count.

### Footer advertising preview — 2026-10-20

A non-interactive, labelled advertisement placeholder sits at the bottom of the main menu, after the shared content panel and utility links. Desktop uses a 728 × 90 reference; narrow layouts use 320 × 100, shrinking to fit very small viewports. The preview includes no ad network scripts or tracking. Active Mahjong tables remain ad-free; the footer is rendered only by the main-menu branch and its isolated preview. This is separate from the temporary CTA slot.
