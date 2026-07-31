// Captures the remaining P1 lobby, queue, and tutorial evidence against the
// same production components and CSS used by the game.
//
// Usage:
//   npm run dev -- --host 127.0.0.1 --port 5191
//   npm run capture:onboarding -- http://127.0.0.1:5191
//
// The result page is deterministic and makes no AGS calls. Images and a JSON
// measurement report are written to UI_EVIDENCE_DIR (default:
// .artifacts/ui-evidence/).
import { join } from "node:path";
import { chromium } from "playwright";

import {
  evidenceDirectory,
  trackPageFailures,
  writeEvidenceJson,
} from "./ui-evidence-support.mjs";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5191";
const allowedOrigin = new URL(baseUrl).origin;
const evidenceDir = evidenceDirectory();

const MOBILE_PORTRAIT = { width: 360, height: 640 };
const COMPACT_LANDSCAPE = { width: 640, height: 360 };
const DESKTOP = { width: 1280, height: 720 };
const failures = [];
const report = { baseUrl, captures: [], runtimeFailures: [] };

async function finishTutorial(page) {
  await page.getByRole("button", { name: "Start with the basics" }).click();
  for (let index = 0; index < 24; index += 1) {
    if (await page.getByRole("heading", { name: "You are ready for your first hand." }).count()) {
      return;
    }
    await page.getByRole("button", { name: "Skip step" }).click();
  }
  throw new Error("Tutorial did not reach its completion screen.");
}

const captures = [
  {
    id: "lobby-portrait",
    scenario: "lobby",
    viewport: MOBILE_PORTRAIT,
    expectations: [
      "Play a hand with friends.",
      "Start the tutorial",
      "Practice vs Bots",
      "Find a table",
      "Higher stakes, rewarding progression, and more personalization features",
    ],
  },
  {
    id: "lobby-landscape",
    scenario: "lobby",
    viewport: COMPACT_LANDSCAPE,
    expectations: ["Start the tutorial", "Practice vs Bots", "Find a table"],
  },
  {
    id: "lobby-desktop",
    scenario: "lobby",
    viewport: DESKTOP,
    expectations: ["12,480", "Level 4", "Bamboo Courtyard"],
  },
  {
    id: "queue-p50",
    scenario: "queue-normal",
    viewport: MOBILE_PORTRAIT,
    expectations: [
      "Still searching. A table needs four players.",
      "45s in queue",
      "Cancel",
    ],
  },
  {
    id: "queue-patience",
    scenario: "queue-slow",
    viewport: MOBILE_PORTRAIT,
    expectations: [
      "This is taking longer than usual.",
      "1m 35s in queue",
      "Practice instead",
      "Cancel",
    ],
  },
  {
    id: "tutorial-welcome",
    scenario: "tutorial",
    viewport: MOBILE_PORTRAIT,
    expectations: ["Never played Mahjong? Start here.", "Start with the basics"],
  },
  {
    id: "tutorial-first-step",
    scenario: "tutorial",
    viewport: COMPACT_LANDSCAPE,
    beforeCapture: (page) =>
      page.getByRole("button", { name: "Start with the basics" }).click(),
    expectations: ["Lesson 1 of 4", "Step 1 of", "Your task", "Reset step"],
  },
  {
    id: "tutorial-first-step-desktop",
    scenario: "tutorial",
    viewport: DESKTOP,
    beforeCapture: (page) =>
      page.getByRole("button", { name: "Start with the basics" }).click(),
    expectations: ["Lesson 1 of 4", "Your task", "Reset step"],
  },
  {
    id: "tutorial-complete",
    scenario: "tutorial",
    viewport: MOBILE_PORTRAIT,
    beforeCapture: finishTutorial,
    expectations: [
      "You are ready for your first hand.",
      "Practice vs Bots",
      "Finish and return to lobby",
    ],
  },
];

function inspectRenderedPage() {
  const allControls = Array.from(
    document.querySelectorAll("button, a[href], input, select, textarea"),
  );
  const actionControls = Array.from(
    document.querySelectorAll(
      ".primary-action, .secondary-action, .tutorial-text-button",
    ),
  );
  const ids = Array.from(document.querySelectorAll("[id]")).map(
    (node) => node.id,
  );
  const duplicateIds = [
    ...new Set(ids.filter((id, index) => ids.indexOf(id) !== index)),
  ];
  const unnamedControls = allControls
    .filter((control) => {
      const labelledBy = control.getAttribute("aria-labelledby");
      const label = control.getAttribute("aria-label");
      const wrappingLabel = control.closest("label")?.textContent?.trim();
      const explicitLabel = control.id
        ? document
            .querySelector(`label[for="${CSS.escape(control.id)}"]`)
            ?.textContent?.trim()
        : null;
      return (
        !labelledBy &&
        !label &&
        !wrappingLabel &&
        !explicitLabel &&
        !control.textContent?.trim()
      );
    })
    .map((control) => control.outerHTML.slice(0, 160));
  const undersizedControls = actionControls
    .map((control) => {
      const rect = control.getBoundingClientRect();
      return {
        label:
          control.getAttribute("aria-label") ??
          control.textContent?.trim() ??
          control.tagName,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        minimum: 44,
      };
    })
    .filter(
      (control) =>
        control.width < control.minimum || control.height < control.minimum,
    );

  return {
    horizontalOverflow:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
    mainCount: document.querySelectorAll("main").length,
    h1Count: document.querySelectorAll("h1").length,
    duplicateIds,
    unnamedControls,
    undersizedControls,
  };
}

function recordMeasurementFailures(id, measurements) {
  if (measurements.horizontalOverflow) {
    failures.push(`${id}: horizontal viewport overflow`);
  }
  if (measurements.mainCount !== 1) {
    failures.push(`${id}: expected one main landmark`);
  }
  if (measurements.h1Count !== 1) {
    failures.push(`${id}: expected one h1`);
  }
  if (measurements.duplicateIds.length) {
    failures.push(`${id}: duplicate IDs ${measurements.duplicateIds.join(", ")}`);
  }
  if (measurements.unnamedControls.length) {
    failures.push(`${id}: unnamed controls`);
  }
  if (measurements.undersizedControls.length) {
    failures.push(`${id}: undersized controls`);
  }
}

const browser = await chromium.launch();
for (const capture of captures) {
  const page = await browser.newPage({ viewport: capture.viewport });
  const runtimeFailures = trackPageFailures(page, allowedOrigin);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const url = `${baseUrl}/onboarding-evidence.html?capture=1&scenario=${capture.scenario}`;
  await page.goto(url, { waitUntil: "networkidle" });
  if (capture.beforeCapture) {
    await capture.beforeCapture(page);
  }

  const text = await page.locator("body").innerText();
  const normalizedText = text.toLocaleLowerCase();
  const missing = capture.expectations.filter(
    (expectation) => !normalizedText.includes(expectation.toLocaleLowerCase()),
  );
  const measurements = await page.evaluate(inspectRenderedPage);
  await page.screenshot({
    path: join(evidenceDir, `p1-${capture.id}.png`),
    fullPage: true,
  });

  if (missing.length) failures.push(`${capture.id}: missing ${missing.join(", ")}`);
  recordMeasurementFailures(capture.id, measurements);
  for (const failure of runtimeFailures) {
    failures.push(`${capture.id}: ${failure}`);
  }

  report.captures.push({
    id: capture.id,
    url,
    viewport: capture.viewport,
    missing,
    ...measurements,
  });
  report.runtimeFailures.push({ id: capture.id, failures: runtimeFailures });
  await page.close();
}

const contrastPage = await browser.newPage({ viewport: MOBILE_PORTRAIT });
const contrastRuntimeFailures = trackPageFailures(
  contrastPage,
  allowedOrigin,
);
await contrastPage.emulateMedia({
  forcedColors: "active",
  reducedMotion: "reduce",
});
await contrastPage.goto(
  `${baseUrl}/onboarding-evidence.html?capture=1&scenario=lobby`,
  { waitUntil: "networkidle" },
);
await contrastPage.screenshot({
  path: join(evidenceDir, "p1-lobby-forced-colors.png"),
  fullPage: true,
});
const contrastMeasurements = await contrastPage.evaluate(inspectRenderedPage);
recordMeasurementFailures("forced-colors lobby", contrastMeasurements);
for (const failure of contrastRuntimeFailures) {
  failures.push(`forced-colors lobby: ${failure}`);
}
report.forcedColors = {
  viewport: MOBILE_PORTRAIT,
  ...contrastMeasurements,
  runtimeFailures: contrastRuntimeFailures,
};
await contrastPage.close();
await browser.close();

report.failures = failures;
writeEvidenceJson(join(evidenceDir, "p1-onboarding-report.json"), report);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length) {
  process.stderr.write(`${failures.map((failure) => `FAIL: ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
}
