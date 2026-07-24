import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SeatView } from "../protocol/envelope";
import type { BrowserIam } from "./iam";
import type { MatchRuntimeConnection, MatchRuntimeConnectionOptions } from "./match-runtime";
import { SessionLookupError, type SessionClient } from "./session";

const dependencies = vi.hoisted(() => ({
  createLobbyConnection: vi.fn(),
  createMatchRuntimeConnection: vi.fn(),
  createSessionClient: vi.fn(),
}));

vi.mock("./config", async () => {
  const actual = await vi.importActual<typeof import("./config")>("./config");
  return {
    ...actual,
    accelByteConfig: {
      baseURL: "https://example.test",
      namespace: "mahjong-test",
      clientId: "browser-client",
      matchServiceURL: "https://match.example.test",
      matchPool: "bamboo",
      sessionTemplate: "mahjong",
      sessionClientVersion: "test",
    },
  };
});

vi.mock("./lobby", async () => {
  const actual = await vi.importActual<typeof import("./lobby")>("./lobby");
  return { ...actual, createLobbyConnection: dependencies.createLobbyConnection };
});

vi.mock("./match-runtime", async () => {
  const actual = await vi.importActual<typeof import("./match-runtime")>("./match-runtime");
  return {
    ...actual,
    createMatchRuntimeConnection: dependencies.createMatchRuntimeConnection,
  };
});

vi.mock("./session", async () => {
  const actual = await vi.importActual<typeof import("./session")>("./session");
  return { ...actual, createSessionClient: dependencies.createSessionClient };
});

import { App, shouldAutomaticallyRetryMatchRuntime } from "./App";

function completedPracticeView(matchId: string): SeatView {
  return {
    match_id: matchId,
    seat: "E",
    state_version: 9,
    phase: "exhaustive_draw",
    active_seat: "E",
    own_hand: [],
    own_exposed: [],
    players: [
      { seat: "E", hand_count: 0 },
      { seat: "S", hand_count: 0, is_bot: true },
      { seat: "W", hand_count: 0, is_bot: true },
      { seat: "N", hand_count: 0, is_bot: true },
    ],
    wall: { remaining: 16, drawable_remaining: 0, reserve_remaining: 16 },
    hand_result: { kind: "exhaustive_draw", winners: [] },
    settlement: {
      transfers: [],
      net: {},
      total_credits: 0,
      total_debits: 0,
    },
  };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return match;
}

async function clickAndFlush(container: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    button(container, label).click();
    // The journey composes event handling, Session promises, runtime ready,
    // and a queued joined projection. Flush each microtask boundary inside
    // React's act scope before making DOM assertions.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("App Practice journey", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let sessionNumber: number;
  let calls: string[];
  let sessionClient: SessionClient;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    sessionNumber = 0;
    calls = [];

    sessionClient = {
      listMySessions: vi.fn().mockResolvedValue([]),
      getSession: vi.fn(),
      joinSession: vi.fn(),
      createSession: vi.fn(async (attributes?: Record<string, unknown>) => {
        sessionNumber += 1;
        calls.push(`create:${JSON.stringify(attributes)}`);
        return {
          sessionId: `practice-${sessionNumber}`,
          status: "JOINED",
          members: [{ userId: "guest-1" }],
        };
      }),
      leaveSession: vi.fn(async (sessionId: string) => {
        calls.push(`leave:${sessionId}`);
      }),
    };
    dependencies.createSessionClient.mockReturnValue(sessionClient);
    dependencies.createLobbyConnection.mockImplementation((_sdk, callbacks) => {
      queueMicrotask(() => callbacks.onOpen());
      return { disconnect: vi.fn() };
    });
    dependencies.createMatchRuntimeConnection.mockImplementation(
      (_accessToken: string, options: MatchRuntimeConnectionOptions) => {
        let closed = false;
        const connection: MatchRuntimeConnection = {
          ready: Promise.resolve({
            protocol_version: "1",
            server_time: "2026-07-24T00:00:00Z",
            user_id: "guest-1",
          }),
          join: vi.fn((matchId: string) => {
            calls.push(`connect:${matchId}`);
            queueMicrotask(() => {
              if (!closed) {
                const view = completedPracticeView(matchId);
                options.onJoined?.({ match_id: matchId, seat: "E", view });
              }
            });
            return `join-${matchId}`;
          }),
          sync: vi.fn(() => "sync"),
          command: vi.fn(() => "command"),
          close: vi.fn(() => {
            closed = true;
          }),
        };
        return connection;
      },
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("retries a newly created Session's transient not-found window only within the bound", () => {
    expect(shouldAutomaticallyRetryMatchRuntime("not_found", 0)).toBe(true);
    expect(shouldAutomaticallyRetryMatchRuntime("not_found", 4)).toBe(true);
    expect(shouldAutomaticallyRetryMatchRuntime("not_found", 5)).toBe(false);
    expect(shouldAutomaticallyRetryMatchRuntime("protocol", 0)).toBe(false);
  });

  it("launches, replays with a fresh Session, and returns to the lobby", async () => {
    const iam = {
      loginAsGuest: vi.fn().mockResolvedValue({ userId: "guest-1", deviceId: "device-1" }),
      getAuthenticatedSdk: vi.fn().mockReturnValue({}),
      getAccessToken: vi.fn().mockReturnValue("guest-token"),
    } as unknown as BrowserIam;

    act(() => root.render(<App iam={iam} />));
    await clickAndFlush(container, "Continue as Guest");
    await vi.waitFor(() => expect(container.textContent).toContain("Lobby connected"));

    await clickAndFlush(container, "Practice vs Bots");
    await vi.waitFor(() => expect(container.textContent).toContain("Practice result"));
    expect(calls).toEqual([
      'create:{"ai_practice":"true"}',
      "connect:practice-1",
    ]);

    await clickAndFlush(container, "Play Again");
    await vi.waitFor(() => expect(calls).toContain("connect:practice-2"));
    await vi.waitFor(() => expect(container.textContent).toContain("Practice result"));
    expect(calls).toEqual([
      'create:{"ai_practice":"true"}',
      "connect:practice-1",
      "leave:practice-1",
      'create:{"ai_practice":"true"}',
      "connect:practice-2",
    ]);

    await clickAndFlush(container, "Return to Lobby");
    await vi.waitFor(() => expect(container.textContent).toContain("Solo Practice"));
    expect(calls.at(-1)).toBe("leave:practice-2");
    expect(container.querySelector('[aria-label="Hand result"]')).toBeNull();
  });

  it("does not create a replacement until a failed leave is retried", async () => {
    const iam = {
      loginAsGuest: vi.fn().mockResolvedValue({ userId: "guest-1", deviceId: "device-1" }),
      getAuthenticatedSdk: vi.fn().mockReturnValue({}),
      getAccessToken: vi.fn().mockReturnValue("guest-token"),
    } as unknown as BrowserIam;

    act(() => root.render(<App iam={iam} />));
    await clickAndFlush(container, "Continue as Guest");
    await vi.waitFor(() => expect(container.textContent).toContain("Lobby connected"));
    await clickAndFlush(container, "Practice vs Bots");
    await vi.waitFor(() => expect(container.textContent).toContain("Practice result"));

    vi.mocked(sessionClient.leaveSession).mockRejectedValueOnce(
      new SessionLookupError("network", "Could not leave the old table."),
    );
    await clickAndFlush(container, "Play Again");
    await vi.waitFor(() => expect(container.textContent).toContain("Retry Practice"));

    expect(sessionClient.createSession).toHaveBeenCalledOnce();
    expect(sessionClient.leaveSession).toHaveBeenCalledOnce();

    await clickAndFlush(container, "Retry Practice");
    await vi.waitFor(() => expect(calls).toContain("connect:practice-2"));

    expect(sessionClient.leaveSession).toHaveBeenCalledTimes(2);
    expect(sessionClient.createSession).toHaveBeenCalledTimes(2);
    expect(calls.slice(-3)).toEqual([
      "leave:practice-1",
      'create:{"ai_practice":"true"}',
      "connect:practice-2",
    ]);
  });

  it("blocks every new table while failed cleanup remains outstanding", async () => {
    const iam = {
      loginAsGuest: vi.fn().mockResolvedValue({ userId: "guest-1", deviceId: "device-1" }),
      getAuthenticatedSdk: vi.fn().mockReturnValue({}),
      getAccessToken: vi.fn().mockReturnValue("guest-token"),
    } as unknown as BrowserIam;

    act(() => root.render(<App iam={iam} />));
    await clickAndFlush(container, "Continue as Guest");
    await vi.waitFor(() => expect(container.textContent).toContain("Lobby connected"));
    await clickAndFlush(container, "Practice vs Bots");
    await vi.waitFor(() => expect(container.textContent).toContain("Practice result"));

    vi.mocked(sessionClient.leaveSession)
      .mockRejectedValueOnce(new SessionLookupError("network", "First leave failed."))
      .mockRejectedValueOnce(new SessionLookupError("network", "Second leave failed."));

    await clickAndFlush(container, "Play Again");
    await vi.waitFor(() => expect(container.textContent).toContain("Retry Practice"));
    await clickAndFlush(container, "Leave match");
    await vi.waitFor(() =>
      expect(container.textContent).toContain("couldn't leave your previous table"),
    );

    expect(button(container, "Practice vs Bots").disabled).toBe(true);
    expect(button(container, "Find a table").disabled).toBe(true);
    expect(sessionClient.createSession).toHaveBeenCalledOnce();

    await clickAndFlush(container, "Retry leaving table");
    await vi.waitFor(() => expect(button(container, "Practice vs Bots").disabled).toBe(false));
    expect(button(container, "Find a table").disabled).toBe(false);
    expect(sessionClient.leaveSession).toHaveBeenCalledTimes(3);
  });
});
