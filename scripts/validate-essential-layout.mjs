import { chromium } from "playwright";
import { createServer } from "vite";
import { existsSync } from "node:fs";

const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet-landscape", width: 1366, height: 768 },
  { name: "mobile-landscape", width: 932, height: 430 },
  { name: "minimum-landscape", width: 640, height: 360 },
];
const scenarios = ["review", "stalled", "active", "win", "draw", "pass-only", "maximum-actions", "side-panels"];
const selectors = [
  ["fullscreen", '[data-layout-region="fullscreen"]'],
  ["system controls", '[data-layout-region="system-controls"]'],
  ["top player", ".essential-opponent--top"],
  ["left player", ".essential-opponent--left"],
  ["right player", ".essential-opponent--right"],
  ["discard pile", ".essential-discard-stage"],
  ["information console", ".essential-console"],
  ["claim actions", ".essential-actions"],
  ["local player", ".essential-player"],
];

function overlap(a, b) {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 2 && height > 2 ? { width, height } : null;
}

const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const base = server.resolvedUrls?.local[0];
if (!base) throw new Error("Vite did not provide a local URL");
const installedChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(installedChrome) ? { executablePath: installedChrome } : {}),
});
const failures = [];
const actionTrayHeights = new Map();
const activeRegionPositions = new Map();

try {
  for (const viewport of viewports) {
    for (const scenario of scenarios) {
      const page = await browser.newPage({ viewport });
      await page.goto(`${base}essential-layout.html?scenario=${scenario}`, { waitUntil: "networkidle" });
      const regions = [];
      const scenarioSelectors = scenario === "side-panels"
        ? [...selectors, ["actions feed", ".essential-actions-feed"], ["guide", ".essential-guide"]]
        : selectors;
      for (const [name, selector] of scenarioSelectors) {
        const locator = page.locator(selector);
        const count = await locator.count();
        if (count !== 1) {
          failures.push(`${viewport.name}/${scenario}: expected one ${name}, found ${count}`);
          continue;
        }
        const box = await locator.boundingBox();
        if (!box) {
          failures.push(`${viewport.name}/${scenario}: ${name} has no geometry`);
          continue;
        }
        regions.push({ name, left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height });
        if (box.x < -1 || box.y < -1 || box.x + box.width > viewport.width + 1 || box.y + box.height > viewport.height + 1) {
          failures.push(`${viewport.name}/${scenario}: ${name} escapes the ${viewport.width}×${viewport.height} viewport`);
        }
      }
      for (let left = 0; left < regions.length; left += 1) {
        for (let right = left + 1; right < regions.length; right += 1) {
          const hit = overlap(regions[left], regions[right]);
          if (hit) failures.push(`${viewport.name}/${scenario}: ${regions[left].name} overlaps ${regions[right].name} by ${hit.width.toFixed(1)}×${hit.height.toFixed(1)}px`);
        }
      }
      if (scenario === "active") activeRegionPositions.set(viewport.name, regions);
      if (scenario === "win" || scenario === "draw") {
        const baseline = activeRegionPositions.get(viewport.name) ?? [];
        for (const region of regions) {
          const before = baseline.find((candidate) => candidate.name === region.name);
          if (before && (Math.abs(before.left - region.left) > 0.5 || Math.abs(before.top - region.top) > 0.5)) {
            failures.push(`${viewport.name}/${scenario}: ${region.name} shifts when showdown begins`);
          }
        }
      }
      const consoleBox = await page.locator(".essential-console").boundingBox();
      const messageBox = await page.locator(".essential-message").boundingBox();
      const actionTrayBox = await page.locator(".essential-actions").boundingBox();
      if (actionTrayBox) {
        const expectedHeight = actionTrayHeights.get(viewport.name);
        if (expectedHeight === undefined) actionTrayHeights.set(viewport.name, actionTrayBox.height);
        else if (Math.abs(actionTrayBox.height - expectedHeight) > 0.5) {
          failures.push(`${viewport.name}/${scenario}: action tray height changed from ${expectedHeight.toFixed(1)}px to ${actionTrayBox.height.toFixed(1)}px`);
        }
      }
      if (scenario === "side-panels") {
        const feedBox = await page.locator(".essential-actions-feed").boundingBox();
        const guideBox = await page.locator(".essential-guide").boundingBox();
        if (consoleBox && feedBox && guideBox && [feedBox, guideBox].some((box) =>
          Math.abs(box.width - consoleBox.width) > 0.5 || Math.abs(box.height - consoleBox.height) > 0.5
        )) {
          failures.push(`${viewport.name}/${scenario}: Guide and Actions Feed do not match the information-console size`);
        }
      }
      if (consoleBox && messageBox && (
        messageBox.x < consoleBox.x - 1 ||
        messageBox.y < consoleBox.y - 1 ||
        messageBox.x + messageBox.width > consoleBox.x + consoleBox.width + 1 ||
        messageBox.y + messageBox.height > consoleBox.y + consoleBox.height + 1
      )) {
        failures.push(`${viewport.name}/${scenario}: console message escapes the information-console boundary`);
      }
      if (scenario === "active" || scenario === "maximum-actions") {
        const buttonLocators = await page.locator(".essential-action-option > button").all();
        const buttonBoxes = (await Promise.all(buttonLocators.map((locator) => locator.boundingBox()))).filter(Boolean);
        if (buttonBoxes.length > 1) {
          const top = buttonBoxes[0].y;
          if (buttonBoxes.some((box) => Math.abs(box.y - top) > 1)) {
            failures.push(`${viewport.name}/${scenario}: claim buttons do not share one top alignment`);
          }
        }
        const passButton = await page.locator(".essential-action-option--pass > button").boundingBox();
        const claimButton = await page.locator(".essential-action-option:not(.essential-action-option--pass) > button").first().boundingBox();
        if (passButton && claimButton && Math.abs(passButton.width - claimButton.width) > 0.5) {
          failures.push(`${viewport.name}/${scenario}: Pass does not match the claim-button width`);
        }
        const previewLocators = await page.locator(".essential-action-option:has(.essential-action-preview)").all();
        for (const option of previewLocators) {
          const buttonBox = await option.locator("button").boundingBox();
          const previewBox = await option.locator(".essential-action-preview").boundingBox();
          if (buttonBox && previewBox && previewBox.y < buttonBox.y + buttonBox.height - 1) {
            failures.push(`${viewport.name}/${scenario}: claim preview is not below its button`);
          }
        }
        const previewTileLocator = page.locator(".essential-action-preview .tile-sm").first();
        const previewTile = await previewTileLocator.count() > 0 ? await previewTileLocator.boundingBox() : null;
        const publicTile = await page.locator(".essential-discards .tile-sm").first().boundingBox();
        if (previewTile && publicTile && (
          Math.abs(previewTile.width - publicTile.width) > 0.5 ||
          Math.abs(previewTile.height - publicTile.height) > 0.5
        )) {
          failures.push(`${viewport.name}/${scenario}: claim preview tiles do not match other public tiles`);
        }
      }
      if (scenario === "active") {
        const playerBefore = await page.locator(".essential-player").boundingBox();
        const selectedButton = page.locator(".essential-hand button").first();
        await selectedButton.click();
        const playerAfter = await page.locator(".essential-player").boundingBox();
        const selectedBox = await selectedButton.boundingBox();
        if (playerBefore && playerAfter && Math.abs(playerBefore.y - playerAfter.y) > 0.5) {
          failures.push(`${viewport.name}/${scenario}: selecting a tile shifts the local-player component`);
        }
        if (playerAfter && selectedBox && selectedBox.y < playerAfter.y - 1) {
          failures.push(`${viewport.name}/${scenario}: selected tile lift is clipped outside the local-player component`);
        }
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) throw new Error(`Responsive layout overlap regression:\n${failures.join("\n")}`);
console.log(`Essential layout has no unintended peer overlap across ${viewports.length} responsive viewports and ${scenarios.length} temporary states.`);
