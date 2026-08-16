// Captures the P0.3 result-comprehension evidence its own completion note
// left open: the implementation session had no browser runtime, so the
// rendered captures were deferred rather than claimed unverified.
//
// Usage:
//   npm run dev  (in one terminal, serving /result-wireframe.html)
//   node scripts/capture-result-evidence.mjs [devServerURL]
//
// Writes desktop and 640x360-landscape captures per scenario into
// UI_EVIDENCE_DIR (default: .artifacts/ui-evidence/) and prints a JSON report.
// Exits non-zero if the
// acceptance-critical strings are missing from the rendered DOM, or if the
// result surface overflows the certified minimum viewport horizontally —
// vertical scrolling is expected and fine for a result, horizontal is not.
import { join } from "node:path";
import { chromium } from "playwright";

import {
  evidenceDirectory,
  trackPageFailures,
  writeEvidenceJson,
} from "./ui-evidence-support.mjs";

const baseUrl = process.argv[2] ?? "http://localhost:5183";
const url = `${baseUrl}/result-wireframe.html`;
const allowedOrigin = new URL(baseUrl).origin;
const evidenceDir = evidenceDirectory();

const MINIMUM_VIEWPORT = { width: 640, height: 360 };
const DESKTOP_VIEWPORT = { width: 1280, height: 720 };

// One assertion per backlog acceptance criterion, checked against what the
// browser actually rendered rather than against a server-side string.
const SCENARIO_EXPECTATIONS = {
  "jade-capped": [
    "10,000 Jade per 台 × 45 台 = 450,000 Jade",
    "Debit cap applied: 450,000 → 300,000 Jade",
    "300,000 Jade paid = 300,000 received",
    "Balances to zero",
  ],
  "jade-standard": ["10 Jade per 台 × 3 台 = 30 Jade", "Balances to zero"],
  practice: [
    "Practice score only",
    "Jade, rating, and achievements stay unchanged. Mastery XP and this hand's history are saved.",
    "+25 XP",
    "Practice points do not persist.",
  ],
  "exhaustive-draw": [
    "Ready hands at the draw",
    "3 live copies total",
    "Not tenpai",
  ],
  "deal-in-review": [
    "Your decisive discard",
    "No matching copy was public before the discard",
    "visibility comparisons, not guaranteed-safe discards",
  ],
};

const browser = await chromium.launch();
const failures = [];
const report = { url, scenarios: [], runtimeFailures: [] };

for (const [scenario, expectations] of Object.entries(SCENARIO_EXPECTATIONS)) {
  const page = await browser.newPage({ viewport: DESKTOP_VIEWPORT });
  const desktopRuntimeFailures = trackPageFailures(page, allowedOrigin);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator(`[data-testid="scenario-${scenario}"]`).click();
  await page.waitForSelector('[data-testid="result-surface"]');

  const text = await page.locator('[data-testid="result-surface"]').innerText();
  const missing = expectations.filter((expected) => !text.includes(expected));
  if (missing.length > 0) {
    failures.push(`${scenario}: missing rendered copy ${JSON.stringify(missing)}`);
  }

  // The four-seat net summary must name every seat, including seats whose
  // change is zero, so a player can see the hand reconcile across the table.
  const netSeats = await page.locator('[aria-label^="Net "] li').count();
  if (netSeats !== 4) {
    failures.push(`${scenario}: expected four seats in the net summary`);
  }

  await page.screenshot({
    path: join(evidenceDir, `result-${scenario}-desktop.png`),
    fullPage: true,
  });

  const compact = await browser.newPage({ viewport: MINIMUM_VIEWPORT });
  const compactRuntimeFailures = trackPageFailures(compact, allowedOrigin);
  await compact.goto(url, { waitUntil: "networkidle" });
  await compact.locator(`[data-testid="scenario-${scenario}"]`).click();
  await compact.waitForSelector('[data-testid="result-surface"]');
  // Full-page rather than clipped to the fold: a result is allowed to scroll
  // vertically, so the evidence that matters is the whole column staying
  // readable at the certified minimum width, not what fits in 360px of height.
  await compact.screenshot({
    path: join(evidenceDir, `result-${scenario}-360-landscape.png`),
    fullPage: true,
  });

  const overflowsHorizontally = await compact.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (overflowsHorizontally) {
    failures.push(`${scenario}: result surface scrolls horizontally at 640x360`);
  }

  const scenarioRuntimeFailures = [
    ...desktopRuntimeFailures.map((failure) => `desktop: ${failure}`),
    ...compactRuntimeFailures.map((failure) => `compact: ${failure}`),
  ];
  report.runtimeFailures.push({
    scenario,
    failures: scenarioRuntimeFailures,
  });
  for (const failure of scenarioRuntimeFailures) {
    failures.push(`${scenario}: ${failure}`);
  }
  report.scenarios.push({ scenario, netSeats, overflowsHorizontally, missing });
  await compact.close();
  await page.close();
}

await browser.close();

report.failures = failures;
writeEvidenceJson(join(evidenceDir, "result-screen-report.json"), report);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (failures.length > 0) {
  process.stderr.write(`${failures.map((failure) => `FAIL: ${failure}`).join("\n")}\n`);
  process.exit(1);
}
