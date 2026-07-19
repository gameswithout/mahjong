const baseURL = process.env.ACCELBYTE_BASE_URL;
const namespace = process.env.ACCELBYTE_NAMESPACE;
const clientId = process.env.ACCELBYTE_CLIENT_ID;
const matchPool = process.env.ACCELBYTE_MATCH_POOL;

if (!baseURL || !namespace || !clientId || !matchPool) {
  throw new Error(
    "ACCELBYTE_BASE_URL, ACCELBYTE_NAMESPACE, ACCELBYTE_CLIENT_ID, and ACCELBYTE_MATCH_POOL are required.",
  );
}

const playerCount = 4;
const matchmakingURL = `${baseURL}/match2/v1/namespaces/${encodeURIComponent(namespace)}/match-tickets`;
const sessionBaseURL = `${baseURL}/session/v1/public/namespaces/${encodeURIComponent(namespace)}/gamesessions`;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

async function loginGuest(index) {
  const deviceId = `mahjong-smoke-${index}-${crypto.randomUUID()}`;
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
  if (!response.ok || typeof body?.access_token !== "string") {
    throw new Error(`guest login failed with HTTP ${response.status}`);
  }

  return { token: body.access_token };
}

function bearerHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function createTicket(player) {
  const response = await fetch(matchmakingURL, {
    method: "POST",
    headers: { ...bearerHeaders(player.token), "Content-Type": "application/json" },
    body: JSON.stringify({ attributes: {}, matchPool, sessionID: "" }),
  });
  const body = await readJSON(response);
  const ticketId = typeof body?.matchTicketID === "string" ? body.matchTicketID : undefined;
  if (!response.ok || !ticketId) {
    throw new Error(`ticket creation failed with HTTP ${response.status}`);
  }

  return { ...player, ticketId };
}

async function getTicket(player) {
  const response = await fetch(`${matchmakingURL}/${encodeURIComponent(player.ticketId)}`, {
    headers: bearerHeaders(player.token),
  });
  const body = await readJSON(response);
  return {
    status: response.status,
    matchFound: body?.matchFound === true,
    sessionId: typeof body?.sessionID === "string" && body.sessionID ? body.sessionID : undefined,
  };
}

async function cancelTicket(player) {
  await fetch(`${matchmakingURL}/${encodeURIComponent(player.ticketId)}`, {
    method: "DELETE",
    headers: bearerHeaders(player.token),
  });
}

async function joinSession(player, sessionId) {
  const response = await fetch(`${sessionBaseURL}/${encodeURIComponent(sessionId)}/join`, {
    method: "POST",
    headers: bearerHeaders(player.token),
  });
  if (!response.ok) {
    throw new Error(`session join failed with HTTP ${response.status}`);
  }
}

async function getSession(player, sessionId) {
  const response = await fetch(`${sessionBaseURL}/${encodeURIComponent(sessionId)}`, {
    headers: bearerHeaders(player.token),
  });
  const body = await readJSON(response);
  if (!response.ok || !Array.isArray(body?.members)) {
    throw new Error(`session read failed with HTTP ${response.status}`);
  }

  return body.members.length;
}

async function leaveSession(player, sessionId) {
  const response = await fetch(`${sessionBaseURL}/${encodeURIComponent(sessionId)}/leave`, {
    method: "DELETE",
    headers: bearerHeaders(player.token),
  });
  if (!response.ok) {
    throw new Error(`session leave failed with HTTP ${response.status}`);
  }
}

async function main() {
  const players = await Promise.all(
    Array.from({ length: playerCount }, (_, index) => loginGuest(index + 1)),
  );
  const tickets = [];
  const joinedPlayers = [];
  let sessionId;
  let sessionLeft = false;

  try {
    for (const player of players) {
      tickets.push(await createTicket(player));
    }
    console.log(`Created ${tickets.length} matchmaking tickets.`);

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const details = await Promise.all(tickets.map(getTicket));
      sessionId = details.find((detail) => detail.sessionId)?.sessionId;
      if (sessionId) {
        console.log(`Match found after ${attempt} poll${attempt === 1 ? "" : "s"}.`);
        break;
      }
      await wait(2000);
    }

    if (!sessionId) {
      throw new Error("No four-player match formed within 40 seconds.");
    }

    for (const player of tickets) {
      await joinSession(player, sessionId);
      joinedPlayers.push(player);
    }
    const rosterSizes = await Promise.all(tickets.map((player) => getSession(player, sessionId)));
    if (rosterSizes.some((size) => size !== playerCount)) {
      throw new Error(`Expected roster size ${playerCount}; received ${rosterSizes.join(",")}.`);
    }
    console.log(`All players joined; roster size is ${playerCount}.`);

    await Promise.all(tickets.map((player) => leaveSession(player, sessionId)));
    sessionLeft = true;
    console.log("All players left; matchmaking smoke passed.");
  } finally {
    if (!sessionId) {
      await Promise.allSettled(tickets.map(cancelTicket));
    } else if (!sessionLeft && joinedPlayers.length > 0) {
      await Promise.allSettled(joinedPlayers.map((player) => leaveSession(player, sessionId)));
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Matchmaking smoke failed.");
  process.exitCode = 1;
});
