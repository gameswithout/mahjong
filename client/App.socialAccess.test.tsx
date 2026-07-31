import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserIam } from "./iam";

const dependencies = vi.hoisted(() => ({
  createFriendsClient: vi.fn(),
  createJadeClient: vi.fn(),
  createLobbyConnection: vi.fn(),
  createPartyClient: vi.fn(),
  createProgressionClient: vi.fn(),
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
      partyTemplate: "mahjong-party",
    },
  };
});

vi.mock("./friends", async () => {
  const actual = await vi.importActual<typeof import("./friends")>("./friends");
  return { ...actual, createFriendsClient: dependencies.createFriendsClient };
});

vi.mock("./jade", async () => {
  const actual = await vi.importActual<typeof import("./jade")>("./jade");
  return { ...actual, createJadeClient: dependencies.createJadeClient };
});

vi.mock("./lobby", async () => {
  const actual = await vi.importActual<typeof import("./lobby")>("./lobby");
  return { ...actual, createLobbyConnection: dependencies.createLobbyConnection };
});

vi.mock("./party", async () => {
  const actual = await vi.importActual<typeof import("./party")>("./party");
  return { ...actual, createPartyClient: dependencies.createPartyClient };
});

vi.mock("./progression", async () => {
  const actual = await vi.importActual<typeof import("./progression")>("./progression");
  return {
    ...actual,
    createProgressionClient: dependencies.createProgressionClient,
  };
});

import { App } from "./App";

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const target = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  if (!(target instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return target;
}

describe("App social feature access", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let friendsClient: {
    list: ReturnType<typeof vi.fn>;
    incoming: ReturnType<typeof vi.fn>;
    outgoing: ReturnType<typeof vi.fn>;
  };
  let partyClient: {
    current: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    dependencies.createJadeClient.mockReturnValue({
      getAccount: vi.fn().mockResolvedValue({
        balance: 5000,
        available: 5000,
        reserved: 0,
        eligible: true,
      }),
    });
    dependencies.createProgressionClient.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        progression: { level: 1, lifetime_xp: 0 },
        curve: [],
      }),
      getAchievements: vi.fn().mockResolvedValue([
        {
          code: "first-hand",
          name: "First Hand",
          description: "Complete your first public hand.",
          current: 0,
          goal: 1,
          xp_reward: 100,
          eligible: true,
          unlocked: false,
        },
      ]),
    });
    dependencies.createLobbyConnection.mockImplementation((_sdk, callbacks) => {
      queueMicrotask(() => callbacks.onOpen());
      return { disconnect: vi.fn() };
    });

    friendsClient = {
      list: vi.fn().mockResolvedValue([]),
      incoming: vi.fn().mockResolvedValue([]),
      outgoing: vi.fn().mockResolvedValue([]),
    };
    partyClient = {
      current: vi.fn().mockResolvedValue(null),
    };
    dependencies.createFriendsClient.mockReturnValue(friendsClient);
    dependencies.createPartyClient.mockReturnValue(partyClient);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function enterLobby(isGuest: boolean): Promise<void> {
    const iam = {
      loginAsGuest: vi.fn().mockResolvedValue({
        userId: "player-1",
        deviceId: "device-1",
        isGuest,
      }),
      getAuthenticatedSdk: vi.fn().mockReturnValue({}),
      getAccessToken: vi.fn().mockReturnValue("player-token"),
    } as unknown as BrowserIam;

    act(() => root.render(<App iam={iam} />));
    await act(async () => {
      button(container, "Continue as Guest").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Solo Practice"));
  }

  it("does not render or request friends and party features for a guest", async () => {
    await enterLobby(true);

    expect(container.querySelector(".friends-panel")).toBeNull();
    expect(container.querySelector(".party-panel")).toBeNull();
    expect(dependencies.createFriendsClient).not.toHaveBeenCalled();
    expect(dependencies.createPartyClient).not.toHaveBeenCalled();
    expect(friendsClient.list).not.toHaveBeenCalled();
    expect(partyClient.current).not.toHaveBeenCalled();
  });

  it("keeps friends and party available to a full account", async () => {
    await enterLobby(false);

    await vi.waitFor(() => expect(container.querySelector(".friends-panel")).not.toBeNull());
    await vi.waitFor(() => expect(container.querySelector(".party-panel")).not.toBeNull());
    await vi.waitFor(() => expect(friendsClient.list).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(partyClient.current).toHaveBeenCalledOnce());
    expect(container.textContent).toContain("Start a party");
    expect(container.textContent).toContain("Add a friend by player ID");
  });

  it("opens account achievement progress from the progression screen", async () => {
    dependencies.createProgressionClient.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        progression: {
          level: 2,
          lifetime_xp: 500,
          xp_into_level: 0,
          xp_for_next_level: 600,
        },
        curve: [],
      }),
      getAchievements: vi.fn().mockResolvedValue([
        {
          code: "first-hand",
          name: "First Hand",
          description: "Complete your first public hand.",
          current: 1,
          goal: 1,
          xp_reward: 100,
          eligible: true,
          unlocked: true,
        },
      ]),
    });
    await enterLobby(false);

    const progressionButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Open progression"]',
    );
    await act(async () => {
      progressionButton?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(container.querySelector(".achievement-entry")).not.toBeNull());

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".achievement-entry")?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(container.textContent).toContain("First Hand"));

    expect(container.textContent).toContain("Only completed public human hands");
    expect(container.textContent).toContain("Back to Progress");
  });
});
