# P0.3 Result Comprehension — Completion Evidence

- Date: 2026-07-25
- Scope: winning-hand explanation, Tai calculation, transfer transparency,
  Jade reconciliation, cap disclosure, and next-hand context
- Result: implemented and covered by component, interaction, and production
  build verification

## Player story

The result now reads in the same order as the decision the server made:

1. The win type, winner, payer, and winning tile establish what happened.
2. The canonical tile decomposition shows the completed hand.
3. **Why this scored** starts open and lists every authoritative pattern and
   its Tai value before the raw Tai subtotal. It can be collapsed without
   losing the summary.
4. Dealer Tai is called out separately when it changes a relationship.
5. The settlement names every payer and recipient, shows effective Tai and
   raw payment, identifies an applied debit cap, and then shows the final
   transfer.
6. A four-seat net-change summary proves that total debits equal total credits
   and explicitly states that no Jade was created or removed.
7. The local balance is presented as a before/change/after equation alongside
   the durable ledger and AGS Wallet synchronization state.
8. Dealer rotation or continuation, Match ID, the account-protection offer,
   and the next action follow the explanation.

The screen uses the existing authoritative `SeatView` fields. It does not
recompute Mahjong legality, scoring patterns, transfers, caps, or balances in
the browser.

## Practice separation

AI Practice uses the same readable hand and scoring explanation, but the
settlement chapter is titled **Practice score only** and explicitly says:

- no Jade, rating, or progression changes;
- the displayed points do not persist;
- no Jade balance or Wallet state is shown.

## Cap and conservation evidence

Component coverage includes the product specification's capped-payment shape:

```text
10,000 Jade per Tai × 45 Tai = 450,000 Jade
Debit cap applied: 450,000 → 300,000 Jade
300,000 Jade paid = 300,000 received
```

The uncapped calculation and applied cap remain visible together. Net changes
for East, South, West, and North are shown even when a seat's change is zero.

## Accessibility and responsive behavior

- The result chapters are semantic regions with labelled headings.
- Scoring detail uses a native button with `aria-expanded` and
  `aria-controls`.
- Transfer direction, cap application, and balance status are expressed in
  text and not by color alone.
- The desktop result uses two chapters side by side; it collapses to one
  column below 56 rem.
- Balance math and the four-seat net summary collapse to single-column layouts
  on narrow screens.
- The only new reveal animation is removed by `prefers-reduced-motion`.

## Rendered evidence

Captured 2026-07-25 from the real `HandResultScreen` in headless Chromium,
closing this document's earlier open follow-up (the implementation session had
no browser runtime, so the captures were deferred rather than claimed).

| Scenario | Desktop 1280x720 | Minimum width 640 |
| --- | --- | --- |
| Jade, debit cap applied | [`result-jade-capped-desktop.png`](wireframe-evidence/result-jade-capped-desktop.png) | [`result-jade-capped-360-landscape.png`](wireframe-evidence/result-jade-capped-360-landscape.png) |
| Jade, standard hand | [`result-jade-standard-desktop.png`](wireframe-evidence/result-jade-standard-desktop.png) | [`result-jade-standard-360-landscape.png`](wireframe-evidence/result-jade-standard-360-landscape.png) |
| Practice | [`result-practice-desktop.png`](wireframe-evidence/result-practice-desktop.png) | [`result-practice-360-landscape.png`](wireframe-evidence/result-practice-360-landscape.png) |

Regenerate with the dev server running:

```shell
npm run dev
node scripts/capture-result-evidence.mjs
```

The script is an assertion, not just a screenshotter. It fails if any
acceptance-critical string is absent from the rendered DOM — the uncapped
calculation, the applied cap, the paid-equals-received reconciliation, and the
Practice non-persistence wording — or if the result surface scrolls
horizontally at the certified 640 CSS-pixel minimum width. A result may scroll
vertically, so the compact captures are full-column rather than clipped to the
fold; what they certify is that nothing becomes unreadable or truncated at that
width.

The three scenarios live in `client/resultWireframeMockData.ts` and are
rendered by `result-wireframe.html`. Each is internally coherent: the capped
hand genuinely scores 44 raw Tai plus 1 Dealer Tai, because pairing a large
effective Tai with a small raw Tai makes the screen derive an absurd dealer
bonus (it computes the bonus as effective − raw, there being no separate
server-sent breakdown). Worth knowing before reusing these numbers.

What the captures show against the acceptance criteria:

- **All four balance changes reconcile visibly to zero.** The net-change grid
  names East, South, West, and North, showing `0` for the two seats that
  neither paid nor received, above the explicit "300,000 Jade paid = 300,000
  received. No Jade was created or removed."
- **Capped settlements show both the uncapped calculation and the applied
  cap.** `10,000 Jade per Tai × 45 Tai = 450,000 Jade` sits directly above
  `Debit cap applied: 450,000 → 300,000 Jade`, with the final 300,000 Jade
  transfer beside them.
- **Practice never implies persistent rewards.** The Practice capture carries
  the "No Jade, rating, or progression is changed" banner, titles the chapter
  "Practice score only", denominates every amount in Practice points, ends on
  "Nothing persists.", and shows no Jade balance or Wallet state at all.

## Verification

```shell
npx vitest run client/HandResultScreen.test.tsx client/CompletedHandFlow.test.tsx
npm run build
npm test -- --run
git diff --check
```

Results:

- full client suite: 23 files, 185 tests passed after the Wallet-status
  comprehension regressions were added;
- production TypeScript/Vite build: passed;
- root Go suite: passed;
- Match Service Go suite: passed.

Component coverage includes:

- Practice/non-persistent wording and actions;
- discard and self-draw result relationships;
- winning decomposition, scoring-pattern disclosure, and raw Tai subtotal;
- Dealer Tai attribution;
- Jade stake math, debit-cap disclosure, and zero-sum reconciliation;
- local durable balance and Wallet sync state;
- account-upgrade placement and result actions.
