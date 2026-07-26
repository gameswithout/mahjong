# P0.1 Table Comprehension — Completion Evidence

- Date: 2026-07-25
- Scope: turn ownership, latest discard, claim urgency, wall state, legal local
  actions, and responsive table hierarchy
- Result: implemented and covered by component, adapter, and compact-layout
  verification

## Two-second table read

The playfield keeps the three questions a player must answer in one visual
line through its center and action dock:

1. **Whose turn is it?** The active seat has a persistent border treatment,
   while the center names **Your turn** or **{player}'s turn · {wind}** in
   text. Turn ownership is never communicated by the animated green marker
   alone.
2. **What was played?** The center presents the latest discard at focus size,
   names the tile and source, and changes its heading to **Tile in play**
   during a claim window. The original chronological river position remains
   highlighted.
3. **What can I do?** The same center prompt says **Choose a claim or pass**,
   **Your turn · select a tile**, or the current draw state. Authoritative
   action buttons occupy one contextual dock immediately above the local hand.

A single regression test now asserts all three statements together for an
opponent-turn claim window, in addition to the existing tests for each area.

## Supporting hierarchy

- Four discard rivers remain in the shared central playfield.
- Opponent concealed hands expose silhouettes and counts only; public melds,
  bonus tiles, and connection/takeover state remain scannable.
- Round wind, dealer continuation, drawable wall count, and the common
  countdown share one compact status module.
- Wall warnings add text and assistive announcements at 16 and 8 drawable
  tiles.
- Claim choices show the complete Chow tile sequence and identify the claimed
  tile.
- The local hand preserves inspect-first/discard-second interaction, newly
  drawn tile separation, Ting waits, and the authoritative action state.

## Accessibility and motion

- Native buttons and plain-language labels expose every legal action;
  legality is not represented by color.
- The timer keeps a visible number and announces the 3-second and 1-second
  thresholds.
- Latest-discard and turn emphasis combine outline, brightness, position, and
  text.
- Reduced Motion disables turn, discard, claim, and reveal animation without
  removing the state cues.
- Keyboard, pointer, and touch use the same tile and action controls.

## Responsive evidence

The table keeps the certified 640×360 landscape floor and scales tile, river,
seat, focus, and cockpit geometry upward for tablet and desktop.

- [Normal turn at 640×360](wireframe-evidence/normal-turn.png)
- [Urgent claim window at 640×360](wireframe-evidence/urgent-claim-window.png)
- [Desktop decision table](wireframe-evidence/decision-confidence-desktop.png)

The in-app browser runtime was unavailable during the final wording update,
so a fresh screenshot of the explicit opponent-turn copy remains a follow-up.
The current component structure and text are covered directly in Vitest.

## Verification

```shell
npx vitest run client/MatchTable.ux.test.tsx client/matchTableAdapter.test.ts
npm run build
npm test -- --run
git diff --check
```

Results:

- focused table/adapter suite: 2 files, 46 tests passed;
- full client suite: 23 files, 181 tests passed;
- production TypeScript/Vite build: passed.

Coverage includes:

- four centered discard rivers and latest-tile focus;
- active-seat ownership during normal turns and claim windows;
- plain-language turn/discard/action comprehension contract;
- draw, discard, Chow/Pong/Kong/Win, and Pass presentation;
- wall/timer warnings and untimed Practice;
- compact cockpit, Ting explanation, sorting, and input safeguards.
