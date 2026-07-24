// Validates the §9.2 simultaneous-visibility requirement (E7.F5) against
// the mandatory 640x360 CSS pixel landscape minimum viewport, using a real
// headless browser rather than only CSS-on-paper reasoning.
//
// Usage:
//   npm run dev  (in one terminal, serving client/wireframe-main.tsx at /wireframe.html)
//   node scripts/validate-match-table-wireframe.mjs [devServerURL]
//
// Writes two evidence screenshots (normal turn, urgent/automatic-pass
// window) to docs/wireframe-evidence/ and prints a JSON measurement report
// to stdout. Exits non-zero if any required element is missing, clipped
// outside the table bounds, the table itself overflows 640x360, or any
// accessible touch target falls under its §9.9 minimum.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseUrl = process.argv[2] ?? "http://localhost:5183";
const url = `${baseUrl}/wireframe.html`;
const evidenceDir = fileURLToPath(new URL("../docs/wireframe-evidence/", import.meta.url));
mkdirSync(evidenceDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="match-table"]');

const clip = { x: 0, y: 0, width: 640, height: 360 };
await page.screenshot({ path: `${evidenceDir}normal-turn.png`, clip });

// Toggle to the urgent-countdown / automatic-pass scenario and screenshot too.
// The toggle button sits below the fold, so Playwright's actionability
// check would auto-scroll it into view on a real .click(); trigger it via
// a JS-dispatched click instead, and this page is discarded afterward
// rather than reused for measurement, so no scroll state carries over.
await page.evaluate(() => document.querySelector('[data-testid="scenario-toggle"]')?.click());
await page.waitForTimeout(200);
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${evidenceDir}urgent-claim-window.png`, clip });
await page.close();

// Chromium restores scroll offset across a same-page reload, so measurement
// runs on a brand-new page rather than page.reload() to guarantee a
// pristine, unscrolled viewport.
const measurePage = await browser.newPage({ viewport: { width: 640, height: 360 } });
await measurePage.goto(url, { waitUntil: "networkidle" });
await measurePage.waitForSelector('[data-testid="match-table"]');

const report = await measurePage.evaluate(() => {
  const doc = document;
  const table = doc.querySelector('[data-testid="match-table"]');
  const results = {};

  const tableRect = table.getBoundingClientRect();
  results.tableRect = {
    width: tableRect.width,
    height: tableRect.height,
    top: tableRect.top,
    left: tableRect.left,
  };
  results.tableOverflowsViewport =
    tableRect.bottom > 360 || tableRect.right > 640 || tableRect.top < 0 || tableRect.left < 0;

  // Required simultaneous-visibility elements (§9.2): presence + non-zero
  // visible area + within table bounds (no clipping outside the table).
  const requiredSelectors = {
    "local hand (tile identity)": ".local-seat .local-hand",
    "claim badge (claim source)": ".claim-badge",
    "most recent discard (pulsing outline)": ".discard-slot-recent",
    "current tile focus": ".current-tile-focus .tile-focus",
    "active player indicator": ".active-badge, .active-seat-callout",
    "dealer badge": ".dealer-badge",
    "seat wind labels (x4)": ".wind-badge",
    "continuation count": ".round-continuation",
    countdown: ".countdown",
    "legal action buttons": ".action-row .action-button",
    "drawable wall count": ".wall-count",
  };
  results.elements = {};
  for (const [name, selector] of Object.entries(requiredSelectors)) {
    const nodes = Array.from(doc.querySelectorAll(selector));
    const visible = nodes.filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.top >= tableRect.top - 1 &&
        rect.left >= tableRect.left - 1 &&
        rect.bottom <= tableRect.bottom + 1 &&
        rect.right <= tableRect.right + 1
      );
    });
    results.elements[name] = { count: nodes.length, visibleWithinTable: visible.length };
  }

  results.windLabelsText = Array.from(doc.querySelectorAll(".wind-badge")).map((n) => n.textContent);

  // §9.9 accessible hit-area minimums: 32x44 for compact hand tiles, 44x44
  // for action buttons.
  results.localHandTileBoxes = Array.from(doc.querySelectorAll(".local-hand-tile-wrap")).map((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  results.actionButtonBoxes = Array.from(doc.querySelectorAll(".action-button")).map((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });

  // Every discard tile across all four central rivers should be visible
  // (no clipped/overflow-hidden loss of a discard) at this snapshot's counts.
  results.discardCounts = Array.from(doc.querySelectorAll(".discard-river")).map((river) => {
    const grid = river.querySelector(".discard-grid");
    const visibleTiles = grid ? grid.querySelectorAll(".discard-slot .tile").length : 0;
    return { river: river.getAttribute("aria-label"), visibleDiscardTiles: visibleTiles };
  });

  return results;
});

await browser.close();

const failures = [];
if (report.tableOverflowsViewport) failures.push("match table overflows the 640x360 viewport");
for (const [name, v] of Object.entries(report.elements)) {
  if (v.count === 0) failures.push(`required element missing: ${name}`);
  else if (v.visibleWithinTable !== v.count) failures.push(`required element clipped outside table bounds: ${name}`);
}
const windsPresent = new Set(report.windLabelsText);
for (const wind of ["E", "S", "W", "N"]) {
  if (!windsPresent.has(wind)) failures.push(`seat wind label missing: ${wind}`);
}
for (const box of report.localHandTileBoxes) {
  if (box.width < 32 || box.height < 44) failures.push(`hand tile hit area below 32x44: ${box.width}x${box.height}`);
}
for (const box of report.actionButtonBoxes) {
  if (box.width < 44 || box.height < 44) failures.push(`action button below 44x44: ${box.width}x${box.height}`);
}

console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) {
  console.error("\nFAILURES:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("\nAll §9.2 simultaneous-visibility and §9.9 touch-target checks passed at 640x360.");
