# P0.2 Decision Confidence — Completion Evidence

- Date: 2026-07-25
- Scope: tile inspection, visible-copy assistance, action explanations, and
  irreversible-action safeguards
- Result: implemented and verified at the certified compact viewport and
  desktop

## Player interaction

- Every concealed hand tile is an actual button and remains inspectable while
  another seat acts.
- The first activation selects and raises a tile. Matching copies in the local
  hand, public melds, and discard rivers receive both an outline and brightness
  change.
- On the player's discard turn, activating the selected tile again commits the
  discard. This is a direct select/play convention, not a modal confirmation on
  every discard.
- A selection made outside the player's turn is cleared when the next discard
  turn begins, so an old inspection can never become a one-activation discard.
- Gang is the exceptional irreversible action: its first activation changes
  the action to **Confirm Gang** and explains that the hand change cannot be
  undone.

The same native button and disclosure controls serve keyboard, touch, and
pointer input. Selection state is also exposed through `aria-pressed`.

## Authoritative assistance

Ting entries continue to come only from `SeatView.waits`, including the
server-computed `visible_remaining` value. The compact panel keeps each wait
and its count directly visible as **N left** or **All visible**. Its accessible
label states **copies not visible** rather than implying the count is a
wall-order prediction.

The client does not infer waits, hidden tiles, or action legality. Disabled
legal-action buttons now show a public request-state explanation while the
previous command is awaiting acknowledgement.

## Responsive evidence

- [Selected tile at 640×360](wireframe-evidence/selected-tile-inspection.png)
- The current rendered gate captures the directly visible Ting waits as
  `ting-waits-visible.png` in its per-commit UI evidence artifact.
- [Decision-confidence table at 1280×720](wireframe-evidence/decision-confidence-desktop.png)

The wireframe validator confirms at 640×360 that the table stays within the
viewport, every required table-state indicator remains visible, every hand
tile target is at least 32×44 CSS pixels, and every action target is at least
44×44 CSS pixels.

## Verification

```shell
npm test -- --run
npm run build
node scripts/validate-match-table-wireframe.mjs http://127.0.0.1:4175
git diff --check
```

Component coverage includes:

- inspect-first/discard-second behavior;
- matching-copy highlighting across hand, meld, and river;
- directly visible Ting waits and remaining-copy labels;
- Gang confirmation;
- disabled-action explanation;
- Practice flow using the same two-activation discard path.
