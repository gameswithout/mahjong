import { cpSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

import { chromium } from "playwright";

const PLAYER_COUNT = 4;
const DEFAULT_BASE_URL = "http://127.0.0.1:4173/mahjong/";
const FLOW_TIMEOUT_MS = Number(process.env.MAHJONG_E2E_FLOW_TIMEOUT_MS ?? 180_000);
const HAND_TIMEOUT_MS = Number(process.env.MAHJONG_E2E_HAND_TIMEOUT_MS ?? 900_000);
const baseURL = process.env.MAHJONG_E2E_BASE_URL ?? DEFAULT_BASE_URL;
const externalServer = process.env.MAHJONG_E2E_EXTERNAL_SERVER === "1";
const headless = process.env.MAHJONG_E2E_HEADLESS !== "false";

let previewServer;
let browser;
let snapshotRoot;
const contexts = [];
const pages = [];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function report(stage, details = {}) {
  process.stdout.write(`${JSON.stringify({ stage, ...details })}\n`);
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Snapshot server did not become ready at ${url}: ${lastError?.message ?? "timeout"}`);
}

function snapshotBuild() {
  const source = resolve("dist");
  snapshotRoot = mkdtempSync(join(tmpdir(), "mahjong-four-human-"));
  const destination = join(snapshotRoot, "dist");
  cpSync(source, destination, { recursive: true });
  return destination;
}

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

async function startSnapshotServer(outDir) {
  const root = resolve(outDir);
  const target = new URL(baseURL);
  const host = target.hostname;
  const port = Number(target.port || 80);
  const basePath = target.pathname.endsWith("/") ? target.pathname : `${target.pathname}/`;

  previewServer = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", baseURL).pathname);
      const pathWithinBuild = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : "";
      const relativePath = pathWithinBuild || "index.html";
      let filePath = resolve(root, relativePath);
      if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end();
        return;
      }
      try {
        if (statSync(filePath).isDirectory()) {
          filePath = join(filePath, "index.html");
        }
      } catch {
        filePath = join(root, "index.html");
      }
      const body = readFileSync(filePath);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": CONTENT_TYPES.get(extname(filePath)) ?? "application/octet-stream",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404).end();
    }
  });

  await new Promise((resolveReady, reject) => {
    previewServer.once("error", reject);
    previewServer.listen(port, host, resolveReady);
  });
}

async function isVisible(locator) {
  return locator.isVisible().catch(() => false);
}

async function clickIfEnabled(locator) {
  if (!(await isVisible(locator)) || !(await locator.isEnabled().catch(() => false))) {
    return false;
  }
  await locator.click();
  return true;
}

async function signInAndQueue(page) {
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Continue as Guest" }).click();
  await page.getByText("Lobby connected", { exact: true }).waitFor({ timeout: FLOW_TIMEOUT_MS });
  const findTable = page.getByRole("button", { name: "Find a table" });
  await findTable.waitFor({ timeout: FLOW_TIMEOUT_MS });
  await findTable.click();
  await page.getByText("Searching for players", { exact: true }).waitFor({
    timeout: FLOW_TIMEOUT_MS,
  });
}

async function waitForLiveMatch(page) {
  const match = page.getByTestId("live-match");
  await match.waitFor({ state: "visible", timeout: FLOW_TIMEOUT_MS });
  return {
    matchId: await match.getAttribute("data-match-id"),
    seat: await match.getAttribute("data-local-seat"),
  };
}

async function verifyPrivateTable(page, playerNumber) {
  const ownHand = page.locator(".local-hand");
  await ownHand.waitFor({ state: "visible", timeout: FLOW_TIMEOUT_MS });
  const ownTileCount = await ownHand.locator('[role="img"]').count();
  const concealedOpponentTileCount = await page
    .locator(".seat:not(.local-seat) .opponent-hand-backs .tile-back")
    .count();
  if (ownTileCount < 16) {
    throw new Error(`Player ${playerNumber} received only ${ownTileCount} visible own-hand tiles.`);
  }
  if (concealedOpponentTileCount === 0) {
    throw new Error(`Player ${playerNumber} has no concealed opponent-hand placeholders.`);
  }
  if ((await page.getByRole("button", { name: "Join table" }).count()) !== 0) {
    throw new Error(`Player ${playerNumber} still requires a manual Session join.`);
  }
  if ((await page.getByRole("button", { name: "Connect test hand" }).count()) !== 0) {
    throw new Error(`Player ${playerNumber} still exposes the debug runtime handoff.`);
  }
}

async function exerciseReconnect(page, expectedSeat) {
  const runtimePattern = "**/v1/namespaces/*/sessions/*/matches/*";
  let failedSync = false;
  const failOneSync = async (route) => {
    if (!failedSync && route.request().method() === "GET") {
      failedSync = true;
      await route.abort("internetdisconnected");
      return;
    }
    await route.continue();
  };

  await page.route(runtimePattern, failOneSync);
  const deadline = Date.now() + 15_000;
  while (!failedSync && Date.now() < deadline) {
    await delay(100);
  }
  await page.unroute(runtimePattern, failOneSync);
  if (!failedSync) {
    throw new Error("The reconnect probe did not intercept a runtime sync.");
  }

  await page.getByTestId("live-match").waitFor({ state: "hidden", timeout: FLOW_TIMEOUT_MS });
  const match = page.getByTestId("live-match");
  await match.waitFor({ state: "visible", timeout: FLOW_TIMEOUT_MS });
  const restoredSeat = await match.getAttribute("data-local-seat");
  if (restoredSeat !== expectedSeat) {
    throw new Error(`Reconnect changed seat from ${expectedSeat} to ${restoredSeat}.`);
  }
}

async function driveOneLegalAction(page) {
  if (await isVisible(page.getByRole("region", { name: "Hand result" }))) {
    return "result";
  }

  // A submitted claim remains revisable and is labelled with "✓". Do not
  // keep resubmitting that same response; let the other eligible seats answer.
  const win = page.getByRole("button", { name: /^Win(?: · \d+ Tai)?$/ }).first();
  if (await clickIfEnabled(win)) {
    return "win";
  }

  const pass = page.getByRole("button", { name: "Pass", exact: true }).first();
  if (await clickIfEnabled(pass)) {
    return "pass";
  }

  const draw = page.getByRole("button", { name: /^(Draw a tile|Draw now)$/ });
  if (await clickIfEnabled(draw)) {
    return "draw";
  }

  const discardTile = page.locator('.local-hand-tile-button[aria-label^="Discard "]').first();
  if (await clickIfEnabled(discardTile)) {
    return "discard";
  }

  return null;
}

async function driveHandToResult() {
  const deadline = Date.now() + HAND_TIMEOUT_MS;
  let actionCount = 0;

  while (Date.now() < deadline) {
    const resultCount = (
      await Promise.all(
        pages.map((page) => isVisible(page.getByRole("region", { name: "Hand result" }))),
      )
    ).filter(Boolean).length;
    if (resultCount === PLAYER_COUNT) {
      return actionCount;
    }

    let acted = false;
    for (const page of pages) {
      const action = await driveOneLegalAction(page);
      if (action && action !== "result") {
        actionCount += 1;
        if (actionCount % 25 === 0) {
          report("hand-progress", { legalActions: actionCount });
        }
        acted = true;
        break;
      }
    }
    await delay(acted ? 120 : 250);
  }

  const tableStates = await Promise.all(
    pages.map(async (page, index) => ({
      player: index + 1,
      tableVisible: await isVisible(page.getByTestId("live-match")),
      resultVisible: await isVisible(page.getByRole("region", { name: "Hand result" })),
      actionText: await page.locator(".action-bar").textContent().catch(() => null),
      enabledActions: await page
        .locator(".action-bar button:enabled")
        .allTextContents()
        .catch(() => []),
    })),
  );
  throw new Error(
    `The hand did not reach a result within ${HAND_TIMEOUT_MS}ms after ${actionCount} legal actions: ${JSON.stringify(tableStates)}.`,
  );
}

async function cleanupPage(page) {
  try {
    const cancel = page.getByRole("button", { name: "Cancel" });
    if (await isVisible(cancel)) {
      await cancel.click({ timeout: 2_000 });
      return;
    }

    const leaveMatch = page.getByRole("button", { name: "Leave match" });
    if (await isVisible(leaveMatch)) {
      await leaveMatch.click({ timeout: 2_000 });
      return;
    }

    const returnToLobby = page.getByRole("button", { name: "Return to Lobby" });
    if (await isVisible(returnToLobby)) {
      await returnToLobby.click({ timeout: 2_000 });
      return;
    }

    const developerTools = page.getByText("Developer session tools", { exact: true });
    if (await isVisible(developerTools)) {
      await developerTools.click();
      const leaveTable = page.getByRole("button", { name: "Leave table" });
      if (await isVisible(leaveTable)) {
        await leaveTable.click({ timeout: 2_000 });
      }
    }
  } catch {
    // Best-effort cleanup continues for the other isolated players.
  }
}

async function main() {
  if (!externalServer) {
    await startSnapshotServer(snapshotBuild());
  }
  await waitForServer(baseURL);

  browser = await chromium.launch({ headless });
  for (let index = 0; index < PLAYER_COUNT; index += 1) {
    const context = await browser.newContext();
    contexts.push(context);
    pages.push(await context.newPage());
  }

  await Promise.all(pages.map(signInAndQueue));
  report("queued", { players: PLAYER_COUNT });
  const matches = await Promise.all(pages.map(waitForLiveMatch));

  const matchIds = new Set(matches.map((match) => match.matchId));
  const seats = new Set(matches.map((match) => match.seat));
  if (matchIds.size !== 1 || matchIds.has(null)) {
    throw new Error(`Players did not enter one shared match: ${JSON.stringify(matches)}.`);
  }
  if (seats.size !== PLAYER_COUNT || seats.has(null)) {
    throw new Error(`Players did not receive four distinct seats: ${JSON.stringify(matches)}.`);
  }
  report("runtime-joined", { players: PLAYER_COUNT, distinctSeats: seats.size });

  await Promise.all(pages.map((page, index) => verifyPrivateTable(page, index + 1)));
  report("private-views-verified", { players: PLAYER_COUNT });
  await exerciseReconnect(pages[0], matches[0].seat);
  report("reconnect-verified", { seatPreserved: true });
  const actionCount = await driveHandToResult();
  report("hand-complete", { legalActions: actionCount });

  await Promise.all(
    pages.map(async (page) => {
      const leaveResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "DELETE" &&
          response.url().includes("/session/v1/public/namespaces/") &&
          response.url().endsWith("/leave"),
        { timeout: FLOW_TIMEOUT_MS },
      );
      await page.getByRole("button", { name: "Return to Lobby" }).click();
      const response = await leaveResponse;
      if (!response.ok()) {
        throw new Error(`Session leave failed with HTTP ${response.status()}.`);
      }
      await page.getByText("Lobby connected", { exact: true }).waitFor({ timeout: FLOW_TIMEOUT_MS });
      const findTable = page.getByRole("button", { name: "Find a table" });
      await findTable.waitFor({ timeout: FLOW_TIMEOUT_MS });
      const enabledDeadline = Date.now() + FLOW_TIMEOUT_MS;
      while (!(await findTable.isEnabled()) && Date.now() < enabledDeadline) {
        await delay(100);
      }
      if (!(await findTable.isEnabled())) {
        throw new Error("Online play did not become available after leaving the Session.");
      }
    }),
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "passed",
        players: PLAYER_COUNT,
        matchId: [...matchIds][0],
        seats: [...seats].sort(),
        reconnectSeat: matches[0].seat,
        legalActions: actionCount,
        cleanup: "four Session leave responses succeeded; returned to lobby",
      },
      null,
      2,
    )}\n`,
  );
}

try {
  await main();
} catch (error) {
  for (let index = 0; index < pages.length; index += 1) {
    await pages[index]
      .screenshot({ path: `/tmp/mahjong-four-human-player-${index + 1}.png`, fullPage: true })
      .catch(() => {});
  }
  await Promise.all(pages.map(cleanupPage));
  throw error;
} finally {
  await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  await browser?.close().catch(() => {});
  if (previewServer) {
    await new Promise((resolveClosed) => previewServer.close(resolveClosed));
  }
  if (snapshotRoot) {
    rmSync(snapshotRoot, { recursive: true, force: true });
  }
}
