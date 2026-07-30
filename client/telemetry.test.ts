import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBrowserTelemetry,
  OPTIONAL_ANALYTICS_CONSENT_KEY,
  TELEMETRY_MAX_BATCH_SIZE,
} from "./telemetry";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    value: (key: string) => values.get(key),
  };
}

function telemetryOptions(fetchImpl: typeof fetch, consent = false) {
  let id = 0;
  return {
    baseURL: "https://gameswithout.prod.gamingservices.accelbyte.io",
    namespace: "gameswithout-mahjong",
    clientVersion: "beta-1",
    getAccessToken: () => "player-token",
    fetchImpl,
    consentStorage: memoryStorage(
      consent ? { [OPTIONAL_ANALYTICS_CONSENT_KEY]: "true" } : {},
    ),
    sessionStorage: memoryStorage(),
    createID: () => `test-${String(++id).padStart(8, "0")}`,
    now: () => new Date("2026-07-28T12:00:00Z"),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("browser telemetry", () => {
  it("suppresses optional journeys until the player opts in", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const telemetry = createBrowserTelemetry(telemetryOptions(fetchImpl, false));

    expect(
      telemetry.track("tutorial_started", {
        dimensions: { script_version: "tutorial-v1" },
      }),
    ).toBe(false);
    expect(telemetry.track("app_session_started")).toBe(true);
    await telemetry.flush();

    const request = fetchImpl.mock.calls[0][1];
    const body = JSON.parse(String(request?.body)) as Array<Record<string, unknown>>;
    expect(body.map((event) => event.EventName)).toEqual(["app_session_started"]);
    expect(body[0].Payload).toMatchObject({ privacy_class: "essential" });
  });

  it("persists opt-in and sends allowlisted optional fields with bearer auth", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const options = telemetryOptions(fetchImpl, false);
    const telemetry = createBrowserTelemetry(options);
    telemetry.setOptionalConsent(true);

    expect(options.consentStorage.value(OPTIONAL_ANALYTICS_CONSENT_KEY)).toBe("true");
    expect(
      telemetry.track("queue_entry_result", {
        dimensions: {
          mode: "bamboo_quick_play",
          outcome: "queued",
          tier: "bamboo",
        },
        measurements: { elapsed_ms: 125 },
      }),
    ).toBe(true);
    await telemetry.flush();

    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      "https://gameswithout.prod.gamingservices.accelbyte.io/game-telemetry/v1/protected/events",
    );
    expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer player-token");
    const body = JSON.parse(String(request?.body)) as Array<Record<string, unknown>>;
    expect(body[0]).toMatchObject({
      DeviceType: "web",
      EventName: "queue_entry_result",
      EventNamespace: "gameswithout-mahjong",
      ClientTimestamp: "2026-07-28T12:00:00.000Z",
      Payload: {
        privacy_class: "optional",
        schema_version: 1,
        dimensions: {
          client_version: "beta-1",
          mode: "bamboo_quick_play",
          outcome: "queued",
        },
        measurements: { elapsed_ms: 125 },
      },
    });
    expect(JSON.stringify(body)).not.toContain("player-token");
  });

  it("rejects a non-contract field instead of leaking it", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const telemetry = createBrowserTelemetry(telemetryOptions(fetchImpl, true));

    expect(
      telemetry.track("lobby_impression", {
        dimensions: { email: "private@example.com" },
      }),
    ).toBe(false);
    await telemetry.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records result-friend outcomes without accepting opponent identity", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const telemetry = createBrowserTelemetry(telemetryOptions(fetchImpl, true));

    expect(
      telemetry.track("result_friend_options_shown", {
        dimensions: { source: "hand_result" },
        measurements: { opponent_count: 3, eligible_count: 2 },
      }),
    ).toBe(true);
    expect(
      telemetry.track("friend_request_result", {
        dimensions: {
          source: "hand_result",
          outcome: "sent",
          user_id: "must-not-leave-the-client",
        },
      }),
    ).toBe(false);
    expect(
      telemetry.track("friend_request_result", {
        dimensions: { source: "hand_result", outcome: "sent" },
      }),
    ).toBe(true);
    await telemetry.flush();

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)) as Array<{
      EventName: string;
      Payload: { dimensions: Record<string, string>; measurements: Record<string, number> };
    }>;
    expect(body.map((event) => event.EventName)).toEqual([
      "result_friend_options_shown",
      "friend_request_result",
    ]);
    expect(JSON.stringify(body)).not.toContain("must-not-leave-the-client");
  });

  it("omits absent allowlisted fields without suppressing the event", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const telemetry = createBrowserTelemetry(telemetryOptions(fetchImpl, true));

    expect(
      telemetry.track("tutorial_started", {
        dimensions: {
          script_version: "tutorial-v1",
          chapter_id: undefined,
          step_id: undefined,
        },
      }),
    ).toBe(true);
    await telemetry.flush();

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)) as Array<{
      Payload: { dimensions: Record<string, string> };
    }>;
    expect(body[0].Payload.dimensions.script_version).toBe("tutorial-v1");
    expect(body[0].Payload.dimensions).not.toHaveProperty("chapter_id");
    expect(body[0].Payload.dimensions).not.toHaveProperty("step_id");
  });

  it("keeps a failed batch and retries it unchanged", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const telemetry = createBrowserTelemetry(telemetryOptions(fetchImpl, false));
    telemetry.track("app_session_started");

    await telemetry.flush();
    await telemetry.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1]?.body).toBe(fetchImpl.mock.calls[0][1]?.body);
  });

  it("does not drop a later essential event when consent changes during a flush", async () => {
    let completeFirstRequest: ((response: Response) => void) | undefined;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            completeFirstRequest = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const telemetry = createBrowserTelemetry(telemetryOptions(fetchImpl, true));
    telemetry.track("tutorial_started", {
      dimensions: { script_version: "tutorial-v1" },
    });

    const firstFlush = telemetry.flush();
    telemetry.track("app_session_started");
    telemetry.setOptionalConsent(false);
    completeFirstRequest?.(new Response(null, { status: 204 }));
    await firstFlush;
    await telemetry.flush();

    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body)) as Array<{
      EventName: string;
    }>;
    expect(secondBody.map((event) => event.EventName)).toEqual(["app_session_started"]);
  });

  it("bounds each network batch", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const telemetry = createBrowserTelemetry(telemetryOptions(fetchImpl, false));
    for (let index = 0; index < TELEMETRY_MAX_BATCH_SIZE + 5; index += 1) {
      telemetry.track("app_visibility_changed", {
        dimensions: { visibility_state: index % 2 === 0 ? "visible" : "hidden" },
      });
    }

    await telemetry.flush();
    await telemetry.flush();

    const counts = fetchImpl.mock.calls.map(([, request]) => {
      const body = JSON.parse(String(request?.body)) as unknown[];
      return body.length;
    });
    expect(counts).toEqual([TELEMETRY_MAX_BATCH_SIZE, 5]);
  });
});
