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
const STALL_ARTIFACT_DIR = process.env.MAHJONG_E2E_ARTIFACT_DIR ?? "tmp";
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
  // The table polls frequently, so React can replace an otherwise-actionable
  // button between the visibility check and the click. Treat that transient
  // detach exactly like "no action available yet" and retry on the next loop.
  return locator
    .click({ timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
}

async function signInAndQueue(page) {
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Continue as Guest" }).click();
  await page.getByText("Lobby connected", { exact: true }).waitFor({ timeout: FLOW_TIMEOUT_MS });
  const balance = page.getByTestId("jade-balance").locator("strong");
  await balance.waitFor({ timeout: FLOW_TIMEOUT_MS });
  const startingBalance = Number((await balance.textContent()).replaceAll(",", ""));
  if (!Number.isSafeInteger(startingBalance) || startingBalance < 1_000) {
    throw new Error(`Player received an invalid Bamboo starting balance: ${startingBalance}.`);
  }
  const findTable = page.getByRole("button", { name: "Find a table" });
  await findTable.waitFor({ timeout: FLOW_TIMEOUT_MS });
  await findTable.click();
  await page.getByText("Searching for players", { exact: true }).waitFor({
    timeout: FLOW_TIMEOUT_MS,
  });
  return startingBalance;
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

  // A transient poll failure must keep the last authoritative table visible.
  // The client now exposes a short reconnecting notice while its normal poll
  // loop retries, instead of tearing down and rebuilding the entire match UI.
  await page.getByTestId("table-stalled-notice").waitFor({
    state: "visible",
    timeout: FLOW_TIMEOUT_MS,
  });
  const match = page.getByTestId("live-match");
  if (!(await match.isVisible())) {
    throw new Error("A transient runtime sync failure removed the live table.");
  }
  await page.getByTestId("table-stalled-notice").waitFor({
    state: "hidden",
    timeout: FLOW_TIMEOUT_MS,
  });
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

  const selectedDiscardTile = page
    .locator('.local-hand-tile-button[aria-label*="Activate again to discard"]')
    .first();
  if (await clickIfEnabled(selectedDiscardTile)) {
    return "discard";
  }

  // Hand tiles remain inspectable while another seat acts. Only the explicit
  // two-activation copy identifies a tile that is currently legal to discard.
  const inspectableDiscardTile = page
    .locator('.local-hand-tile-button[aria-label*="Activate twice to discard"]')
    .first();
  if (await clickIfEnabled(inspectableDiscardTile)) {
    // The production hand uses a non-modal select/play convention: the first
    // activation inspects and highlights matching public tiles; the second
    // activation commits the discard.
    const committed = await clickIfEnabled(
      page
        .locator('.local-hand-tile-button[aria-label*="Activate again to discard"]')
        .first(),
    );
    return committed ? "discard" : "inspect";
  }

  return null;
}

// Per-page diagnostics. A stalled hand used to report only that the table was
// gone, which is the symptom and never the cause; these buffers are what the
// failure message below reads from.
const pageDiagnostics = new Map();

function instrumentPage(page, playerNumber) {
  const diagnostics = { errors: [], failedRequests: [], consoleErrors: [] };
  pageDiagnostics.set(page, diagnostics);

  page.on("pageerror", (error) => {
    diagnostics.errors.push(String(error?.stack ?? error?.message ?? error).slice(0, 600));
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      diagnostics.consoleErrors.push(message.text().slice(0, 400));
    }
  });
  page.on("requestfailed", (request) => {
    diagnostics.failedRequests.push(
      `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "failed"}`.slice(0, 400),
    );
  });
  page.on("response", (response) => {
    if (response.status() < 400) {
      return;
    }
    const line = `${response.status()} ${response.request().method()} ${response.url()}`;
    // The status alone doesn't say why the runtime rejected the call; the
    // gRPC-gateway puts the real reason in the body.
    response
      .text()
      .then((body) => {
        diagnostics.failedRequests.push(`${line} :: ${body.replace(/\s+/g, " ").trim().slice(0, 300)}`.slice(0, 700));
      })
      .catch(() => {
        diagnostics.failedRequests.push(line.slice(0, 400));
      });
  });
  return page;
}

// Keep only the tail of each buffer: a stalled run can repeat the same polling
// failure hundreds of times, and the last few are the informative ones.
function summarizeDiagnostics(page) {
  const diagnostics = pageDiagnostics.get(page);
  if (!diagnostics) {
    return {};
  }
  const tail = (entries, keep) => {
    const unique = [...new Set(entries)];
    return { total: entries.length, distinct: unique.length, recent: unique.slice(-keep) };
  };
  return {
    pageErrors: tail(diagnostics.errors, 3),
    consoleErrors: tail(diagnostics.consoleErrors, 5),
    failedRequests: tail(diagnostics.failedRequests, 5),
  };
}

async function driveHandToResult() {
  const deadline = Date.now() + HAND_TIMEOUT_MS;
  let actionCount = 0;
  const actionsByType = {};

  while (Date.now() < deadline) {
    const resultCount = (
      await Promise.all(
        pages.map((page) => isVisible(page.getByRole("region", { name: "Hand result" }))),
      )
    ).filter(Boolean).length;
    if (resultCount === PLAYER_COUNT) {
      return { total: actionCount, byType: actionsByType };
    }

    let acted = false;
    for (const page of pages) {
      const action = await driveOneLegalAction(page);
      if (action && action !== "result") {
        if (action !== "inspect") {
          actionCount += 1;
          actionsByType[action] = (actionsByType[action] ?? 0) + 1;
          if (actionCount % 25 === 0) {
            report("hand-progress", { legalActions: actionCount, actionsByType });
          }
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
      url: page.url(),
      tableVisible: await isVisible(page.getByTestId("live-match")),
      resultVisible: await isVisible(page.getByRole("region", { name: "Hand result" })),
      actionText: await page.locator(".action-bar").textContent().catch(() => null),
      enabledActions: await page
        .locator(".action-bar button:enabled")
        .allTextContents()
        .catch(() => []),
      // When the table is gone, whatever replaced it is the actual evidence.
      visibleText: await page
        .locator("body")
        .innerText()
        .then((text) => text.replace(/\s+/g, " ").trim().slice(0, 500))
        .catch(() => null),
      ...summarizeDiagnostics(page),
    })),
  );

  for (const [index, page] of pages.entries()) {
    await page
      .screenshot({ path: `${STALL_ARTIFACT_DIR}/stalled-player-${index + 1}.png`, fullPage: true })
      .catch(() => undefined);
  }

  throw new Error(
    `The hand did not reach a result within ${HAND_TIMEOUT_MS}ms after ${actionCount} legal actions.\n` +
      `Screenshots: ${STALL_ARTIFACT_DIR}/stalled-player-*.png\n` +
      `${JSON.stringify(tableStates, null, 2)}`,
  );
}

async function readJadeSettlement(page, playerNumber) {
  const panel = page.getByTestId("jade-settlement");
  await panel.waitFor({ state: "visible", timeout: FLOW_TIMEOUT_MS });
  await page
    .getByTestId("jade-settlement")
    .filter({ has: page.getByText("AGS Wallet synced", { exact: true }) })
    .waitFor({ state: "visible", timeout: FLOW_TIMEOUT_MS });
  const delta = Number(await panel.getAttribute("data-jade-delta"));
  const before = Number(await panel.getAttribute("data-jade-before"));
  const after = Number(await panel.getAttribute("data-jade-after"));
  const journalId = await panel.getAttribute("data-journal-id");
  const walletSyncStatus = await panel.getAttribute("data-wallet-sync-status");
  if (
    !Number.isSafeInteger(delta) ||
    !Number.isSafeInteger(before) ||
    !Number.isSafeInteger(after) ||
    !journalId ||
    walletSyncStatus !== "synced"
  ) {
    throw new Error(`Player ${playerNumber} received an invalid Jade settlement.`);
  }
  if (before + delta !== after) {
    throw new Error(
      `Player ${playerNumber} settlement does not add up: ${before} + ${delta} != ${after}.`,
    );
  }
  return { player: playerNumber, delta, before, after, journalId, walletSyncStatus };
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
    const page = await context.newPage();
    instrumentPage(page, index + 1);
    pages.push(page);
  }

  const startingBalances = await Promise.all(pages.map(signInAndQueue));
  report("queued", {
    players: PLAYER_COUNT,
    startingBalanceTotal: startingBalances.reduce((total, balance) => total + balance, 0),
  });
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
  const handActions = await driveHandToResult();
  const actionCount = handActions.total;
  const jadeSettlements = await Promise.all(
    pages.map((page, index) => readJadeSettlement(page, index + 1)),
  );
  const journalIds = new Set(jadeSettlements.map((settlement) => settlement.journalId));
  const totalDelta = jadeSettlements.reduce((total, settlement) => total + settlement.delta, 0);
  const totalBefore = jadeSettlements.reduce((total, settlement) => total + settlement.before, 0);
  const totalAfter = jadeSettlements.reduce((total, settlement) => total + settlement.after, 0);
  if (journalIds.size !== 1 || totalDelta !== 0 || totalBefore !== totalAfter) {
    throw new Error(`Jade settlement failed conservation: ${JSON.stringify(jadeSettlements)}.`);
  }
  for (let index = 0; index < PLAYER_COUNT; index += 1) {
    if (jadeSettlements[index].before !== startingBalances[index]) {
      throw new Error(
        `Player ${index + 1} starting balance changed before settlement: ` +
          `${startingBalances[index]} != ${jadeSettlements[index].before}.`,
      );
    }
  }
  report("hand-complete", {
    legalActions: actionCount,
    actionsByType: handActions.byType,
    jadeDelta: totalDelta,
    jadeTotal: totalAfter,
    settlementJournal: [...journalIds][0],
  });

  const returnedBalances = await Promise.all(
    pages.map(async (page, index) => {
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
      const balance = Number(
        ((await page.getByTestId("jade-balance").locator("strong").textContent()) ?? "").replaceAll(
          ",",
          "",
        ),
      );
      if (balance !== jadeSettlements[index].after) {
        throw new Error(
          `Player ${index + 1} lobby balance ${balance} does not match settled balance ` +
            `${jadeSettlements[index].after}.`,
        );
      }
      return balance;
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
        actionsByType: handActions.byType,
        jade: {
          totalBefore,
          totalAfter,
          totalDelta,
          journalId: [...journalIds][0],
          walletSyncStatuses: jadeSettlements.map((settlement) => settlement.walletSyncStatus),
          returnedBalances,
        },
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
