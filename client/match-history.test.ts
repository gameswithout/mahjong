import { describe, expect, it, vi } from "vitest";

import { getMatchHistory } from "./match-history";

describe("getMatchHistory", () => {
  it("bypasses browser caches when hydrating a returning player", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ matches: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await getMatchHistory("player-token", {
      url: "https://match.example.test/mahjong",
      namespace: "mahjong-test",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://match.example.test/mahjong/v1/namespaces/mahjong-test/match-history?limit=30",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
