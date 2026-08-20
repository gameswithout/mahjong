import { chromium } from "playwright";
import { createServer } from "vite";
import { existsSync } from "node:fs";

const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet-landscape", width: 1366, height: 768 },
  { name: "mobile-landscape", width: 932, height: 430 },
];
const scenarios = ["review", "stalled"];
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

try {
  for (const viewport of viewports) {
    for (const scenario of scenarios) {
      const page = await browser.newPage({ viewport });
      await page.goto(`${base}essential-layout.html?scenario=${scenario}`, { waitUntil: "networkidle" });
      const regions = [];
      for (const [name, selector] of selectors) {
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
      }
      for (let left = 0; left < regions.length; left += 1) {
        for (let right = left + 1; right < regions.length; right += 1) {
          const hit = overlap(regions[left], regions[right]);
          if (hit) failures.push(`${viewport.name}/${scenario}: ${regions[left].name} overlaps ${regions[right].name} by ${hit.width.toFixed(1)}×${hit.height.toFixed(1)}px`);
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
