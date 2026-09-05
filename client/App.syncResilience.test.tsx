import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SeatView } from "../protocol/envelope";
import type { BrowserIam } from "./iam";
import type {
  MatchRuntimeConnection,
  MatchRuntimeConnectionOptions,
} from "./match-runtime";
import type { SessionClient } from "./session";

const dependencies = vi.hoisted(() => ({
  createJadeClient: vi.fn(),
  createProgressionClient: vi.fn(),
  createLobbyConnection: vi.fn(),
  createMatchRuntimeConnection: vi.fn(),
  createSessionClient: vi.fn(),
}));

vi.mock("./jade", async () => {
  const actual = await vi.importActual<typeof import("./jade")>("./jade");
  return { ...actual, createJadeClient: dependencies.createJadeClient };
});

vi.mock("./progression", async () => {
  const actual = await vi.importActual<typeof import("./progression")>("./progression");
  return {
    ...actual,
    createProgressionClient: dependencies.createProgressionClient,
  };
});

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
  return {
    ...actual,
    createLobbyConnection: dependencies.createLobbyConnection,
  };
});

vi.mock("./match-runtime", async () => {
  const actual = await vi.importActual<typeof import("./match-runtime")>(
    "./match-runtime",
  );
  return {
    ...actual,
    createMatchRuntimeConnection: dependencies.createMatchRuntimeConnection,
  };
});

vi.mock("./session", async () => {
  const actual = await vi.importActual<typeof import("./session")>("./session");
  return {
    ...actual,
    createSessionClient: dependencies.createSessionClient,
  };
});

import { App, STALLED_TABLE_GRACE_MS } from "./App";
import { MatchRuntimeError } from "./match-runtime";

function liveView(matchId: string): SeatView {
  return {
    match_id: matchId,
    seat: "E",
    state_version: 3,
    phase: "awaiting_discard",
    active_seat: "E",
    own_hand: [
      { id: "characters-1-1", kind: "characters", rank: 1, copy: 1 },
    ],
    own_exposed: [],
    players: [
      { seat: "E", hand_count: 1 },
      { seat: "S", hand_count: 16, is_bot: true },
      { seat: "W", hand_count: 16, is_bot: true },
      { seat: "N", hand_count: 16, is_bot: true },
    ],
    wall: { remaining: 40, drawable_remaining: 24, reserve_remaining: 16 },
  };
}

describe("live-table resilience to failed match-state polls", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let runtimeOptions!: MatchRuntimeConnectionOptions;
  let runtimeCommand: ReturnType<typeof vi.fn>;
  const matchId = "practice-resilience-1";

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    runtimeCommand = vi.fn(() => "command");

    dependencies.createJadeClient.mockReturnValue({
      getAccount: vi.fn().mockResolvedValue({
        balance: 5000,
        available: 5000,
        reserved: 0,
        eligible: true,
      }),
      reserve: vi.fn(),
      release: vi.fn(),
    });
    dependencies.createProgressionClient.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        progression: { level: 1, lifetime_xp: 0 },
        curve: [],
      }),
      awardOnboarding: vi.fn(),
    });

    const sessionClient: Partial<SessionClient> = {
      listMySessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn().mockResolvedValue({
        sessionId: matchId,
        status: "JOINED",
        members: [{ userId: "guest-1" }],
      }),
      leaveSession: vi.fn().mockResolvedValue(undefined),
    };
    dependencies.createSessionClient.mockReturnValue(sessionClient);
    dependencies.createLobbyConnection.mockImplementation((_sdk, callbacks) => {
      queueMicrotask(() => callbacks.onOpen());
      return { disconnect: vi.fn() };
    });
    dependencies.createMatchRuntimeConnection.mockImplementation(
      (_accessToken: string, options: MatchRuntimeConnectionOptions) => {
        runtimeOptions = options;
        const connection: MatchRuntimeConnection = {
          ready: Promise.resolve({
            protocol_version: "1",
            server_time: "2026-07-25T00:00:00Z",
            user_id: "guest-1",
          }),
          join: vi.fn((id: string) => {
            queueMicrotask(() =>
              options.onJoined?.({
                match_id: id,
                seat: "E",
                view: liveView(id),
              }),
            );
            return `join-${id}`;
          }),
          sync: vi.fn(() => "sync"),
          command: runtimeCommand,
          close: vi.fn(),
        };
        return connection;
      },
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    container.remove();
    vi.clearAllMocks();
  });

  async function clickAndFlush(label: string): Promise<void> {
    await act(async () => {
      const target = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === label,
      );
      if (!(target instanceof HTMLButtonElement)) {
        throw new Error(`Button not found: ${label}`);
      }
      target.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function enterLiveMatch(): Promise<void> {
    const iam = {
      loginAsGuest: vi
        .fn()
        .mockResolvedValue({ userId: "guest-1", deviceId: "device-1" }),
      getAuthenticatedSdk: vi.fn().mockReturnValue({}),
      getAccessToken: vi.fn().mockReturnValue("guest-token"),
    } as unknown as BrowserIam;

    act(() => root.render(<App iam={iam} />));
    await clickAndFlush("Continue as Guest");
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Solo Practice"),
    );
    await vi.waitFor(() =>
      expect(container.textContent).toContain("5,000 Jade available"),
    );
    await clickAndFlush("Practice vs Bots");
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="live-match"]')).not.toBeNull(),
    );
  }

  it("escalates from the first failed poll without extending the grace period", async () => {
    await enterLiveMatch();
    vi.useFakeTimers();

    await act(async () => {
      runtimeOptions.onError?.(
        new MatchRuntimeError("protocol", "Match service returned HTTP 400."),
      );
    });
    expect(container.querySelector('[data-testid="live-match"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="table-stalled-notice"]'),
    ).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(STALLED_TABLE_GRACE_MS - 1);
      await Promise.resolve();
    });
    await act(async () => {
      runtimeOptions.onError?.(
        new MatchRuntimeError("protocol", "Match service still returns HTTP 400."),
      );
    });
    expect(container.querySelector('[data-testid="live-match"]')).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="live-match"]')).toBeNull();
    expect(container.textContent).toContain("match_runtime_protocol");
  });

  it("clears a pending command when the request fails", async () => {
    await enterLiveMatch();

    const firstActivation = container.querySelector<HTMLButtonElement>(
      '.essential-hand-tile-button[aria-label*="Activate twice to discard"]',
    );
    await act(async () => {
      firstActivation?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const secondActivation = container.querySelector<HTMLButtonElement>(
      '.essential-hand-tile-button[aria-label*="Select again to discard"]',
    );
    await act(async () => {
      secondActivation?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runtimeCommand).toHaveBeenCalledOnce();
    expect(
      container.querySelector<HTMLButtonElement>(".essential-hand-tile-button")
        ?.disabled,
    ).toBe(true);

    await act(async () => {
      runtimeOptions.onError?.(
        new MatchRuntimeError("protocol", "Match service returned HTTP 400."),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLButtonElement>(".essential-hand-tile-button")
        ?.disabled,
    ).toBe(false);
    expect(container.querySelector('[data-testid="live-match"]')).not.toBeNull();
  });
});
