import { describe, expect, it } from "vitest";

import type { AccelByteSDK } from "@accelbyte/sdk";

import { createMatchmakingClient } from "./matchmaking";

function fakeSdk(
  get: (url: string) => Promise<{ data: unknown }>,
  post: (url: string, body?: unknown) => Promise<{ data: unknown }>,
  remove: (url: string) => Promise<{ data: unknown }> = async () => ({ data: {} }),
): AccelByteSDK {
  return {
    assembly: () => ({ axiosInstance: { get, post, delete: remove } }),
  } as unknown as AccelByteSDK;
}

describe("createMatchmakingClient", () => {
  it("creates a ticket with the pool and safe default payload", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const client = createMatchmakingClient(
      fakeSdk(
        async () => ({ data: {} }),
        async (url, body) => {
          calls.push({ url, body });
          return { data: { matchTicketID: "ticket-123", queueTime: 7 } };
        },
      ),
      "gameswithout-mahjong",
      { matchPool: "mahjong-test-pool" },
    );

    await expect(client.createTicket()).resolves.toEqual({
      ticketId: "ticket-123",
      queueTime: 7,
      isActive: undefined,
      matchFound: undefined,
      sessionId: undefined,
    });
    expect(calls).toEqual([
      {
        url: "/match2/v1/namespaces/gameswithout-mahjong/match-tickets",
        body: {
          attributes: {},
          matchPool: "mahjong-test-pool",
          sessionID: "",
        },
      },
    ]);
  });

  it("reads match status and cancels by ticket ID", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const client = createMatchmakingClient(
      fakeSdk(
        async (url) => {
          calls.push({ method: "GET", url });
          return { data: { sessionID: "session-123", matchFound: false, isActive: true } };
        },
        async () => ({ data: {} }),
        async (url) => {
          calls.push({ method: "DELETE", url });
          return { data: {} };
        },
      ),
      "gameswithout-mahjong",
      { matchPool: "mahjong-test-pool" },
    );

    await expect(client.getTicket("ticket-123")).resolves.toEqual({
      ticketId: "ticket-123",
      isActive: true,
      matchFound: false,
      sessionId: "session-123",
      queueTime: undefined,
    });
    await client.cancelTicket("ticket-123");
    expect(calls).toEqual([
      {
        method: "GET",
        url: "/match2/v1/namespaces/gameswithout-mahjong/match-tickets/ticket-123",
      },
      {
        method: "DELETE",
        url: "/match2/v1/namespaces/gameswithout-mahjong/match-tickets/ticket-123",
      },
    ]);
  });

  it("maps forbidden responses without exposing response data", async () => {
    const client = createMatchmakingClient(
      fakeSdk(
        async () => {
          throw { response: { status: 403, data: { access_token: "secret" } } };
        },
        async () => ({ data: {} }),
      ),
      "gameswithout-mahjong",
      { matchPool: "mahjong-test-pool" },
    );

    await expect(client.getTicket("ticket-123")).rejects.toMatchObject({
      code: "forbidden",
      message: "AGS denied access to matchmaking.",
    });
  });

  it("rejects a create response without a ticket ID", async () => {
    const client = createMatchmakingClient(
      fakeSdk(async () => ({ data: {} }), async () => ({ data: { queueTime: 1 } })),
      "gameswithout-mahjong",
      { matchPool: "mahjong-test-pool" },
    );

    await expect(client.createTicket()).rejects.toMatchObject({
      code: "invalid_response",
      message: "AGS did not return a matchmaking ticket ID.",
    });
  });

  it("rejects an empty ticket detail response", async () => {
    const client = createMatchmakingClient(
      fakeSdk(async () => ({ data: {} }), async () => ({ data: {} })),
      "gameswithout-mahjong",
      { matchPool: "mahjong-test-pool" },
    );

    await expect(client.getTicket("ticket-123")).rejects.toMatchObject({
      code: "invalid_response",
      message: "AGS returned an invalid matchmaking ticket.",
    });
  });
});
