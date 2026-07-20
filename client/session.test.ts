import { describe, expect, it } from "vitest";

import type { AccelByteSDK } from "@accelbyte/sdk";

import { AI_PRACTICE_SESSION_ATTRIBUTES, createSessionClient } from "./session";

function fakeSdk(
  get: (url: string) => Promise<{ data: unknown }>,
  post: (url: string, body?: unknown) => Promise<{ data: unknown }> = async () => ({ data: {} }),
  remove: (url: string) => Promise<{ data: unknown }> = async () => ({ data: {} }),
): AccelByteSDK {
  return {
    assembly: () => ({ axiosInstance: { get, post, delete: remove } }),
  } as unknown as AccelByteSDK;
}

describe("createSessionClient", () => {
  it("maps the current player's session list and roster detail", async () => {
    const urls: string[] = [];
    const client = createSessionClient(
      fakeSdk(async (url) => {
        urls.push(url);
        if (url.includes("/users/me/")) {
          return {
            data: {
              paging: { total: 1 },
              data: [{ gameSessionId: "session-123", status: "JOINED" }],
            },
          };
        }

        return {
          data: {
            data: {
              gameSessionId: "session-123",
              status: "CONNECTED",
            members: [{ id: "guest-1", displayName: "Guest One", status: "CONNECTED" }],
            },
          },
        };
      }),
      "gameswithout-mahjong",
    );

    const sessions = await client.listMySessions();
    expect(sessions).toEqual([{ sessionId: "session-123", status: "JOINED", members: [] }]);

    await expect(client.getSession("session-123")).resolves.toEqual({
      sessionId: "session-123",
      status: "CONNECTED",
      members: [{ userId: "guest-1", displayName: "Guest One", status: "CONNECTED" }],
    });
    expect(urls).toEqual([
      "/session/v1/public/namespaces/gameswithout-mahjong/users/me/gamesessions",
      "/session/v1/public/namespaces/gameswithout-mahjong/gamesessions/session-123",
    ]);
  });

  it("returns an empty list without inventing a session", async () => {
    const client = createSessionClient(
      fakeSdk(async () => ({ data: { paging: { total: 0 }, data: [] } })),
      "gameswithout-mahjong",
    );

    await expect(client.listMySessions()).resolves.toEqual([]);
  });

  it("requires explicit create configuration", async () => {
    const client = createSessionClient(
      fakeSdk(async () => ({ data: {} })),
      "gameswithout-mahjong",
    );

    await expect(client.createSession()).rejects.toMatchObject({
      code: "configuration",
      message: "Session table configuration is incomplete. Restart the dev server after updating .env.",
    });
  });

  it("maps forbidden responses to a safe error", async () => {
    const client = createSessionClient(
      fakeSdk(async () => {
        throw {
          response: { status: 403, data: { errorMessage: "secret-access-token" } },
        };
      }),
      "gameswithout-mahjong",
    );

    await expect(client.listMySessions()).rejects.toMatchObject({
      code: "forbidden",
      message: "AGS denied access to your sessions.",
    });
  });

  it("rejects a non-empty malformed response", async () => {
    const client = createSessionClient(
      fakeSdk(async () => ({ data: { data: [{ unexpected: true }] } })),
      "gameswithout-mahjong",
    );

    await expect(client.listMySessions()).rejects.toMatchObject({
      code: "invalid_response",
      message: "AGS returned an invalid session list.",
    });
  });

  it("creates, joins, and leaves a test session with typed endpoints", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const client = createSessionClient(
      fakeSdk(
        async (url) => ({
          data: {
            gameSessionId: "session-123",
            status: "JOINED",
            members: [],
          },
        }),
        async (url, body) => {
          calls.push({ method: "POST", url, body });
          return {
            data: {
              gameSessionId: "session-123",
              status: "JOINED",
              members: [],
            },
          };
        },
        async (url) => {
          calls.push({ method: "DELETE", url });
          return { data: {} };
        },
      ),
      "gameswithout-mahjong",
      {
        configurationName: "mahjong-test-none",
        clientVersion: "web-0.0.0",
        joinability: "OPEN",
        maxPlayers: 4,
        minPlayers: 1,
        type: "NONE",
      },
    );

    await expect(client.createSession()).resolves.toMatchObject({ sessionId: "session-123" });
    await client.joinSession("session-123");
    await client.leaveSession("session-123");

    expect(calls).toEqual([
      {
        method: "POST",
        url: "/session/v1/public/namespaces/gameswithout-mahjong/gamesession",
        body: {
          attributes: {},
          backfillTicketID: "",
          clientVersion: "web-0.0.0",
          configurationName: "mahjong-test-none",
          deployment: "",
          inactiveTimeout: 60,
          inviteTimeout: 60,
          joinability: "OPEN",
          matchPool: "",
          maxPlayers: 4,
          minPlayers: 1,
          requestedRegions: [],
          serverName: "",
          teams: [],
          textChat: false,
          ticketIDs: [],
          type: "NONE",
        },
      },
      {
        method: "POST",
        url: "/session/v1/public/namespaces/gameswithout-mahjong/gamesessions/session-123/join",
      },
      {
        method: "DELETE",
        url: "/session/v1/public/namespaces/gameswithout-mahjong/gamesessions/session-123/leave",
      },
    ]);
  });

  it("sends AI_PRACTICE_SESSION_ATTRIBUTES through to the create-session request body", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const client = createSessionClient(
      fakeSdk(
        async () => ({ data: { gameSessionId: "session-solo", status: "JOINED", members: [] } }),
        async (url, body) => {
          calls.push({ url, body });
          return { data: { gameSessionId: "session-solo", status: "JOINED", members: [] } };
        },
      ),
      "gameswithout-mahjong",
      {
        configurationName: "mahjong-test-none",
        clientVersion: "web-0.0.0",
        joinability: "OPEN",
        maxPlayers: 4,
        minPlayers: 1,
        type: "NONE",
      },
    );

    await expect(client.createSession(AI_PRACTICE_SESSION_ATTRIBUTES)).resolves.toMatchObject({
      sessionId: "session-solo",
    });
    expect(calls).toHaveLength(1);
    expect((calls[0].body as { attributes: unknown }).attributes).toEqual({ ai_practice: "true" });
  });
});
