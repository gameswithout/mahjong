const baseURL = process.env.ACCELBYTE_BASE_URL;
const namespace = process.env.ACCELBYTE_NAMESPACE;
const clientId = process.env.ACCELBYTE_CLIENT_ID;

if (!baseURL || !namespace || !clientId) {
  throw new Error(
    "ACCELBYTE_BASE_URL, ACCELBYTE_NAMESPACE, and ACCELBYTE_CLIENT_ID are required.",
  );
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
  const deviceId = `mahjong-telemetry-smoke-${crypto.randomUUID()}`;
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
    throw new Error(`AGS guest login failed with HTTP ${response.status}`);
  }
  return body.access_token;
}

async function main() {
  const token = await loginGuest();
  const eventId = `telemetry-smoke-${crypto.randomUUID()}`;
  const occurredAt = new Date().toISOString();
  const response = await fetch(`${baseURL}/game-telemetry/v1/protected/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      {
        ClientTimestamp: occurredAt,
        DeviceType: "web_smoke",
        EventId: eventId,
        EventName: "telemetry_smoke",
        EventNamespace: namespace,
        Payload: {
          event_id: eventId,
          schema_version: 1,
          privacy_class: "essential",
          occurred_at: occurredAt,
          source: "smoke_test",
        },
      },
    ]),
  });
  if (response.status !== 204) {
    const body = await readJSON(response);
    const detail =
      body && typeof body === "object" && "errorMessage" in body
        ? `: ${String(body.errorMessage)}`
        : "";
    throw new Error(`AGS Game Telemetry returned HTTP ${response.status}${detail}`);
  }
  console.log(`AGS Game Telemetry accepted telemetry_smoke (${eventId}) with HTTP 204.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Telemetry smoke failed.");
  process.exitCode = 1;
});
