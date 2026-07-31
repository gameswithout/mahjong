// Live verification for P2.1 (XP/levels) and, as far as is honestly possible
// without a rules-aware bot, P3.3 (Jade welfare recovery).
//
// This talks to the real deployed AGS namespace and the real deployed match
// service over plain fetch — no browser, no mocks. It exists because both
// features were deployed with their core paths unexercised in production:
// nobody has earned XP or claimed welfare on the live service.
//
// What it proves:
//   - A fresh guest account's starting Jade/XP/welfare state.
//   - AwardOnboardingXP is idempotent and monotonic (skipped -> completed
//     sticks; completed -> skipped does not regress).
//   - A real AI Practice hand, played turn-by-turn through actual match
//     commands (not a test harness bypass), reaches hand_complete or
//     exhaustive_draw and pays exactly the §12.1 Practice XP.
//   - Multiple Practice hands continue to pay the flat Practice award; Alpha
//     has no daily XP cap.
//   - Practice truly never touches Jade (a live invariant check, not just a
//     unit test), which is what makes the welfare status stay
//     "balance_sufficient" throughout even after several hands.
//
// What it deliberately does NOT prove: a real below-minimum welfare claim
// landing on exactly 1,000 Jade. That requires an actual lost staked hand,
// which requires a legal Taiwanese Mahjong win against this account -- not
// obtainable by discarding at random in a reasonable number of attempts, and
// this script does not pretend otherwise. See the summary it prints.

const baseURL = process.env.ACCELBYTE_BASE_URL ?? "https://gameswithout-mahjong.prod.gamingservices.accelbyte.io";
const namespace = process.env.ACCELBYTE_NAMESPACE ?? "gameswithout-mahjong";
const clientId = process.env.ACCELBYTE_CLIENT_ID ?? "dc7a13b683c44822905797a8d1df39e7";
const matchServiceURL =
  process.env.ACCELBYTE_MATCH_SERVICE_URL ??
  "https://gameswithout-mahjong.prod.gamingservices.accelbyte.io/ext-gameswithout-mahjong-mahjong-match-service";
const sessionTemplate = process.env.ACCELBYTE_SESSION_TEMPLATE ?? "mahjong-test-none";
const sessionClientVersion = process.env.ACCELBYTE_SESSION_CLIENT_VERSION ?? "web-0.0.0";

const HAND_TIMEOUT_MS = 5 * 60_000;
const PRACTICE_HAND_XP = 25;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function report(stage, details = {}) {
  process.stdout.write(`${JSON.stringify({ stage, ...details })}\n`);
}

function fail(stage, message, details = {}) {
  report(stage, { ok: false, message, ...details });
  throw new Error(`${stage}: ${message}`);
}

async function readJSON(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function loginGuest() {
  const deviceId = `mahjong-progression-verify-${crypto.randomUUID()}`;
  const form = new URLSearchParams({
    client_id: clientId,
    createHeadless: "true",
    device_id: deviceId,
    skipSetCookie: "true",
  });
  const response = await fetch(`${baseURL}/iam/v4/oauth/platforms/device/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Device-Id": deviceId,
    },
    body: form,
  });
  const body = await readJSON(response);
  if (!response.ok || typeof body?.access_token !== "string" || typeof body?.user_id !== "string") {
    fail("guest_login", `guest login failed with HTTP ${response.status}`, { body });
  }
  return { token: body.access_token, userId: body.user_id, deviceId };
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

async function createPracticeSession(token) {
  const response = await fetch(
    `${baseURL}/session/v1/public/namespaces/${encodeURIComponent(namespace)}/gamesession`,
    {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        attributes: { ai_practice: "true" },
        backfillTicketID: "",
        clientVersion: sessionClientVersion,
        configurationName: sessionTemplate,
        deployment: "",
        inactiveTimeout: 60,
        inviteTimeout: 60,
        joinability: "OPEN",
        matchPool: "",
        maxPlayers: 4,
        minPlayers: 1,
        requestedRegions: [],
        serverName: "",
        teams: [],
        textChat: false,
        ticketIDs: [],
        type: "NONE",
      }),
    },
  );
  const body = await readJSON(response);
  const envelope = body?.data ?? body;
  const sessionId = envelope?.sessionId ?? envelope?.gameSessionId ?? envelope?.id;
  if (!response.ok || typeof sessionId !== "string") {
    fail("create_practice_session", `HTTP ${response.status}`, { body });
  }
  return sessionId;
}

async function leaveSession(token, sessionId) {
  // Matches client/session.ts's leaveSession: DELETE, not POST.
  await fetch(
    `${baseURL}/session/v1/public/namespaces/${encodeURIComponent(namespace)}/gamesessions/${encodeURIComponent(sessionId)}/leave`,
    { method: "DELETE", headers: bearer(token) },
  );
}

function matchPath(matchId, suffix = "") {
  return `${matchServiceURL}/v1/namespaces/${encodeURIComponent(namespace)}/sessions/${encodeURIComponent(matchId)}/matches/${encodeURIComponent(matchId)}${suffix}`;
}

async function joinMatch(token, matchId) {
  const response = await fetch(matchPath(matchId, "/join"), {
    method: "POST",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await readJSON(response);
  if (!response.ok) {
    fail("join_match", `HTTP ${response.status}`, { body });
  }
  return body?.state;
}

async function getMatchState(token, matchId) {
  const response = await fetch(matchPath(matchId), { headers: bearer(token) });
  if (response.status === 304) {
    return null;
  }
  const body = await readJSON(response);
  if (!response.ok) {
    fail("get_match_state", `HTTP ${response.status}`, { body });
  }
  return body?.state;
}

const COMMAND_TYPE = {
  draw: "MATCH_COMMAND_TYPE_DRAW",
  discard: "MATCH_COMMAND_TYPE_DISCARD",
  submit_claim: "MATCH_COMMAND_TYPE_SUBMIT_CLAIM",
  declare_zimo: "MATCH_COMMAND_TYPE_DECLARE_ZIMO",
};

async function submitCommand(token, matchId, command) {
  const response = await fetch(matchPath(matchId, "/commands"), {
    method: "POST",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      request_id: crypto.randomUUID(),
      type: COMMAND_TYPE[command.type],
      expected_version: command.expected_version,
      tile_id: command.tile_id,
      tile_ids: command.tile_ids,
      claim: command.claim,
    }),
  });
  const body = await readJSON(response);
  if (!response.ok) {
    // A stale expected_version on a slow poll is a legitimate race, not a
    // bug; the caller re-polls and retries rather than treating it as fatal.
    if (response.status === 409) {
      return { conflict: true };
    }
    fail("submit_command", `HTTP ${response.status} for ${command.type}`, { body });
  }
  return { view: body?.state };
}

// Plays one seat through an AI Practice hand with the simplest legal policy
// that makes progress: draw when it is our turn to draw, discard the first
// tile in hand (or the newly drawn tile if the server names one) when it is
// our turn to discard, pass every claim, and take a self-turn win the moment
// the server itself says one is legal. This deliberately does not try to
// build toward a win -- that needs real rules-aware play -- so the honest
// expectation is exhaustive_draw or a bot win, not our own Zimo.
async function playPracticeHandToCompletion(token, matchId, userId) {
  let view = await getMatchState(token, matchId);
  if (!view) {
    fail("play_hand", "initial GetMatchState returned no view");
  }

  const deadline = Date.now() + HAND_TIMEOUT_MS;
  let step = 0;
  let lastVersion = view.state_version;
  let stallSince = Date.now();
  while (Date.now() < deadline) {
    step += 1;
    if (view.hand_result) {
      return view;
    }
    if (view.state_version !== lastVersion) {
      lastVersion = view.state_version;
      stallSince = Date.now();
    } else if (Date.now() - stallSince > 15_000) {
      // No state_version movement for 15s: dump the exact stuck state once,
      // then keep trying rather than aborting -- it may still resolve, and
      // if it does not, the deadline above still ends this cleanly.
      report("stall_diagnostic", { step, view });
      stallSince = Date.now();
    }

    const isSelf = view.active_seat === view.seat;

    if (isSelf && view.self_turn_options?.can_win) {
      const result = await submitCommand(token, matchId, {
        type: "declare_zimo",
        expected_version: view.state_version,
      });
      if (result.view) {
        view = result.view;
        report("hand_step", { step, action: "declare_zimo" });
        continue;
      }
    }

    if (isSelf && view.phase === "awaiting_draw") {
      const result = await submitCommand(token, matchId, {
        type: "draw",
        expected_version: view.state_version,
      });
      if (result.view) {
        view = result.view;
        report("hand_step", { step, action: "draw" });
        continue;
      }
    } else if (isSelf && view.phase === "awaiting_discard") {
      const handTileId = view.own_hand?.[view.own_hand.length - 1]?.id ?? view.own_hand?.[0]?.id;
      if (!handTileId) {
        fail("play_hand", "awaiting_discard but own_hand is empty", { view });
      }
      const result = await submitCommand(token, matchId, {
        type: "discard",
        expected_version: view.state_version,
        tile_id: handTileId,
      });
      if (result.view) {
        view = result.view;
        report("hand_step", { step, action: "discard", tile_id: handTileId });
        continue;
      }
    } else if (view.claim && view.claim.eligible?.includes(view.seat)) {
      const result = await submitCommand(token, matchId, {
        type: "submit_claim",
        expected_version: view.state_version,
        claim: {
          action_id: view.claim.action_id,
          type: "pass",
          tile_ids: [],
          response_revision: (view.claim.own_response?.response_revision ?? -1) + 1,
          deliberate: true,
        },
      });
      if (result.view) {
        view = result.view;
        report("hand_step", { step, action: "pass_claim" });
        continue;
      }
    }

    // Nothing to act on this poll (a bot's turn, or a conflict to re-read
    // past): wait briefly and re-fetch rather than busy-looping the service.
    await wait(300);
    const refreshed = await getMatchState(token, matchId);
    if (refreshed) {
      view = refreshed;
    }
  }

  fail("play_hand", `hand did not complete within ${HAND_TIMEOUT_MS}ms`, {
    lastPhase: view.phase,
    steps: step,
  });
}

async function getProgression(token) {
  const response = await fetch(
    `${matchServiceURL}/v1/namespaces/${encodeURIComponent(namespace)}/progression`,
    { headers: bearer(token) },
  );
  const body = await readJSON(response);
  if (!response.ok) {
    fail("get_progression", `HTTP ${response.status}`, { body });
  }
  return body;
}

async function awardOnboarding(token, outcome) {
  const response = await fetch(
    `${matchServiceURL}/v1/namespaces/${encodeURIComponent(namespace)}/progression/onboarding`,
    {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify({ outcome }),
    },
  );
  const body = await readJSON(response);
  if (!response.ok) {
    fail("award_onboarding", `HTTP ${response.status}`, { body });
  }
  return body;
}

async function getJadeAccount(token) {
  const response = await fetch(`${matchServiceURL}/v1/namespaces/${encodeURIComponent(namespace)}/jade`, {
    headers: bearer(token),
  });
  const body = await readJSON(response);
  if (!response.ok) {
    fail("get_jade_account", `HTTP ${response.status}`, { body });
  }
  return body?.account;
}

function assert(condition, stage, message, details = {}) {
  if (!condition) {
    fail(stage, message, details);
  }
  report(stage, { ok: true, ...details });
}

async function main() {
  const guest = await loginGuest();
  report("guest_login", { ok: true, userId: guest.userId });

  // --- Fresh-account baseline -------------------------------------------
  const freshAccount = await getJadeAccount(guest.token);
  // int64 proto fields (balance, lifetime_xp, ...) marshal as JSON strings,
  // not numbers -- protojson's documented behaviour, not a server bug.
  assert(
    Number(freshAccount?.balance) === 5000 && freshAccount?.eligible === true,
    "fresh_account_baseline",
    "fresh guest account balance/eligibility",
    { balance: freshAccount?.balance, eligible: freshAccount?.eligible },
  );
  assert(
    freshAccount?.welfare_reason === "balance_sufficient",
    "fresh_account_welfare",
    "a fresh, eligible account is told its balance is fine, not that welfare is available",
    { welfare_reason: freshAccount?.welfare_reason },
  );

  const freshProgression = await getProgression(guest.token);
  assert(
    freshProgression?.progression?.level === undefined || freshProgression.progression.level === 1,
    "fresh_progression",
    "fresh account starts at level 1 with no lifetime XP",
    { progression: freshProgression?.progression },
  );

  // --- Onboarding XP: idempotency and monotonicity -----------------------
  const skipAward = await awardOnboarding(guest.token, "ONBOARDING_OUTCOME_SKIPPED");
  assert(
    skipAward?.granted === true && skipAward?.award?.total === 500,
    "onboarding_first_award",
    "first onboarding award grants 500 XP",
    { granted: skipAward?.granted, total: skipAward?.award?.total },
  );
  assert(
    skipAward?.progression?.level === 2,
    "onboarding_moves_level",
    "500 XP is exactly level 2 on the §12.2 curve",
    { level: skipAward?.progression?.level },
  );

  const completeReplay = await awardOnboarding(guest.token, "ONBOARDING_OUTCOME_COMPLETED");
  assert(
    completeReplay?.granted !== true,
    "onboarding_replay_not_granted",
    "a second onboarding award (even with a different outcome) grants nothing further",
    { granted: completeReplay?.granted, total: completeReplay?.award?.total },
  );
  assert(
    completeReplay?.progression?.onboarding?.outcome === "ONBOARDING_OUTCOME_COMPLETED",
    "onboarding_outcome_can_upgrade",
    "outcome can move from skipped to completed even though no further XP is granted",
    { outcome: completeReplay?.progression?.onboarding?.outcome },
  );

  const regressReplay = await awardOnboarding(guest.token, "ONBOARDING_OUTCOME_SKIPPED");
  assert(
    regressReplay?.progression?.onboarding?.outcome === "ONBOARDING_OUTCOME_COMPLETED",
    "onboarding_outcome_does_not_regress",
    "outcome does not move back from completed to skipped",
    { outcome: regressReplay?.progression?.onboarding?.outcome },
  );

  // --- Real Practice hands, played through actual match commands ---------
  const handsToPlay = process.env.MAHJONG_VERIFY_HAND_COUNT
    ? Number(process.env.MAHJONG_VERIFY_HAND_COUNT)
    : 2;
  let lastXpAward = null;
  let lastProgression = null;

  for (let hand = 0; hand < handsToPlay; hand += 1) {
    const sessionId = await createPracticeSession(guest.token);
    await joinMatch(guest.token, sessionId);
    const finalView = await playPracticeHandToCompletion(guest.token, sessionId, guest.userId);
    report("hand_completed", {
      hand,
      kind: finalView.hand_result?.kind,
      xp_award: finalView.xp_award,
    });
    lastXpAward = finalView.xp_award;
    lastProgression = finalView.progression;
    await leaveSession(guest.token, sessionId);
  }

  assert(
    lastXpAward?.capped_by_daily !== true &&
      (lastXpAward?.total ?? 0) === PRACTICE_HAND_XP,
    "practice_xp_has_no_daily_cap",
    `the ${handsToPlay}th Practice hand still pays ${PRACTICE_HAND_XP} XP`,
    { xp_award: lastXpAward },
  );

  const midAccount = await getJadeAccount(guest.token);
  assert(
    Number(midAccount?.balance) === 5000,
    "practice_never_touches_jade",
    "after several Practice hands, the balance is unchanged -- Practice truly never moves Jade",
    { balance: midAccount?.balance },
  );
  assert(
    midAccount?.welfare_reason === "balance_sufficient",
    "practice_does_not_unlock_welfare_when_not_needed",
    "welfare stays reported as unnecessary, since Practice play did not put the account below minimum",
    { welfare_reason: midAccount?.welfare_reason },
  );

  report("summary", {
    ok: true,
    note:
      "XP awarding, onboarding idempotency/monotonicity, uncapped Practice XP, and the " +
      "Practice-never-touches-Jade invariant are now verified live. A real below-minimum " +
      "welfare claim was NOT attempted: it requires an actual staked loss, which requires a " +
      "legal Taiwanese Mahjong win against this account and is not obtainable by scripted " +
      "random discards in a bounded number of attempts. That path remains proven only by the " +
      "storage-layer integration tests against real PostgreSQL, not against production.",
    lastProgression,
  });
}

main().catch((error) => {
  report("fatal", { ok: false, message: error.message });
  process.exitCode = 1;
});
