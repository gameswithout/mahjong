# P1 Onboarding Responsive and Accessibility Validation

- Date: 2026-07-29
- Branch: `agent/p1-rendered-evidence`
- Scope: P1 lobby, queue-health states, tutorial welcome, active lesson, and
  tutorial completion
- Result: deterministic evidence surface, automated DOM checks, production
  accessibility fixes, and a rendered Chromium CI gate are complete

This pass closes the reproducibility gap recorded in
`docs/p1-onboarding-and-repeat-play.md` without changing the P2.3 statistics
surface. It adds a deterministic entry point that renders the real production
components and CSS without authentication, AGS calls, timers, or mutable
backend data.

## Evidence scenarios

Open `onboarding-evidence.html` with one of these query values:

| Scenario | State represented |
| --- | --- |
| `lobby` | Guest lobby with level 4, 12,480 available Jade, tutorial, Practice, Quick Play, and locked tiers |
| `queue-normal` | Four-human queue after 45 seconds, with no invented wait estimate |
| `queue-slow` | Queue after 95 seconds, including the Practice escape hatch |
| `tutorial` | Real `TutorialScreen`, including its welcome, interactive lesson, and completion states |

The harness uses `LobbyHeader`, `PracticeLaunchCard`, `LockedTiers`, and
`TutorialScreen` directly. Its fixtures are fixed only to make captures
repeatable.

## Automated checks

`client/OnboardingEvidence.test.tsx` covers every top-level scenario and
asserts:

- exactly one `main` landmark and one `h1`;
- unique element IDs;
- an accessible name for every button, link, and form control;
- the expected lobby hierarchy;
- the p50 queue copy without a fabricated estimate;
- the 90-second Practice escape hatch;
- retained heading hierarchy after starting the tutorial.

The audit found and fixed two production issues:

- the active tutorial used an `h2` as its page title and therefore had no
  level-one heading;
- tutorial text actions did not guarantee a 44 by 44 CSS-pixel target.

The tutorial progress animation now also disables its transition when the
player requests reduced motion.

## Reproducible browser capture

`scripts/capture-onboarding-evidence.mjs` is the browser measurement and
capture gate. It covers:

- 360 by 640 mobile portrait menus;
- 640 by 360 compact landscape active tutorial;
- 1280 by 720 desktop;
- reduced-motion rendering;
- forced-colors rendering.

For every scenario it checks expected copy, horizontal overflow, landmarks,
heading hierarchy, duplicate IDs, control names, and 44 CSS-pixel action
targets. It writes PNG files and `p1-onboarding-report.json` to
`.artifacts/ui-evidence/` by default. CI uploads that directory as the
`ui-evidence-<commit>` artifact for 14 days.

Run the complete production-mode gate:

```shell
npm run build
npm run evidence:ui
```

The CI gate also captures the match table and result screens, fails on browser
runtime/console/request errors, and records bundle-size measurements. See
[`../ui-evidence-ci.md`](../ui-evidence-ci.md) for the artifact contract and
deliberate device/manual-review limits.

## Verification completed in this pass

```text
npm test
  46 files passed
  377 tests passed

npm run build
  production build passed
  dist/onboarding-evidence.html emitted

node --check scripts/capture-onboarding-evidence.mjs
  passed

git diff --check
  passed
```

The evidence harness builds as a separate HTML entry and does not add code to
the main application entry. The CI gate uses gzip bytes rather than Vite's
uncompressed 500 kB warning and enforces the versioned budgets in
`.github/ui-evidence-budgets.json`.
