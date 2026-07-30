# Rendered UI Evidence CI Gate

- Date: 2026-07-29
- Scope: deterministic match-table, result, onboarding, responsive,
  accessibility, runtime-error, and client-bundle checks
- Trigger: every pull request to `main` and every push to `main`
- Artifact retention: 14 days

The `UI evidence (Chromium)` CI job turns the existing UX capture scripts into
a release gate. It builds the production client, serves `dist/` through Vite
Preview, exercises the deterministic evidence pages in headless Chromium, and
uploads the resulting images, reports, and logs as one workflow artifact.
The preview defaults to the production `/mahjong/` base path so those pages
load the same rooted asset URLs that GitHub Pages serves. A build made with a
different base can set `UI_EVIDENCE_BASE_PATH` explicitly.

It does not authenticate or call AGS. The evidence pages use fixed fixtures and
production components/CSS, making failures reproducible without player data,
mutable backend state, or secrets.

## What fails the job

- the 640 by 360 match table overflows, clips a required element, loses a seat
  wind, or renders undersized tile/action targets;
- a Jade or Practice result loses acceptance-critical explanation text, the
  four-seat reconciliation, or compact-width reflow;
- a lobby, queue, or tutorial scenario loses its landmark/heading structure,
  creates duplicate IDs, exposes an unnamed control, renders a primary action
  below 44 CSS pixels, or scrolls horizontally;
- any deterministic evidence page reports a browser page error, failed
  request, unexpected external request, or `console.error`;
- the compressed production build exceeds 5 MiB, or the largest compressed
  JavaScript file exceeds the 200 KiB regression guardrail.

The 5 MiB limit is the specification's initial-shell budget applied
conservatively to the entire generated static directory. The 200 KiB
single-file limit is an engineering regression guardrail, not a product
requirement; it leaves headroom above the current main bundle while still
forcing a deliberate code-splitting decision after a material increase.
Budgets are versioned in `.github/ui-evidence-budgets.json`.

## Artifact contents

The `ui-evidence-<commit SHA>` artifact contains:

- compact and desktop PNG captures;
- `match-table-report.json`;
- `result-screen-report.json`;
- `p1-onboarding-report.json`;
- `bundle-report.json`, including every generated file's raw and gzip size;
- one log per evidence suite and the preview-server log.

Artifacts upload even when an assertion fails, so the failed frame and its
measurements remain available for diagnosis.

## Implementation verification

The implementation branch passed:

- 48 test files and 387 tests;
- the production TypeScript/Vite build;
- syntax checks for every evidence script;
- workflow YAML parsing;
- the bundle gate at 276,855 gzip bytes for the whole build and 166,807 gzip
  bytes for the largest JavaScript file.

The local in-app browser integration exposed no browser backend during this
implementation, so no new rendered image is claimed here. The first successful
GitHub Actions artifact is the authoritative execution proof for the new job.

## Local reproduction

```shell
npm ci
npx playwright install chromium
npm run build
npm run evidence:ui
```

Outputs default to `.artifacts/ui-evidence/`, which is gitignored. To
intentionally refresh the historical checked-in image set, direct one capture
explicitly:

```shell
UI_EVIDENCE_DIR=docs/wireframe-evidence npm run evidence:ui
```

## Deliberate limits

This is deterministic Chromium regression coverage, not the physical-device
or human-review gate. It does not replace iOS Safari lifecycle testing,
Android thermal/battery soaks, manual screen-reader review, 200% text-scale
review, or UX Lead sign-off.
