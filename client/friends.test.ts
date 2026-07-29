import { describe, expect, it, vi } from "vitest";

import { createFriendsClient, FriendsError } from "./friends";

const OPTIONS = { url: "https://ags.test", namespace: "mahjong-test" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("friends client", () => {
  it("refuses to build without configuration", () => {
    expect(() => createFriendsClient("", OPTIONS)).toThrow(FriendsError);
    expect(() => createFriendsClient("token", { ...OPTIONS, namespace: "" })).toThrow(FriendsError);
  });

  it("merges presence into the friend list", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/presence/")) {
        return jsonResponse({
          data: [
            { userId: "alice", availability: 1, activity: "In the lobby" },
            { userId: "bob", availability: 2 },
          ],
        });
      }
      return jsonResponse({ friendIds: ["alice", "bob", "carol"] });
    }) as unknown as typeof fetch;

    const friends = await createFriendsClient("token", { ...OPTIONS, fetchImpl }).list();

    expect(friends.map((f) => f.userId)).toContain("carol");
    expect(friends.find((f) => f.userId === "alice")?.presence).toBe("online");
    expect(friends.find((f) => f.userId === "alice")?.activity).toBe("In the lobby");
    expect(friends.find((f) => f.userId === "bob")?.presence).toBe("busy");
    // A friend absent from the presence response is still a friend.
    expect(friends.find((f) => f.userId === "carol")?.presence).toBe("offline");
  });

  it("keeps the friend list when presence fails", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/presence/")) {
        throw new TypeError("network down");
      }
      return jsonResponse({ friendIds: ["alice"] });
    }) as unknown as typeof fetch;

    // Presence is decoration; losing it must not lose the list.
    const friends = await createFriendsClient("token", { ...OPTIONS, fetchImpl }).list();
    expect(friends).toEqual([{ userId: "alice", presence: "offline" }]);
  });

  it("sorts online friends first, then stably by id", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/presence/")) {
        return jsonResponse({
          data: [
            { userId: "zoe", availability: 1 },
            { userId: "adam", availability: 0 },
          ],
        });
      }
      return jsonResponse({ friendIds: ["adam", "zoe", "beth"] });
    }) as unknown as typeof fetch;

    const friends = await createFriendsClient("token", { ...OPTIONS, fetchImpl }).list();
    // zoe is online so leads; the two offline friends follow in id order, so
    // the list does not reshuffle between polls.
    expect(friends.map((f) => f.userId)).toEqual(["zoe", "adam", "beth"]);
  });

  it("treats an unknown availability as offline", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/presence/")) {
        return jsonResponse({ data: [{ userId: "alice", availability: 99 }] });
      }
      return jsonResponse({ friendIds: ["alice"] });
    }) as unknown as typeof fetch;

    // Showing someone as available when they are not is the failure a player
    // actually notices.
    const friends = await createFriendsClient("token", { ...OPTIONS, fetchImpl }).list();
    expect(friends[0].presence).toBe("offline");
  });

  it("reads request queues in both shapes AGS returns", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/incoming")) {
        return jsonResponse({ data: [{ friendId: "alice", requestedAt: "2026-07-29T00:00:00Z" }] });
      }
      return jsonResponse({ friendIds: ["bob"] });
    }) as unknown as typeof fetch;

    const client = createFriendsClient("token", { ...OPTIONS, fetchImpl });
    expect(await client.incoming()).toEqual([
      { userId: "alice", requestedAt: "2026-07-29T00:00:00Z" },
    ]);
    expect(await client.outgoing()).toEqual([{ userId: "bob" }]);
  });

  it("names the rate limit rather than reporting a generic failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 429)) as unknown as typeof fetch;
    const client = createFriendsClient("token", { ...OPTIONS, fetchImpl });

    // §10.6 caps requests at 20/day and 5/min. A player who hits that has done
    // nothing wrong and should be told, not left to retry into the same wall.
    await expect(client.sendRequest("alice")).rejects.toMatchObject({
      code: "rate_limited",
    });
    await expect(client.sendRequest("alice")).rejects.toThrow(/too many friend requests/i);
  });

  it("maps auth and not-found distinctly", async () => {
    for (const [status, code] of [
      [401, "unauthenticated"],
      [403, "forbidden"],
      [404, "not_found"],
      [503, "network"],
    ] as const) {
      const fetchImpl = vi.fn(async () => jsonResponse({}, status)) as unknown as typeof fetch;
      const client = createFriendsClient("token", { ...OPTIONS, fetchImpl });
      await expect(client.accept("alice")).rejects.toMatchObject({ code });
    }
  });

  it("sends the friend id AGS expects on every mutation", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const client = createFriendsClient("token", { ...OPTIONS, fetchImpl });
    await client.sendRequest("alice");
    await client.accept("bob");
    await client.reject("carol");
    await client.cancel("dave");
    await client.unfriend("erin");

    expect(calls.map((c) => c.url.split("/me")[1])).toEqual([
      "/request",
      "/request/accept",
      "/request/reject",
      "/request/cancel",
      "/unfriend",
    ]);
    expect(calls.map((c) => (c.body as { friendId: string }).friendId)).toEqual([
      "alice",
      "bob",
      "carol",
      "dave",
      "erin",
    ]);
  });
});

describe("live AGS response shapes", () => {
  it("reads friendIDs, the spelling the live service actually uses", async () => {
    // Verified against the live namespace 2026-07-29. Getting this wrong is
    // silent: the request succeeds and the list is empty, which is
    // indistinguishable from having no friends.
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/presence/")) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({
        friendIDs: ["0bb75900554f42d38d32e06829279771"],
        friends: [{ userId: "0bb75900554f42d38d32e06829279771", platformId: "" }],
        paging: { previous: "", next: "" },
      });
    }) as unknown as typeof fetch;

    const friends = await createFriendsClient("token", { ...OPTIONS, fetchImpl }).list();
    expect(friends.map((f) => f.userId)).toEqual(["0bb75900554f42d38d32e06829279771"]);
  });

  it("reads incoming requests from friendIDs too", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        friendIDs: ["2c4cea1269fa41e78c53bec15bf7648d"],
        paging: { previous: "", next: "" },
      }),
    ) as unknown as typeof fetch;

    const incoming = await createFriendsClient("token", { ...OPTIONS, fetchImpl }).incoming();
    expect(incoming).toEqual([{ userId: "2c4cea1269fa41e78c53bec15bf7648d" }]);
  });

  it("falls back to the friends array when only that is present", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/presence/")) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({ friends: [{ userId: "alice", platformId: "" }] });
    }) as unknown as typeof fetch;

    const friends = await createFriendsClient("token", { ...OPTIONS, fetchImpl }).list();
    expect(friends.map((f) => f.userId)).toEqual(["alice"]);
  });
});
