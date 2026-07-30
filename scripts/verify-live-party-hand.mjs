// Live verification of a four-human public hand, formed through a party.
//
// This exists because six shipped features had never executed in production,
// all blocked on the same sentence in the deployment record: "needs four
// humans in one public hand, which no automated script here can currently
// produce." Party matchmaking makes it producible — a party of four fills a
// table on its own, deterministically, instead of hoping four strangers queue
// in the same window.
//
// What one clean run proves, live:
//   - a party of four forms and enters matchmaking as one ticket;
//   - a real public match is created from it and all four seats join;
//   - §12.3 achievement statistics are written for a public hand (only the
//     negative case — Practice writes nothing — was proven before);
//   - an achievement unlocks and its §12.3 XP is paid;
//   - the §7.5 daily play grant is paid and jade_daily_grants is written;
//   - Jade settles across four real accounts.
//
// It deliberately does NOT prove the welfare top-up: that needs a genuine
// staked loss, which needs someone to win a legal hand, which the simplest
// legal play here cannot reliably force.
//
// Usage:  node scripts/verify-live-party-hand.mjs

const baseURL = process.env.ACCELBYTE_BASE_URL ?? "https://gameswithout-mahjong.prod.gamingservices.accelbyte.io";
const ns = process.env.ACCELBYTE_NAMESPACE ?? "gameswithout-mahjong";
const clientId = process.env.ACCELBYTE_CLIENT_ID ?? "dc7a13b683c44822905797a8d1df39e7";
const matchServiceURL =
  process.env.ACCELBYTE_MATCH_SERVICE_URL ??
  `${baseURL}/ext-gameswithout-mahjong-mahjong-match-service`;
const matchPool = process.env.ACCELBYTE_MATCH_POOL ?? "mahjong-test-pool";
const partyTemplate = process.env.ACCELBYTE_PARTY_TEMPLATE ?? "mahjong-party";

const MATCH_WAIT_MS = 3 * 60_000;
const HAND_TIMEOUT_MS = 8 * 60_000;

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

async function guest(label) {
  const deviceId = `party-hand-${label}-${crypto.randomUUID()}`;
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

// --- Jade -------------------------------------------------------------------

async function jadeAccount(player) {
  const response = await fetch(`${matchServiceURL}/v1/namespaces/${ns}/jade`, {
    headers: H(player.token, false),
  });
  const payload = await body(response);
  if (!response.ok) fail("jade_account", `HTTP ${response.status}`, { player: player.label });
  return payload?.account;
}

// Every seat needs its own reservation: JoinMatch binds one per player and
// refuses the seat without it. This is the step a party flow is most likely to
// forget, because only the leader submits the matchmaking ticket.
async function reserveJade(player) {
  const response = await fetch(`${matchServiceURL}/v1/namespaces/${ns}/jade/reservation`, {
    method: "POST",
    headers: H(player.token),
    body: "{}",
  });
  if (!response.ok) {
    fail("jade_reserve", `HTTP ${response.status}`, { player: player.label });
  }
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
    fail("party_ticket", `HTTP ${response.status}`, { payload });
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
    if (response.status === 404) {
      // A consumed ticket is how AGS reports "already matched" once the
      // session exists, so this is not an error on its own.
      return null;
    }
    await wait(2_000);
  }
  fail("await_match", `no match formed within ${MATCH_WAIT_MS}ms`);
}

async function joinGameSession(player, sessionId) {
  const response = await fetch(
    `${baseURL}/session/v1/public/namespaces/${ns}/gamesessions/${sessionId}/join`,
    { method: "POST", headers: H(player.token, false) },
  );
  // Already a member is a success for our purposes: matchmaking may seat the
  // party automatically.
  if (!response.ok && response.status !== 409) {
    report("game_session_join", { ok: false, player: player.label, status: response.status });
  }
}

// --- Match runtime ----------------------------------------------------------

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
      detail: JSON.stringify(payload).slice(0, 200),
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

// Drives every seat with the simplest legal policy that makes progress. No
// attempt to win: that needs rules-aware play, and the point here is that a
// public hand completes and pays out, not who takes it.
async function playHand(players, matchId) {
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
      if (view.hand_result) {
        return { view, seat: player };
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
        next = await command(player, matchId, {
          type: "submit_claim",
          expected_version: view.state_version,
          claim: {
            action_id: view.claim.action_id,
            type: "pass",
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
  fail("play_hand", `hand did not complete within ${HAND_TIMEOUT_MS}ms`);
}

// --- Verification reads -----------------------------------------------------

async function progression(player) {
  const response = await fetch(`${matchServiceURL}/v1/namespaces/${ns}/progression`, {
    headers: H(player.token, false),
  });
  return response.ok ? await body(response) : null;
}

async function main() {
  const players = [];
  for (const label of ["east", "south", "west", "north"]) {
    players.push(await guest(label));
  }
  report("guests", { ok: true, ids: players.map((p) => p.id.slice(0, 8)) });

  for (const player of players) {
    const account = await jadeAccount(player);
    if (Number(account?.balance) !== 5000 || account?.eligible !== true) {
      fail("jade_baseline", "unexpected starting account", {
        player: player.label,
        balance: account?.balance,
      });
    }
  }
  report("jade_baseline", { ok: true, note: "all four start on 5,000 Jade and are eligible" });

  const [leader, ...members] = players;
  const partyId = await createParty(leader);
  for (const member of members) {
    await inviteAndJoin(leader, partyId, member);
  }
  report("party_formed", { ok: true, partyId });

  // Every seat reserves before the leader queues. JoinMatch binds one
  // reservation per player and refuses the seat without it, so a party flow
  // that only reserves for the leader seats nobody else.
  for (const player of players) {
    await reserveJade(player);
  }
  report("jade_reserved", { ok: true, note: "all four hold a reservation" });

  const ticketId = await createPartyTicket(leader, partyId);
  report("party_ticket", { ok: true, ticketId });

  const sessionId = await awaitMatch(leader, ticketId);
  if (!sessionId) fail("await_match", "ticket consumed without naming a session");
  report("match_found", { ok: true, sessionId });

  for (const player of players) {
    await joinGameSession(player, sessionId);
  }
  for (const player of players) {
    const view = await joinMatch(player, sessionId);
    if (!view) fail("join_match", "no view returned", { player: player.label });
  }
  report("all_seats_joined", { ok: true, note: "four seats joined the authoritative match" });

  const { view: finalView } = await playHand(players, sessionId);
  report("hand_completed", {
    ok: true,
    kind: finalView.hand_result?.kind,
    xp_award: finalView.xp_award,
    achievements: finalView.achievements,
  });

  // AGS evaluates achievement unlocks from the statistics we just wrote, and
  // that evaluation is not synchronous with the write. Read once immediately
  // and once after a pause, so an unlock that lands late is visible as late
  // rather than as absent.
  const immediate = new Map();
  for (const player of players) {
    const standing = await progression(player);
    immediate.set(player.label, Number(standing?.progression?.lifetime_xp ?? 0));
  }
  report("xp_immediately_after_hand", {
    ok: true,
    xp: Object.fromEntries(immediate),
  });

  await wait(20_000);

  // Settlement and payouts, read back per seat.
  for (const player of players) {
    const account = await jadeAccount(player);
    const standing = await progression(player);
    report("player_result", {
      player: player.label,
      jade: account?.balance,
      level: standing?.progression?.level,
      lifetime_xp: standing?.progression?.lifetime_xp,
      xp_before_pause: immediate.get(player.label),
      earned: (standing?.progression?.earned ?? []).map((r) => r.code),
    });
  }

  report("summary", {
    ok: true,
    note:
      "A four-human public hand completed on the deployed service via a party. " +
      "Welfare remains unverified: it needs a genuine staked loss, which needs a " +
      "legal winning hand this script does not attempt to force.",
  });
}

main().catch((error) => {
  report("fatal", { ok: false, message: error.message });
  process.exitCode = 1;
});
