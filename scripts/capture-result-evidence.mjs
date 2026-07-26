// Captures the P0.3 result-comprehension evidence its own completion note
// left open: the implementation session had no browser runtime, so the
// rendered captures were deferred rather than claimed unverified.
//
// Usage:
//   npm run dev  (in one terminal, serving /result-wireframe.html)
//   node scripts/capture-result-evidence.mjs [devServerURL]
//
// Writes desktop and 640x360-landscape captures per scenario into
// docs/wireframe-evidence/ and prints a JSON report. Exits non-zero if the
// acceptance-critical strings are missing from the rendered DOM, or if the
// result surface overflows the certified minimum viewport horizontally —
// vertical scrolling is expected and fine for a result, horizontal is not.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseUrl = process.argv[2] ?? "http://localhost:5183";
const url = `${baseUrl}/result-wireframe.html`;
const evidenceDir = fileURLToPath(new URL("../docs/wireframe-evidence/", import.meta.url));
mkdirSync(evidenceDir, { recursive: true });

const MINIMUM_VIEWPORT = { width: 640, height: 360 };
const DESKTOP_VIEWPORT = { width: 1280, height: 720 };

// One assertion per backlog acceptance criterion, checked against what the
// browser actually rendered rather than against a server-side string.
const SCENARIO_EXPECTATIONS = {
  "jade-capped": [
    "10,000 Jade per Tai × 45 Tai = 450,000 Jade",
    "Debit cap applied: 450,000 → 300,000 Jade",
    "300,000 Jade paid = 300,000 received",
    "Balances to zero",
  ],
  "jade-standard": ["10 Jade per Tai × 3 Tai = 30 Jade", "Balances to zero"],
  practice: ["Practice score only", "No Jade, rating, or progression is changed.", "Nothing persists."],
};

const browser = await chromium.launch();
const failures = [];
const report = { url, scenarios: [] };

for (const [scenario, expectations] of Object.entries(SCENARIO_EXPECTATIONS)) {
  const page = await browser.newPage({ viewport: DESKTOP_VIEWPORT });
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

  await page.screenshot({
    path: `${evidenceDir}result-${scenario}-desktop.png`,
    fullPage: true,
  });

  const compact = await browser.newPage({ viewport: MINIMUM_VIEWPORT });
  await compact.goto(url, { waitUntil: "networkidle" });
  await compact.locator(`[data-testid="scenario-${scenario}"]`).click();
  await compact.waitForSelector('[data-testid="result-surface"]');
  // Full-page rather than clipped to the fold: a result is allowed to scroll
  // vertically, so the evidence that matters is the whole column staying
  // readable at the certified minimum width, not what fits in 360px of height.
  await compact.screenshot({
    path: `${evidenceDir}result-${scenario}-360-landscape.png`,
    fullPage: true,
  });

  const overflowsHorizontally = await compact.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (overflowsHorizontally) {
    failures.push(`${scenario}: result surface scrolls horizontally at 640x360`);
  }

  report.scenarios.push({ scenario, netSeats, overflowsHorizontally, missing });
  await compact.close();
  await page.close();
}

await browser.close();

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (failures.length > 0) {
  process.stderr.write(`${failures.map((failure) => `FAIL: ${failure}`).join("\n")}\n`);
  process.exit(1);
}
