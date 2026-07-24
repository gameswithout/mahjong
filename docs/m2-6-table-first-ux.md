# M2.6 — Table-first match UX

**Status:** Implemented on `agent/m2-6-table-first-ux`; automated validation
passes. Browser/device visual sign-off remains a release check.

## Player outcome

The match screen now behaves like a game table rather than a compact
wireframe enlarged inside a page:

- all four discard rivers occupy the central playfield around a compact
  round/wall/turn hub;
- opponents sit on the top and side rails with complete concealed-hand
  silhouettes and exposed melds;
- the local cockpit gives most of its space to a viewport-scaled hand,
  visibly separates the newly drawn tile, keeps Ready waits readable, and
  supports drag or keyboard reordering in manual-sort mode;
- legal claims and discard confirmation appear in a contextual dock directly
  above the hand, while passive turns no longer reserve an empty action row;
- routine draws happen automatically after a short turn-change beat, with an
  idempotent state-version guard and a visible `Draw now` fallback;
- the table fills the dynamic viewport instead of stopping at 1200 px;
- discard arrival, turn focus, claim actions, and the drawn tile receive
  restrained motion, with Reduced Motion support and optional table
  sound/haptic feedback stored as a device preference.

## Responsive contract

- The established 640×360 landscape floor remains the compact baseline.
- From 700 px upward, hand and river tiles scale with `clamp()` rather than a
  single fixed desktop size.
- Desktop/tablet rail widths and cockpit heights scale against both viewport
  axes.
- The app-level match frame owns `100dvw × 100dvh`; lobby and result layouts
  remain unchanged.

## Safety and accessibility retained

- The local seat remains at the bottom regardless of logical wind.
- A tile must still be selected and explicitly confirmed before discard.
- Legal claim options still come only from the authoritative server view.
- Selected matching tile types retain outline plus brightness, not color alone.
- Timer threshold announcements, keyboard tile reordering, minimum action
  targets, focus styling, and Reduced Motion behavior remain in place.

## Validation

- TypeScript production build.
- Full Vitest client suite and `npm run test:table-ux`, including M2.6
  hierarchy, cockpit, automatic-draw fallback, and feedback-preference coverage.
- Root and match-service Go tests.
- `git diff --check`.

Before release, rerun `scripts/validate-match-table-wireframe.mjs` at 640×360
and complete desktop/tablet/mobile-landscape visual sign-off on the target
browsers.
