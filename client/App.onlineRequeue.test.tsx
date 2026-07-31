import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JadeAccount, SeatView } from "../protocol/envelope";
import type { BrowserIam } from "./iam";
import { JadeError } from "./jade";
import { SessionLookupError, type SessionClient } from "./session";
import type { MatchRuntimeConnection, MatchRuntimeConnectionOptions } from "./match-runtime";

const dependencies = vi.hoisted(() => ({
  createFriendsClient: vi.fn(),
  createJadeClient: vi.fn(),
  createProgressionClient: vi.fn(),
  createLobbyConnection: vi.fn(),
  createMatchRuntimeConnection: vi.fn(),
  createMatchmakingClient: vi.fn(),
  createPartyClient: vi.fn(),
  createSessionClient: vi.fn(),
}));

vi.mock("./friends", async () => {
  const actual = await vi.importActual<typeof import("./friends")>("./friends");
  return { ...actual, createFriendsClient: dependencies.createFriendsClient };
});

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
      rotationMatchPool: "rotation",
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

vi.mock("./matchmaking", async () => {
  const actual = await vi.importActual<typeof import("./matchmaking")>("./matchmaking");
  return { ...actual, createMatchmakingClient: dependencies.createMatchmakingClient };
});

vi.mock("./party", async () => {
  const actual = await vi.importActual<typeof import("./party")>("./party");
  return { ...actual, createPartyClient: dependencies.createPartyClient };
});

vi.mock("./session", async () => {
  const actual = await vi.importActual<typeof import("./session")>("./session");
  return { ...actual, createSessionClient: dependencies.createSessionClient };
});

import { App } from "./App";

const ELIGIBLE_ACCOUNT: JadeAccount = {
  currency_code: "JADE",
  balance: 5_000,
  reserved: 0,
  available: 5_000,
  eligible: true,
  minimum_balance: 1_000,
  stake_per_tai: 10,
  debit_cap: 300,
  wallet_sync_status: "synced",
};

// A hand that ended with four humans seated: no is_bot marker anywhere, which
// is how the app distinguishes a staked table from AI Practice.
function completedOnlineView(matchId: string, account: JadeAccount): SeatView {
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
      { seat: "S", hand_count: 0 },
      { seat: "W", hand_count: 0 },
      { seat: "N", hand_count: 0 },
    ],
    wall: { remaining: 16, drawable_remaining: 0, reserve_remaining: 16 },
    hand_result: { kind: "exhaustive_draw", winners: [] },
    settlement: { transfers: [], net: {}, total_credits: 0, total_debits: 0 },
    jade_account: account,
  };
}

function completedRotationView(matchId: string): SeatView {
  return {
    ...completedOnlineView(matchId, ELIGIBLE_ACCOUNT),
    jade_account: undefined,
    rotation: {
      hand_number: 4,
      hands_played: 4,
      continuations: 0,
      dealer_user_id: "guest-4",
      seats_dealt: 4,
      time_limit_at: "2026-07-25T01:00:00Z",
      complete: true,
      reason: "rotation_complete",
      standings: [
        { user_id: "guest-1", position: "E", wind: "S", table_points: 12, has_dealt: true },
        { user_id: "guest-2", position: "S", wind: "W", table_points: 4, has_dealt: true },
        { user_id: "guest-3", position: "W", wind: "N", table_points: -5, has_dealt: true },
        {
          user_id: "guest-4",
          position: "N",
          wind: "E",
          table_points: -11,
          dealing: true,
          has_dealt: true,
        },
      ],
      placements: [
        { user_id: "guest-1", position: 1, table_points: 12 },
        { user_id: "guest-2", position: 2, table_points: 4 },
        { user_id: "guest-3", position: 3, table_points: -5 },
        { user_id: "guest-4", position: 4, table_points: -11 },
      ],
      placement_xp_award: {
        award_id: "rotation-placement-1",
        source: "full_rotation_placement",
        total: 400,
        components: [{ code: "placement_1", label: "1st place", amount: 400 }],
      },
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
    for (let flush = 0; flush < 6; flush += 1) {
      await Promise.resolve();
    }
  });
}

describe("App online matchmaking and requeue", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let calls: string[];
  let sessionClient: SessionClient;
  let getAccount: ReturnType<typeof vi.fn>;
  let createTicket: ReturnType<typeof vi.fn>;
  let reserveJade: ReturnType<typeof vi.fn>;
  let releaseJade: ReturnType<typeof vi.fn>;
  let sendFriendRequest: ReturnType<typeof vi.fn>;
  let tableNumber: number;
  let completedView: (matchId: string) => SeatView;

  const iam = {
    loginAsGuest: vi.fn().mockResolvedValue({
      userId: "guest-1",
      deviceId: "device-1",
      isGuest: true,
    }),
    getAuthenticatedSdk: vi.fn().mockReturnValue({}),
    getAccessToken: vi.fn().mockReturnValue("guest-token"),
  } as unknown as BrowserIam;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    calls = [];
    tableNumber = 0;
    completedView = (matchId) => completedOnlineView(matchId, ELIGIBLE_ACCOUNT);

    getAccount = vi.fn().mockResolvedValue(ELIGIBLE_ACCOUNT);
    reserveJade = vi.fn().mockResolvedValue({
      account: { ...ELIGIBLE_ACCOUNT, reserved: 300, available: 4_700 },
      reservation: { reservation_id: "reserve-1", amount: 300, status: "active" },
    });
    releaseJade = vi.fn().mockResolvedValue(ELIGIBLE_ACCOUNT);
    sendFriendRequest = vi.fn().mockResolvedValue(undefined);
    dependencies.createFriendsClient.mockReturnValue({
      list: vi.fn().mockResolvedValue([]),
      incoming: vi.fn().mockResolvedValue([]),
      outgoing: vi.fn().mockResolvedValue([]),
      sendRequest: sendFriendRequest,
      accept: vi.fn(),
      reject: vi.fn(),
      cancel: vi.fn(),
      unfriend: vi.fn(),
    });
    dependencies.createPartyClient.mockReturnValue({
      current: vi.fn().mockResolvedValue(null),
    });
    dependencies.createJadeClient.mockReturnValue({
      getAccount,
      reserve: reserveJade,
      release: releaseJade,
    });
    dependencies.createProgressionClient.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        progression: { level: 1, lifetime_xp: 0 },
        curve: [],
      }),
      awardOnboarding: vi.fn(),
    });

    createTicket = vi.fn(async () => {
      tableNumber += 1;
      calls.push(`ticket:${tableNumber}`);
      return {
        ticketId: `ticket-${tableNumber}`,
        matchFound: true,
        sessionId: `table-${tableNumber}`,
      };
    });
    dependencies.createMatchmakingClient.mockReturnValue({
      createTicket,
      getTicket: vi.fn(),
      cancelTicket: vi.fn(),
    });

    sessionClient = {
      listMySessions: vi.fn().mockResolvedValue([]),
      getSession: vi.fn(async (sessionId: string) => ({
        sessionId,
        status: "JOINED",
        members: [
          { userId: "guest-1" },
          { userId: "guest-2" },
          { userId: "guest-3" },
          { userId: "guest-4" },
        ],
      })),
      joinSession: vi.fn(async (sessionId: string) => {
        calls.push(`join:${sessionId}`);
      }),
      createSession: vi.fn(),
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
            server_time: "2026-07-25T00:00:00Z",
            user_id: "guest-1",
          }),
          join: vi.fn((matchId: string) => {
            calls.push(`connect:${matchId}`);
            queueMicrotask(() => {
              if (!closed) {
                options.onJoined?.({
                  match_id: matchId,
                  seat: "E",
                  view: completedView(matchId),
                });
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

  async function reachCompletedStakedHand(): Promise<void> {
    act(() => root.render(<App iam={iam} />));
    await clickAndFlush(container, "Continue as Guest");
    await vi.waitFor(() => expect(container.textContent).toContain("Solo Practice"));
    await clickAndFlush(container, "Find a table");
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Hand result"]')).not.toBeNull());
  }

  async function reachCompletedRotation(): Promise<void> {
    vi.mocked(iam.loginAsGuest).mockResolvedValueOnce({
      userId: "guest-1",
      deviceId: "device-1",
      isGuest: false,
    });
    completedView = completedRotationView;
    act(() => root.render(<App iam={iam} />));
    await clickAndFlush(container, "Continue as Guest");
    await vi.waitFor(() => expect(container.textContent).toContain("Find a rotation"));
    await clickAndFlush(container, "Find a rotation");
    await vi.waitFor(() => expect(container.textContent).toContain("Final standings"));
  }

  it("locks ranked Full Rotation for guest accounts", async () => {
    act(() => root.render(<App iam={iam} />));
    await clickAndFlush(container, "Continue as Guest");
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Create or sign in to a full account to enter ranked Full Rotation.",
      ),
    );

    expect(
      Array.from(container.querySelectorAll("button")).some(
        (candidate) => candidate.textContent === "Find a rotation",
      ),
    ).toBe(false);
  });

  it("queues and requeues completed Full Rotations without touching Jade", async () => {
    await reachCompletedRotation();

    expect(container.textContent).toContain("Final standings");
    expect(container.querySelector(".hand-result-play-again-note")).toBeNull();
    expect(button(container, "Play Again")).toBeInstanceOf(HTMLButtonElement);
    expect(reserveJade).not.toHaveBeenCalled();
    expect(releaseJade).not.toHaveBeenCalled();
    const accountReadsBeforeRequeue = getAccount.mock.calls.length;

    await clickAndFlush(container, "Play Again");
    await vi.waitFor(() => expect(calls).toContain("ticket:2"));

    expect(calls).toEqual([
      "ticket:1",
      "join:table-1",
      "connect:table-1",
      "leave:table-1",
      "ticket:2",
      "join:table-2",
      "connect:table-2",
    ]);
    expect(reserveJade).not.toHaveBeenCalled();
    expect(releaseJade).not.toHaveBeenCalled();
    expect(getAccount).toHaveBeenCalledTimes(accountReadsBeforeRequeue);
    expect(
      dependencies.createMatchmakingClient.mock.calls.map(
        ([, , config]) => config.matchPool,
      ),
    ).toEqual(["rotation", "rotation"]);
  });

  it("cancels a Full Rotation ticket in its own pool without releasing Jade", async () => {
    vi.mocked(iam.loginAsGuest).mockResolvedValueOnce({
      userId: "guest-1",
      deviceId: "device-1",
      isGuest: false,
    });
    const cancelTicket = vi.fn().mockResolvedValue(undefined);
    createTicket = vi.fn().mockResolvedValue({ ticketId: "rotation-ticket", isActive: true });
    dependencies.createMatchmakingClient.mockReturnValue({
      createTicket,
      getTicket: vi.fn(async () => ({ ticketId: "rotation-ticket", isActive: true })),
      cancelTicket,
    });

    act(() => root.render(<App iam={iam} />));
    await clickAndFlush(container, "Continue as Guest");
    await vi.waitFor(() => expect(container.textContent).toContain("Find a rotation"));
    await clickAndFlush(container, "Find a rotation");
    await vi.waitFor(() => expect(container.textContent).toContain("Full Rotation queue"));
    await clickAndFlush(container, "Cancel");

    await vi.waitFor(() => expect(container.textContent).not.toContain("Full Rotation queue"));
    expect(cancelTicket).toHaveBeenCalledWith("rotation-ticket");
    expect(releaseJade).not.toHaveBeenCalled();
    expect(
      dependencies.createMatchmakingClient.mock.calls.map(
        ([, , config]) => config.matchPool,
      ),
    ).toEqual(["rotation", "rotation"]);
  });

  it("offers a way out of a queue that has passed 90 seconds, releasing the reservation", async () => {
    // A ticket that never matches: four humans are required and none arrive.
    const cancelTicket = vi.fn().mockResolvedValue(undefined);
    createTicket = vi.fn(async () => {
      calls.push("ticket:1");
      return { ticketId: "ticket-1", isActive: true };
    });
    dependencies.createMatchmakingClient.mockReturnValue({
      createTicket,
      getTicket: vi.fn(async () => ({ ticketId: "ticket-1", isActive: true })),
      cancelTicket,
    });
    const release = vi.fn().mockResolvedValue(ELIGIBLE_ACCOUNT);
    dependencies.createJadeClient.mockReturnValue({
      getAccount,
      reserve: vi.fn().mockResolvedValue({
        account: { ...ELIGIBLE_ACCOUNT, reserved: 300, available: 4_700 },
        reservation: { reservation_id: "reserve-1", amount: 300, status: "active" },
      }),
      release,
    });
    sessionClient.createSession = vi.fn(async () => {
      calls.push("create:practice");
      return { sessionId: "practice-1", status: "JOINED", members: [{ userId: "guest-1" }] };
    });

    act(() => root.render(<App iam={iam} />));
    await clickAndFlush(container, "Continue as Guest");
    await vi.waitFor(() => expect(container.textContent).toContain("Solo Practice"));
    await clickAndFlush(container, "Find a table");
    await vi.waitFor(() => expect(container.textContent).toContain("Searching for players."));

    // Under 90 seconds the wait is reported without an escape hatch.
    expect(container.textContent).not.toContain("Practice instead");
    expect(button(container, "Practice vs Bots").disabled).toBe(true);

    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 91_000;
      // The lobby's one-second tick is what re-reads the clock; wait for one.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
      });
      await vi.waitFor(() => expect(container.textContent).toContain("Practice instead"));
      expect(container.textContent).toContain("taking longer than usual");

      await clickAndFlush(container, "Practice instead");
    } finally {
      Date.now = realNow;
    }

    // The ticket is canceled and the Jade released before the free hand starts;
    // otherwise a Practice hand would sit on a reservation it never needed.
    await vi.waitFor(() => expect(calls).toContain("create:practice"));
    expect(cancelTicket).toHaveBeenCalledWith("ticket-1");
    expect(release).toHaveBeenCalled();
    expect(calls.indexOf("create:practice")).toBeGreaterThan(calls.indexOf("ticket:1"));
  });

  it("does not start another table until a failed Jade release is retried", async () => {
    const cancelTicket = vi.fn().mockResolvedValue(undefined);
    createTicket = vi.fn().mockResolvedValue({ ticketId: "ticket-1", isActive: true });
    dependencies.createMatchmakingClient.mockReturnValue({
      createTicket,
      getTicket: vi.fn(async () => ({ ticketId: "ticket-1", isActive: true })),
      cancelTicket,
    });
    const release = vi
      .fn()
      .mockRejectedValueOnce(new JadeError("network", "Jade service could not be reached."))
      .mockResolvedValue(ELIGIBLE_ACCOUNT);
    dependencies.createJadeClient.mockReturnValue({
      getAccount,
      reserve: vi.fn().mockResolvedValue({
        account: { ...ELIGIBLE_ACCOUNT, reserved: 300, available: 4_700 },
        reservation: { reservation_id: "reserve-1", amount: 300, status: "active" },
      }),
      release,
    });
    sessionClient.createSession = vi.fn().mockResolvedValue({
      sessionId: "practice-1",
      status: "JOINED",
      members: [{ userId: "guest-1" }],
    });

    act(() => root.render(<App iam={iam} />));
    await clickAndFlush(container, "Continue as Guest");
    await vi.waitFor(() => expect(container.textContent).toContain("Solo Practice"));
    await clickAndFlush(container, "Find a table");
    await vi.waitFor(() => expect(container.textContent).toContain("Searching for players."));

    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 91_000;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
      });
      await clickAndFlush(container, "Practice instead");
    } finally {
      Date.now = realNow;
    }

    await vi.waitFor(() =>
      expect(container.textContent).toContain("your Jade reservation may still be held"),
    );
    expect(cancelTicket).toHaveBeenCalledWith("ticket-1");
    expect(sessionClient.createSession).not.toHaveBeenCalled();
    expect(button(container, "Practice vs Bots").disabled).toBe(true);
    expect(button(container, "Create test table").disabled).toBe(true);
    expect(button(container, "Retry releasing Jade")).toBeInstanceOf(HTMLButtonElement);
    expect(container.textContent).not.toContain("Retry matchmaking");

    await clickAndFlush(container, "Retry releasing Jade");
    await vi.waitFor(() => expect(button(container, "Practice vs Bots").disabled).toBe(false));
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("retries an unconfirmed cancellation instead of opening a second ticket", async () => {
    const cancelTicket = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary cancellation failure"))
      .mockResolvedValue(undefined);
    createTicket = vi.fn().mockResolvedValue({ ticketId: "ticket-1", isActive: true });
    dependencies.createMatchmakingClient.mockReturnValue({
      createTicket,
      getTicket: vi.fn(async () => ({ ticketId: "ticket-1", isActive: true })),
      cancelTicket,
    });
    const release = vi.fn().mockResolvedValue(ELIGIBLE_ACCOUNT);
    dependencies.createJadeClient.mockReturnValue({
      getAccount,
      reserve: vi.fn().mockResolvedValue({
        account: { ...ELIGIBLE_ACCOUNT, reserved: 300, available: 4_700 },
        reservation: { reservation_id: "reserve-1", amount: 300, status: "active" },
      }),
      release,
    });

    act(() => root.render(<App iam={iam} />));
    await clickAndFlush(container, "Continue as Guest");
    await vi.waitFor(() => expect(container.textContent).toContain("Solo Practice"));
    await clickAndFlush(container, "Find a table");
    await vi.waitFor(() => expect(container.textContent).toContain("Searching for players."));
    await clickAndFlush(container, "Cancel");

    await vi.waitFor(() =>
      expect(container.textContent).toContain("could not confirm that you left the queue"),
    );
    expect(createTicket).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(button(container, "Practice vs Bots").disabled).toBe(true);
    expect(button(container, "Retry leaving queue")).toBeInstanceOf(HTMLButtonElement);
    expect(container.textContent).not.toContain("Retry matchmaking");

    await clickAndFlush(container, "Retry leaving queue");
    await vi.waitFor(() => expect(button(container, "Practice vs Bots").disabled).toBe(false));
    expect(cancelTicket).toHaveBeenCalledTimes(2);
    expect(cancelTicket).toHaveBeenNthCalledWith(1, "ticket-1");
    expect(cancelTicket).toHaveBeenNthCalledWith(2, "ticket-1");
    expect(release).toHaveBeenCalledOnce();
    expect(createTicket).toHaveBeenCalledTimes(1);
  });

  it("offers Play Again on a staked result and states the stake before the click", async () => {
    await reachCompletedStakedHand();

    // The staked result must not read as a Practice result.
    expect(container.textContent).not.toContain("Practice result");
    expect(container.querySelector(".result-friends")).toBeNull();
    expect(button(container, "Play Again")).toBeInstanceOf(HTMLButtonElement);

    const note = container.querySelector(".hand-result-play-again-note");
    expect(note?.textContent).toContain("10 Jade per Tai");
    expect(note?.textContent).toContain("300 Jade maximum loss");
    // The note is announced with the button rather than floating unattached.
    expect(button(container, "Play Again").getAttribute("aria-describedby")).toBe("play-again-note");
  });

  it("lets a full account add only opponents from a completed matchmade hand", async () => {
    vi.mocked(iam.loginAsGuest).mockResolvedValueOnce({
      userId: "guest-1",
      deviceId: "device-1",
      isGuest: false,
    });

    await reachCompletedStakedHand();
    await vi.waitFor(() => expect(container.querySelector(".result-friends")).not.toBeNull());

    expect(container.textContent).toContain("3 opponents");
    expect(container.querySelector(".result-friends")?.textContent).not.toContain("guest-1");
    await clickAndFlush(container, "Add Friend");

    expect(sendFriendRequest).toHaveBeenCalledOnce();
    expect(sendFriendRequest).toHaveBeenCalledWith("guest-2");
    await vi.waitFor(() => expect(container.textContent).toContain("Request sent"));
  });

  it("releases the finished seat, re-checks Jade, then queues a fresh ticket", async () => {
    await reachCompletedStakedHand();
    expect(calls).toEqual(["ticket:1", "join:table-1", "connect:table-1"]);
    const accountReadsBeforeRequeue = getAccount.mock.calls.length;

    await clickAndFlush(container, "Play Again");
    await vi.waitFor(() => expect(calls).toContain("ticket:2"));

    // Order matters: the seat is released before a second reservation is taken,
    // and eligibility is re-read from the server in between.
    expect(calls).toEqual([
      "ticket:1",
      "join:table-1",
      "connect:table-1",
      "leave:table-1",
      "ticket:2",
      "join:table-2",
      "connect:table-2",
    ]);
    expect(getAccount.mock.calls.length).toBeGreaterThan(accountReadsBeforeRequeue);
  });

  it("explains an ineligible balance instead of queueing a doomed ticket", async () => {
    await reachCompletedStakedHand();
    // The hand just played took the balance below the entry requirement.
    getAccount.mockResolvedValue({
      ...ELIGIBLE_ACCOUNT,
      balance: 400,
      available: 400,
      eligible: false,
    });

    await clickAndFlush(container, "Play Again");
    await vi.waitFor(() => expect(container.textContent).toContain("600 short"));

    expect(calls).not.toContain("ticket:2");
    expect(container.textContent).toContain("1,000 Jade in your balance");
    // Retrying cannot succeed, so the retry affordance is withheld.
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (candidate) => candidate.textContent === "Retry matchmaking",
      ),
    ).toBe(false);
  });

  it("does not queue a new table while the finished seat is still held", async () => {
    await reachCompletedStakedHand();
    sessionClient.leaveSession = vi.fn(async () => {
      throw new SessionLookupError("network", "Session service could not be reached.");
    });

    await clickAndFlush(container, "Play Again");
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Session service could not be reached."),
    );

    // A stranded seat still holds its Jade reservation; taking a second one
    // would double-commit the player.
    expect(calls).not.toContain("ticket:2");
  });

  it("does not offer matchmaking requeue for a manually joined developer table", async () => {
    vi.mocked(iam.loginAsGuest).mockResolvedValueOnce({
      userId: "guest-1",
      deviceId: "device-1",
      isGuest: false,
    });
    sessionClient.createSession = vi.fn().mockResolvedValue({
      sessionId: "manual-table",
      status: "JOINED",
      members: [
        { userId: "guest-1" },
        { userId: "guest-2" },
        { userId: "guest-3" },
        { userId: "guest-4" },
      ],
    });

    act(() => root.render(<App iam={iam} />));
    await clickAndFlush(container, "Continue as Guest");
    await vi.waitFor(() => expect(container.textContent).toContain("Solo Practice"));
    await clickAndFlush(container, "Create test table");
    await vi.waitFor(() => expect(container.textContent).toContain("Session found"));
    await clickAndFlush(container, "Enter table");
    await vi.waitFor(() =>
      expect(container.querySelector('[aria-label="Hand result"]')).not.toBeNull(),
    );

    expect(container.textContent).not.toContain("Play Again");
    expect(container.querySelector(".result-friends")).toBeNull();
    expect(button(container, "Return to Lobby")).toBeInstanceOf(HTMLButtonElement);
    expect(createTicket).not.toHaveBeenCalled();
  });
});
