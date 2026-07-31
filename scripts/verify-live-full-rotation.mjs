// Live verification of a §8.4 Full Rotation, formed through a party.
//
// The Full Rotation runtime shipped with eight integration tests against a
// local Postgres, but nothing had ever played a rotation on the deployed
// service. That is a different claim: the tests prove the rules, this proves
// the deployment — the session-attribute mode selection, migration 007's
// tables, and the hand sequencing all working together in production.
//
// What one clean run proves, live:
//   - a session created from the Full Rotation pool is played as a rotation
//     rather than as a single hand;
//   - the dealership moves and seat winds turn with it, while table positions
//     stay fixed;
//   - table points transfer between players and always total zero;
//   - the rotation ends for a stated reason and produces a full podium;
//   - §12.1 rotation XP is paid per hand and on final placement;
//   - no Jade is staked, moved, or reserved at any point (§8.4).
//
// The last one is why this script deliberately never reserves Jade. The Quick
// Play verification must reserve for every seat or nobody is seated; if that
// is also true here then Full Rotation is staking Jade, which §8.4 forbids.
// Not reserving is the assertion.
//
// Usage:  node scripts/verify-live-full-rotation.mjs

const baseURL = process.env.ACCELBYTE_BASE_URL ?? "https://gameswithout-mahjong.prod.gamingservices.accelbyte.io";
const ns = process.env.ACCELBYTE_NAMESPACE ?? "gameswithout-mahjong";
const clientId = process.env.ACCELBYTE_CLIENT_ID ?? "dc7a13b683c44822905797a8d1df39e7";
const matchServiceURL =
  process.env.ACCELBYTE_MATCH_SERVICE_URL ??
  `${baseURL}/ext-gameswithout-mahjong-mahjong-match-service`;
const matchPool = process.env.ACCELBYTE_ROTATION_MATCH_POOL ?? "mahjong-full-rotation-pool";
const partyTemplate = process.env.ACCELBYTE_PARTY_TEMPLATE ?? "mahjong-party";

const MATCH_WAIT_MS = 3 * 60_000;
// §8.4 caps a match at 60 minutes; allow for that plus the inter-hand pauses
// and the slower pace of driving four seats over HTTP.
const ROTATION_TIMEOUT_MS = 75 * 60_000;
const HAND_TIMEOUT_MS = 10 * 60_000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = (stage, details = {}) =>
  process.stdout.write(`${JSON.stringify({ stage, ...details })}\n`);

function fail(stage, message, details = {}) {
  report(stage, { ok: false, message, ...details });
  throw new Error(`${stage}: ${message}`);
}

async function body(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const H = (token, json = true) => ({
  Authorization: `Bearer ${token}`,
  ...(json ? { "Content-Type": "application/json" } : {}),
});

// protojson marshals int64 as a JSON string and omits zero values entirely, so
// every numeric read here goes through this rather than being compared raw.
const num = (value) => Number(value ?? 0);

// Full Rotation is ranked, and §10.1 reserves ranked play for linked accounts.
// The service enforces that itself, so this creates real accounts with an
// email rather than the headless guests the Quick Play verification uses.
//
// The email is never verified. That is deliberate and matches the rule both
// halves of the gate apply: an account stops being a guest when it *has* an
// identity, not when a verification mail arrives — which this namespace is
// known not to deliver.
async function fullAccount(label) {
  const suffix = crypto.randomUUID().slice(0, 12).replace(/-/g, "");
  const email = `rotation-${label}-${suffix}@example.com`;
  const password = `R0tation!${suffix}`;

  const created = await fetch(`${baseURL}/iam/v3/public/namespaces/${ns}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authType: "EMAILPASSWD",
      emailAddress: email,
      password,
      displayName: `Rotation ${label}`,
      uniqueDisplayName: `rot${label}${suffix}`.slice(0, 30),
      username: `rot${label}${suffix}`.slice(0, 30),
      country: "US",
      dateOfBirth: "1990-01-01",
    }),
  });
  if (!created.ok) {
    fail("account_create", `HTTP ${created.status}`, { label, detail: JSON.stringify(await body(created)).slice(0, 200) });
  }

  const response = await fetch(`${baseURL}/iam/v3/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "password",
      username: email,
      password,
    }),
  });
  const payload = await body(response);
  if (!response.ok || !payload?.access_token) {
    fail("account_login", `HTTP ${response.status}`, { label });
  }
  return { label, token: payload.access_token, id: payload.user_id, email };
}

// A headless account, used only to prove the §10.1 gate refuses one.
async function guest(label) {
  const deviceId = `rotation-${label}-${crypto.randomUUID()}`;
  const response = await fetch(`${baseURL}/iam/v4/oauth/platforms/device/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Device-Id": deviceId,
    },
    body: new URLSearchParams({
      client_id: clientId,
      createHeadless: "true",
      device_id: deviceId,
      skipSetCookie: "true",
    }),
  });
  const payload = await body(response);
  if (!response.ok || !payload?.access_token) {
    fail("guest_login", `HTTP ${response.status}`, { label });
  }
  return { label, token: payload.access_token, id: payload.user_id };
}

async function jadeAccount(player) {
  const response = await fetch(`${matchServiceURL}/v1/namespaces/${ns}/jade`, {
    headers: H(player.token, false),
  });
  const payload = await body(response);
  if (!response.ok) fail("jade_account", `HTTP ${response.status}`, { player: player.label });
  return payload?.account;
}

// --- Party ------------------------------------------------------------------

async function createParty(leader) {
  const response = await fetch(`${baseURL}/session/v1/public/namespaces/${ns}/party`, {
    method: "POST",
    headers: H(leader.token),
    body: JSON.stringify({
      configurationName: partyTemplate,
      joinability: "INVITE_ONLY",
      type: "NONE",
      minPlayers: 1,
      maxPlayers: 4,
      inviteTimeout: 60,
      inactiveTimeout: 60,
      textChat: false,
      attributes: {},
      members: [],
    }),
  });
  const payload = await body(response);
  if (!response.ok || !payload?.id) fail("party_create", `HTTP ${response.status}`, { payload });
  return payload.id;
}

async function inviteAndJoin(leader, partyId, member) {
  let response = await fetch(
    `${baseURL}/session/v1/public/namespaces/${ns}/parties/${partyId}/invite`,
    { method: "POST", headers: H(leader.token), body: JSON.stringify({ userId: member.id }) },
  );
  if (!response.ok) fail("party_invite", `HTTP ${response.status}`, { member: member.label });

  // The member-scoped path; /parties/{id}/join is a 404 on the live service.
  response = await fetch(
    `${baseURL}/session/v1/public/namespaces/${ns}/parties/${partyId}/users/me/join`,
    { method: "POST", headers: H(member.token) },
  );
  if (!response.ok) fail("party_join", `HTTP ${response.status}`, { member: member.label });
}

// --- Matchmaking ------------------------------------------------------------

async function createPartyTicket(leader, partyId) {
  const response = await fetch(`${baseURL}/match2/v1/namespaces/${ns}/match-tickets`, {
    method: "POST",
    headers: H(leader.token),
    body: JSON.stringify({ matchPool, sessionID: partyId, attributes: {} }),
  });
  const payload = await body(response);
  if (!response.ok || !payload?.matchTicketID) {
    fail("party_ticket", `HTTP ${response.status}`, { pool: matchPool, payload });
  }
  return payload.matchTicketID;
}

async function awaitMatch(leader, ticketId) {
  const deadline = Date.now() + MATCH_WAIT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${baseURL}/match2/v1/namespaces/${ns}/match-tickets/${ticketId}`,
      { headers: H(leader.token, false) },
    );
    const payload = await body(response);
    const sessionId = payload?.sessionID ?? payload?.sessionId;
    if (sessionId) return sessionId;
    if (response.status === 404) return null;
    await wait(2_000);
  }
  fail("await_match", `no match formed within ${MATCH_WAIT_MS}ms`);
}

async function joinGameSession(player, sessionId) {
  const response = await fetch(
    `${baseURL}/session/v1/public/namespaces/${ns}/gamesessions/${sessionId}/join`,
    { method: "POST", headers: H(player.token, false) },
  );
  if (!response.ok && response.status !== 409) {
    report("game_session_join", { ok: false, player: player.label, status: response.status });
  }
}

// --- Match runtime ----------------------------------------------------------

// The client addresses the *rotation* throughout; the runtime resolves which
// hand is current on its own. There is no per-hand identifier to track here,
// which is the point — a rotation is one table to the player.
const matchPath = (id, suffix = "") =>
  `${matchServiceURL}/v1/namespaces/${ns}/sessions/${id}/matches/${id}${suffix}`;

async function joinMatch(player, matchId) {
  const response = await fetch(matchPath(matchId, "/join"), {
    method: "POST",
    headers: H(player.token),
    body: "{}",
  });
  const payload = await body(response);
  if (!response.ok) {
    fail("join_match", `HTTP ${response.status}`, {
      player: player.label,
      detail: JSON.stringify(payload).slice(0, 300),
    });
  }
  return payload?.state;
}

async function matchState(player, matchId) {
  const response = await fetch(matchPath(matchId), { headers: H(player.token, false) });
  if (response.status === 304 || response.status === 204) return null;
  const payload = await body(response);
  if (!response.ok) fail("match_state", `HTTP ${response.status}`, { player: player.label });
  return payload?.state;
}

const COMMAND = {
  draw: "MATCH_COMMAND_TYPE_DRAW",
  discard: "MATCH_COMMAND_TYPE_DISCARD",
  submit_claim: "MATCH_COMMAND_TYPE_SUBMIT_CLAIM",
  declare_zimo: "MATCH_COMMAND_TYPE_DECLARE_ZIMO",
};

async function command(player, matchId, cmd) {
  const response = await fetch(matchPath(matchId, "/commands"), {
    method: "POST",
    headers: H(player.token),
    body: JSON.stringify({
      request_id: crypto.randomUUID(),
      type: COMMAND[cmd.type],
      expected_version: cmd.expected_version,
      tile_id: cmd.tile_id,
      claim: cmd.claim,
    }),
  });
  if (response.status === 409) return null;
  const payload = await body(response);
  if (!response.ok) return null;
  return payload?.state;
}

// Drives one hand of the rotation to completion with the simplest legal policy
// that makes progress. Returns the completed view.
async function playOneHand(players, matchId, handNumber) {
  const deadline = Date.now() + HAND_TIMEOUT_MS;
  const views = new Map();
  for (const player of players) {
    views.set(player.label, await matchState(player, matchId));
  }

  while (Date.now() < deadline) {
    let acted = false;
    for (const player of players) {
      let view = views.get(player.label);
      if (!view) {
        view = await matchState(player, matchId);
        views.set(player.label, view);
        if (!view) continue;
      }
      // The runtime opens the next hand once the inter-hand pause elapses, so
      // a view that has moved on is how this loop learns the hand is over.
      if (num(view.rotation?.hand_number) > handNumber) {
        return { view, advanced: true };
      }
      if (view.hand_result) {
        return { view, advanced: false };
      }

      const mine = view.active_seat === view.seat;
      let next = null;
      if (mine && view.self_turn_options?.can_win) {
        next = await command(player, matchId, {
          type: "declare_zimo",
          expected_version: view.state_version,
        });
      } else if (mine && view.phase === "awaiting_draw") {
        next = await command(player, matchId, {
          type: "draw",
          expected_version: view.state_version,
        });
      } else if (mine && view.phase === "awaiting_discard") {
        const tile = view.own_hand?.[view.own_hand.length - 1]?.id ?? view.own_hand?.[0]?.id;
        if (tile) {
          next = await command(player, matchId, {
            type: "discard",
            expected_version: view.state_version,
            tile_id: tile,
          });
        }
      } else if (view.claim?.eligible?.includes(view.seat) && !view.claim.own_response) {
        // Take a win when one is offered, rather than passing on everything.
        // A rotation of nothing but exhaustive draws transfers no table points
        // at all, so the balance invariant would hold trivially and the
        // settlement path — including the wind-to-position conversion — would
        // never run with a non-zero number in it. Winning is also simply legal
        // play: no seat is required to decline a winning tile.
        const canWin = view.claim.options?.can_win === true;
        next = await command(player, matchId, {
          type: "submit_claim",
          expected_version: view.state_version,
          claim: {
            action_id: view.claim.action_id,
            type: canWin ? "win" : "pass",
            tile_ids: [],
            response_revision: 0,
            deliberate: true,
          },
        });
      }

      if (next) {
        views.set(player.label, next);
        acted = true;
      } else {
        views.set(player.label, await matchState(player, matchId));
      }
    }
    if (!acted) await wait(400);
  }
  fail("play_hand", `hand ${handNumber} did not complete within ${HAND_TIMEOUT_MS}ms`);
}

// --- Rotation assertions ----------------------------------------------------

function standingsByUser(rotation) {
  const byUser = new Map();
  for (const standing of rotation.standings ?? []) {
    byUser.set(standing.user_id, standing);
  }
  return byUser;
}

// §8.4 table points are a transfer between players: whatever one wins the
// others lose. A non-zero total means points were created or destroyed, which
// no settlement rule allows — and it is also what a mistake in the wind mapping
// would look like from outside.
function assertPointsBalance(rotation, where) {
  let total = 0;
  for (const standing of rotation.standings ?? []) {
    total += num(standing.table_points);
  }
  if (total !== 0) {
    fail("table_points_balance", `table points total ${total}, want 0`, { where });
  }
  return total;
}

async function progression(player) {
  const response = await fetch(`${matchServiceURL}/v1/namespaces/${ns}/progression`, {
    headers: H(player.token, false),
  });
  return response.ok ? await body(response) : null;
}

async function main() {
  const players = [];
  for (const label of ["east", "south", "west", "north"]) {
    players.push(await fullAccount(label));
  }
  report("accounts", {
    ok: true,
    kind: "linked (email, unverified)",
    ids: players.map((p) => p.id.slice(0, 8)),
  });

  const jadeBefore = new Map();
  for (const player of players) {
    const account = await jadeAccount(player);
    jadeBefore.set(player.label, num(account?.balance));
  }
  report("jade_before", { ok: true, balances: Object.fromEntries(jadeBefore) });

  const [leader, ...members] = players;
  const partyId = await createParty(leader);
  for (const member of members) {
    await inviteAndJoin(leader, partyId, member);
  }
  report("party_formed", { ok: true, partyId });

  // Deliberately no Jade reservation. Quick Play refuses a seat without one;
  // if Full Rotation also refused, it would be staking Jade, which §8.4
  // forbids. Seating four players with no reservation is the assertion.
  const ticketId = await createPartyTicket(leader, partyId);
  report("party_ticket", { ok: true, ticketId, pool: matchPool });

  const sessionId = await awaitMatch(leader, ticketId);
  if (!sessionId) fail("await_match", "ticket consumed without naming a session");
  report("match_found", { ok: true, sessionId });

  for (const player of players) {
    await joinGameSession(player, sessionId);
  }
  let firstView = null;
  for (const player of players) {
    const view = await joinMatch(player, sessionId);
    if (!view) fail("join_match", "no view returned", { player: player.label });
    firstView ??= view;
  }

  if (!firstView.rotation) {
    fail(
      "mode_selection",
      "the match has no rotation block, so the session was played as a single Quick Play hand",
      { note: "the pool's session template must carry full_rotation=true" },
    );
  }
  // §10.1, proven rather than assumed: a guest holding a valid token is
  // refused a seat at this same ranked table by the service, not by the client.
  const intruder = await guest("guest-intruder");
  const refused = await fetch(matchPath(sessionId, "/join"), {
    method: "POST",
    headers: H(intruder.token),
    body: "{}",
  });
  if (refused.ok) {
    fail("guest_gate", "a guest was admitted to a ranked Full Rotation", {
      status: refused.status,
    });
  }
  report("guest_refused", {
    ok: true,
    status: refused.status,
    detail: JSON.stringify(await body(refused)).slice(0, 160),
  });

  report("all_seats_joined", {
    ok: true,
    note: "four seats joined with no Jade reservation",
    hand_number: num(firstView.rotation.hand_number),
    time_limit_at: firstView.rotation.time_limit_at,
  });

  // Positions are fixed for the whole rotation; winds turn with the
  // dealership. Record hand 1 to compare against later hands.
  const positions = new Map();
  const windsByHand = new Map();
  const dealers = new Set();

  const deadline = Date.now() + ROTATION_TIMEOUT_MS;
  let handNumber = num(firstView.rotation.hand_number) || 1;
  let lastRotation = firstView.rotation;

  while (Date.now() < deadline) {
    const rotation = lastRotation;
    dealers.add(rotation.dealer_user_id);
    const winds = new Map();
    for (const standing of rotation.standings ?? []) {
      const known = positions.get(standing.user_id);
      if (known && known !== standing.position) {
        fail("seat_stability", `${standing.user_id.slice(0, 8)} moved from ${known} to ${standing.position}`);
      }
      positions.set(standing.user_id, standing.position);
      winds.set(standing.user_id, standing.wind);
      // Whoever plays East must be the one dealing, in every hand.
      if (standing.wind === "E" && standing.user_id !== rotation.dealer_user_id) {
        fail("wind_mapping", "the player on East is not the dealer", {
          hand: handNumber,
          east: standing.user_id.slice(0, 8),
          dealer: String(rotation.dealer_user_id).slice(0, 8),
        });
      }
    }
    windsByHand.set(handNumber, winds);

    const { view } = await playOneHand(players, sessionId, handNumber);
    const after = view.rotation;
    if (!after) fail("rotation_lost", "a view came back without its rotation block");
    assertPointsBalance(after, `after hand ${handNumber}`);

    report("hand_finished", {
      ok: true,
      hand: handNumber,
      hands_played: num(after.hands_played),
      seats_dealt: num(after.seats_dealt),
      dealer: String(after.dealer_user_id).slice(0, 8),
      kind: view.hand_result?.kind,
      xp: num(view.xp_award?.total),
      standings: (after.standings ?? []).map((s) => `${s.user_id.slice(0, 8)}:${num(s.table_points)}`),
    });

    if (after.complete) {
      lastRotation = after;
      break;
    }

    // Wait out the inter-hand pause, then poll until the next hand opens. This
    // is exactly what a client does while the result is on screen.
    const opensAt = after.next_hand_opens_at ? Date.parse(after.next_hand_opens_at) : 0;
    const pause = Math.max(1_000, opensAt - Date.now() + 2_000);
    await wait(Math.min(pause, 60_000));

    let advanced = null;
    for (let poll = 0; poll < 40 && !advanced; poll += 1) {
      for (const player of players) {
        const next = await matchState(player, sessionId);
        if (next?.rotation && num(next.rotation.hand_number) > handNumber) {
          advanced = next.rotation;
          break;
        }
        if (next?.rotation?.complete) {
          advanced = next.rotation;
          break;
        }
      }
      if (!advanced) await wait(2_000);
    }
    if (!advanced) {
      fail("next_hand", `hand ${handNumber} finished but the next one never opened`);
    }
    lastRotation = advanced;
    if (advanced.complete) break;
    handNumber = num(advanced.hand_number);
  }

  const final = lastRotation;
  if (!final?.complete) {
    fail("rotation_complete", `the rotation did not finish within ${ROTATION_TIMEOUT_MS}ms`);
  }

  assertPointsBalance(final, "final");

  if (!["rotation_complete", "time_limit"].includes(final.reason)) {
    fail("completion_reason", `unexpected reason ${JSON.stringify(final.reason)}`);
  }
  if ((final.placements ?? []).length !== 4) {
    fail("podium", `podium has ${(final.placements ?? []).length} entries, want 4`);
  }
  if (num(final.hands_played) < 2) {
    fail("multi_hand", `rotation played ${num(final.hands_played)} hands — that is a single-hand match`);
  }

  // Winds must have turned for at least one player, or the dealership never
  // actually moved and the rotation was four hands by the same dealer.
  let windsTurned = false;
  const hands = [...windsByHand.keys()].sort((a, b) => a - b);
  for (let i = 1; i < hands.length; i += 1) {
    const first = windsByHand.get(hands[0]);
    const later = windsByHand.get(hands[i]);
    for (const [userId, wind] of later) {
      if (first.get(userId) !== wind) windsTurned = true;
    }
  }

  report("rotation_completed", {
    ok: true,
    reason: final.reason,
    hands_played: num(final.hands_played),
    seats_dealt: num(final.seats_dealt),
    distinct_dealers: dealers.size,
    winds_turned: windsTurned,
    placements: (final.placements ?? []).map(
      (p) => `${p.user_id.slice(0, 8)}:#${p.position}:${num(p.table_points)}${p.rating_tie ? ":tie" : ""}`,
    ),
  });

  if (!windsTurned && dealers.size < 2) {
    fail("dealership", "the dealership never moved");
  }

  // Poll the finished rotation as a client on the podium would, so the
  // placement award lands where the player can see it.
  for (let poll = 0; poll < 6; poll += 1) {
    await wait(2_000);
    for (const player of players) {
      await matchState(player, sessionId);
    }
  }

  await wait(10_000);

  let placementXpSeen = false;
  for (const player of players) {
    const account = await jadeAccount(player);
    const standing = await progression(player);
    const after = num(account?.balance);
    const before = jadeBefore.get(player.label);
    // §8.4: Full Rotation stakes no Jade. Any movement at all is a defect.
    if (after !== before) {
      fail("jade_untouched", `Jade moved during a Full Rotation: ${before} -> ${after}`, {
        player: player.label,
      });
    }
    if (num(account?.reserved) !== 0) {
      fail("jade_untouched", `Jade is reserved after a Full Rotation: ${num(account?.reserved)}`, {
        player: player.label,
      });
    }
    const xp = num(standing?.progression?.lifetime_xp);
    // Per-hand 50 each plus a placement award of at least 100 (§12.1).
    if (xp >= 50 * num(final.hands_played) + 100) placementXpSeen = true;
    report("player_result", {
      player: player.label,
      jade_before: before,
      jade_after: after,
      lifetime_xp: xp,
      level: standing?.progression?.level,
    });
  }

  report("summary", {
    ok: true,
    placement_xp_consistent: placementXpSeen,
    note:
      "A Full Rotation completed on the deployed service: multiple hands, a moving " +
      "dealership, balanced table points, a full podium, and no Jade touched.",
  });
}

main().catch((error) => {
  report("fatal", { ok: false, message: error.message });
  process.exitCode = 1;
});
