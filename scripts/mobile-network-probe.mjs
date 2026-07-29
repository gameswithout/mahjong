// Exercises the mobile-network behaviour against a real match, on a link that
// behaves like a phone's.
//
// Everything it checks was previously argued from the code and unit-tested
// against fakes: the poll loop's in-flight guard and backoff, the table
// surviving a blackout, the online-event resync, conditional GET, and gzip.
// This drives a live Practice hand through Chrome's own network emulation and
// reports what actually happened on the wire.
//
// Usage:
//   npm run dev -- --port 5199        (in one terminal)
//   node scripts/mobile-network-probe.mjs [devServerURL]
//
// Practice vs Bots is the vehicle deliberately: it needs no other players but
// still runs against the deployed match service, so the polls, the ETags and
// the compression are all real.
//
// DO NOT DEPLOY THE CORS CHANGE ON THIS BRANCH ON ITS OWN. Exposing ETag makes
// the client start sending If-None-Match, and against the live service every
// such poll then died with net::ERR_ABORTED — a stalling table, worse than the
// no-op the feature was before. Measured 2026-07-28 and rolled back within
// minutes. Ruled out so far: the fetch cache mode (304 resolves cleanly under
// default/no-store/no-cache/reload), gzip, and a malformed 304 (the live
// response is well-formed over HTTP/2 with gzip negotiated). ERR_ABORTED is
// what this client's own 8s AbortController produces, so the requests appear
// to hang rather than be rejected; confirming that needs one instrumented
// deploy that records time-to-abort. Note also that this probe reads
// response.body() on every response, which throws on a 304 — rule the probe
// itself out before blaming the client.
import { chromium } from "playwright";

const baseUrl = process.argv[2] ?? "http://localhost:5199";

// A middling cellular link: enough to play on, slow enough that a round trip
// can outlast the 4s poll interval, which is the condition the in-flight guard
// exists for.
const SLOW_CELLULAR = {
  offline: false,
  downloadThroughput: (600 * 1024) / 8,
  uploadThroughput: (300 * 1024) / 8,
  latency: 400,
};
const FULL_SPEED = { offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0 };
const OFFLINE = { offline: true, downloadThroughput: 0, uploadThroughput: 0, latency: 0 };

// Shorter than the 60s stall grace, so a table that ejects here is ejecting
// early rather than as designed.
const BLACKOUT_MS = Number(process.env.PROBE_BLACKOUT_MS ?? 45_000);
const OBSERVE_MS = Number(process.env.PROBE_OBSERVE_MS ?? 30_000);

const calls = [];
const consoleErrors = [];
const loadingFailures = [];
let phase = "startup";

function classify(url, method) {
  if (!url.includes("/matches/")) return null;
  if (url.endsWith("/join")) return "join";
  if (url.endsWith("/commands")) return "command";

  return method === "GET" ? "poll" : null;
}

async function run() {
  // PROBE_DISABLE_CORS lets the client read the ETag and send If-None-Match
  // without the service permitting it, so conditional GET can be exercised
  // against the real deployment without shipping a CORS change to find out
  // whether it works.
  const browser = await chromium.launch(
    process.env.PROBE_DISABLE_CORS
      ? { args: ["--disable-web-security", "--disable-site-isolation-trials"] }
      : {},
  );
  const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");

  // Playwright reports a bare "net::ERR_ABORTED"; CDP says whether the browser
  // cancelled it, blocked it, or saw a response first — and what that response
  // was. That is the difference between guessing and knowing.
  const cdpByUrl = new Map();
  cdp.on("Network.responseReceived", (e) => {
    if (!e.response?.url?.includes("/matches/")) return;
    cdpByUrl.set(e.requestId, { status: e.response.status, headers: e.response.headers });
  });
  cdp.on("Network.loadingFailed", (e) => {
    const seen = cdpByUrl.get(e.requestId);
    loadingFailures.push({
      errorText: e.errorText,
      canceled: e.canceled ?? false,
      blockedReason: e.blockedReason ?? "",
      corsError: e.corsErrorStatus?.corsError ?? "",
      responseSeen: seen ? seen.status : "none",
      responseHeaders: seen ? seen.headers : null,
    });
  });

  const inFlight = new Map();
  let maxConcurrentPolls = 0;

  page.on("request", (request) => {
    const kind = classify(request.url(), request.method());
    if (!kind) return;
    const record = {
      kind,
      phase,
      startedAt: Date.now(),
      status: null,
      ms: null,
      bytes: null,
      encoding: "",
      etag: "",
      // Whether the client offered a tag, and what version came back — the two
      // facts that separate "conditional GET is broken" from "the state
      // genuinely moved between polls".
      sentIfNoneMatch: Boolean(request.headers()["if-none-match"]),
      stateVersion: null,
    };
    inFlight.set(request, record);
    calls.push(record);
    if (kind === "poll") {
      const open = [...inFlight.values()].filter((r) => r.kind === "poll" && r.status === null).length;
      maxConcurrentPolls = Math.max(maxConcurrentPolls, open);
    }
  });

  page.on("response", async (response) => {
    const record = inFlight.get(response.request());
    if (!record) return;
    record.status = response.status();
    record.ms = Date.now() - record.startedAt;
    const headers = response.headers();
    record.encoding = headers["content-encoding"] ?? "";
    record.etag = headers.etag ?? "";
    if (record.status === 204) {
      record.bytes = 0;
      return;
    }
    try {
      const body = await response.body();
      record.bytes = body.length;
      if (record.kind === "poll" && record.status === 200) {
        record.stateVersion = JSON.parse(body.toString()).state?.state_version ?? null;
      }
    } catch {
      record.bytes = 0; // a bodiless reply has nothing to read
    }
  });
  page.on("requestfailed", (request) => {
    const record = inFlight.get(request);
    if (!record) return;
    // A response that already arrived is a poll that succeeded. Chrome also
    // records a cancellation when a bodiless response is dropped without its
    // (empty) body being read, and treating that as a failure is how this
    // probe once reported a working client as broken.
    if (record.status !== null) {
      record.cancelledAfterResponse = true;
      return;
    }
    record.status = "failed";
    record.ms = Date.now() - record.startedAt;
    record.error = request.failure()?.errorText ?? "";
  });
  // A CORS rejection never reaches requestfailed with a useful reason; the
  // browser reports it to the console instead.
  page.on("console", (message) => {
    const text = message.text();
    if (/CORS|Access-Control|blocked by/i.test(text)) consoleErrors.push(text.slice(0, 300));
  });

  const log = (message) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);

  async function click(label) {
    const target = page.getByRole("button", { name: label, exact: false }).first();
    await target.waitFor({ state: "visible", timeout: 60_000 });
    await target.click();
  }

  const tableVisible = () => page.locator('[data-testid="live-match"]').isVisible().catch(() => false);
  const stalledVisible = () =>
    page.locator('[data-testid="table-stalled-notice"]').isVisible().catch(() => false);

  log("opening client");
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  phase = "signin";
  log("signing in as guest");
  await click("Continue as Guest");
  await click("Practice vs Bots");
  await page.locator('[data-testid="live-match"]').waitFor({ state: "visible", timeout: 90_000 });
  log("live table reached");

  const observations = {};

  phase = "baseline";
  log(`baseline (full speed) for ${OBSERVE_MS / 1000}s`);
  await page.waitForTimeout(OBSERVE_MS);

  phase = "throttled";
  log("applying slow-cellular profile");
  await cdp.send("Network.emulateNetworkConditions", SLOW_CELLULAR);
  await page.waitForTimeout(OBSERVE_MS);
  observations.tableAliveThrottled = await tableVisible();

  phase = "blackout";
  log(`going offline for ${BLACKOUT_MS / 1000}s (stall grace is 60s, so the table must survive)`);
  await cdp.send("Network.emulateNetworkConditions", OFFLINE);
  const blackoutStart = Date.now();
  await page.waitForTimeout(BLACKOUT_MS / 2);
  observations.stalledNoticeShown = await stalledVisible();
  observations.tableAliveMidBlackout = await tableVisible();
  await page.waitForTimeout(BLACKOUT_MS / 2);
  observations.tableAliveEndBlackout = await tableVisible();
  observations.blackoutHeldMs = Date.now() - blackoutStart;

  phase = "recovery";
  log("restoring the link");
  const restoredAt = Date.now();
  await cdp.send("Network.emulateNetworkConditions", SLOW_CELLULAR);
  // The online-event listener should resync immediately rather than waiting
  // out the backoff the blackout built up.
  let recoveredAt = null;
  for (let i = 0; i < 120 && recoveredAt === null; i += 1) {
    if (calls.some((c) => c.kind === "poll" && c.phase === "recovery" && c.status === 200)) {
      recoveredAt = Date.now();
      break;
    }
    if (calls.some((c) => c.kind === "poll" && c.phase === "recovery" && c.status === 204)) {
      recoveredAt = Date.now();
      break;
    }
    await page.waitForTimeout(250);
  }
  observations.recoveryMs = recoveredAt ? recoveredAt - restoredAt : null;
  await page.waitForTimeout(8_000);
  observations.stalledNoticeCleared = !(await stalledVisible());
  observations.tableAliveAfterRecovery = await tableVisible();

  phase = "settled";
  await cdp.send("Network.emulateNetworkConditions", FULL_SPEED);
  await page.waitForTimeout(6_000);

  observations.maxConcurrentPolls = maxConcurrentPolls;
  await browser.close();
  return observations;
}

function gaps(records) {
  const starts = records.map((r) => r.startedAt).sort((a, b) => a - b);
  return starts.slice(1).map((t, i) => t - starts[i]);
}

function summarise(observations) {
  const polls = calls.filter((c) => c.kind === "poll");
  const byPhase = {};
  for (const call of polls) {
    (byPhase[call.phase] ??= []).push(call);
  }

  console.log("\n=== poll behaviour by phase ===");
  console.log("phase        polls  200   304  failed   median gap   max gap");
  for (const [name, records] of Object.entries(byPhase)) {
    const g = gaps(records).sort((a, b) => a - b);
    const median = g.length ? g[Math.floor(g.length / 2)] : 0;
    const max = g.length ? g[g.length - 1] : 0;
    console.log(
      `${name.padEnd(12)} ${String(records.length).padStart(5)}` +
        `${String(records.filter((r) => r.status === 200).length).padStart(5)}` +
        `${String(records.filter((r) => r.status === 204).length).padStart(6)}` +
        `${String(records.filter((r) => r.status === "failed").length).padStart(8)}` +
        `${(median / 1000).toFixed(1).padStart(12)}s${(max / 1000).toFixed(1).padStart(10)}s`,
    );
  }

  const answered = polls.filter((p) => p.status === 200 || p.status === 204);
  const notModified = polls.filter((p) => p.status === 204);
  const gzipped = polls.filter((p) => p.status === 200 && p.encoding.includes("gzip"));
  const withEtag = polls.filter((p) => p.etag);
  const bodyBytes = polls.filter((p) => p.status === 200).reduce((sum, p) => sum + (p.bytes ?? 0), 0);

  console.log("\n=== wire ===");
  console.log(`answered polls          ${answered.length}`);
  console.log(`  204 unchanged         ${notModified.length}  (${((100 * notModified.length) / (answered.length || 1)).toFixed(0)}% of answered)`);
  console.log(`  200 with gzip         ${gzipped.length} of ${polls.filter((p) => p.status === 200).length}`);
  console.log(`  carrying an ETag      ${withEtag.length}`);
  console.log(`total 200 body bytes    ${bodyBytes}`);
  console.log(
    `bytes saved by 204      ~${notModified.length * Math.round(bodyBytes / Math.max(1, polls.filter((p) => p.status === 200).length))} (est. at mean body size)`,
  );

  // A 304 can only happen when nothing moved. If the version advances between
  // every pair of polls, a 0% hit rate is the correct answer rather than a
  // broken feature — so report the two apart.
  const offered = polls.filter((p) => p.sentIfNoneMatch);
  const versions = polls.filter((p) => p.stateVersion !== null).map((p) => p.stateVersion);
  let repeats = 0;
  for (let i = 1; i < versions.length; i += 1) {
    if (versions[i] === versions[i - 1]) repeats += 1;
  }
  console.log("\n=== why the unchanged rate is what it is ===");
  console.log(`polls that offered If-None-Match   ${offered.length} of ${polls.length}`);
  console.log(`distinct state versions seen       ${new Set(versions).size} across ${versions.length} bodies`);
  console.log(`consecutive polls at same version  ${repeats}  <- the only ones an unchanged reply was ever available for`);
  console.log(`versions: ${versions.join(" ")}`);

  const failedPolls = polls.filter((p) => p.status === "failed");
  if (failedPolls.length) {
    const reasons = {};
    for (const f of failedPolls) reasons[f.error || "(no error text)"] = (reasons[f.error || "(no error text)"] ?? 0) + 1;
    console.log("\n=== failed polls ===");
    for (const [reason, count] of Object.entries(reasons)) console.log(`  ${count} x ${reason}`);
    // Time-to-abort separates "the request was rejected" from "the request
    // hung and this client's own 8s timeout killed it".
    const aborted = failedPolls.filter((f) => (f.error ?? "").includes("ABORTED")).map((f) => f.ms);
    if (aborted.length) {
      console.log(`  aborted after (ms): ${aborted.join(", ")}`);
    }
  }
  if (loadingFailures.length) {
    console.log("\n=== CDP view of the failures ===");
    const shape = {};
    for (const f of loadingFailures) {
      const key = `${f.errorText} canceled=${f.canceled} blocked=${f.blockedReason || "-"} cors=${f.corsError || "-"} responseSeen=${f.responseSeen}`;
      shape[key] = (shape[key] ?? 0) + 1;
    }
    for (const [key, count] of Object.entries(shape)) console.log(`  ${count} x ${key}`);
    const withHeaders = loadingFailures.find((f) => f.responseHeaders);
    if (withHeaders) {
      console.log("  response headers on a failed poll:");
      for (const [k, v] of Object.entries(withHeaders.responseHeaders)) console.log(`    ${k}: ${v}`);
    }
  }
  if (consoleErrors.length) {
    console.log("\n=== browser console (CORS) ===");
    for (const line of [...new Set(consoleErrors)].slice(0, 4)) console.log(`  ${line}`);
  }

  console.log("\n=== behaviour ===");
  const checks = [
    ["in-flight guard held (max 1 concurrent poll)", observations.maxConcurrentPolls <= 1, `max=${observations.maxConcurrentPolls}`],
    ["table survived the throttled phase", observations.tableAliveThrottled === true, ""],
    ["stalled notice shown during blackout", observations.stalledNoticeShown === true, ""],
    ["table survived mid-blackout", observations.tableAliveMidBlackout === true, ""],
    ["table survived the full 45s blackout", observations.tableAliveEndBlackout === true, `${(observations.blackoutHeldMs / 1000).toFixed(0)}s`],
    ["resynced within 3s of the link returning", observations.recoveryMs !== null && observations.recoveryMs < 3_000, `${observations.recoveryMs}ms`],
    ["stalled notice cleared after recovery", observations.stalledNoticeCleared === true, ""],
    ["table alive after recovery", observations.tableAliveAfterRecovery === true, ""],
  ];
  let failed = 0;
  for (const [label, ok, detail] of checks) {
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  }

  const blackoutGaps = gaps(byPhase.blackout ?? []);
  if (blackoutGaps.length) {
    console.log(`\nblackout retry gaps (s): ${blackoutGaps.map((g) => (g / 1000).toFixed(1)).join(", ")}`);
  }
  return failed;
}

const observations = await run();
const failures = summarise(observations);
process.exit(failures === 0 ? 0 : 1);
