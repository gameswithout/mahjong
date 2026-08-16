import { describe, expect, it, vi } from "vitest";

import {
  BotPersonaCatalogError,
  createBotPersonaCatalogClient,
  readBotPersonaCards,
} from "./bot-persona-catalog";

const sparrowSnakeCase = {
  id: "swift-sparrow",
  name: "Swift Sparrow",
  style_tag: "Rush",
  tagline: "Calls early, builds wide waits, and races to finish.",
  glyph: "雀",
  bars: { pace: 5, value: 1, caution: 2, calling: 5, concealment: 1 },
  strength: "Nobody reaches a finished hand sooner.",
  weakness: "Opening early costs flexibility.",
};

describe("readBotPersonaCards", () => {
  it("parses the snake_case shape protojson actually sends", () => {
    const cards = readBotPersonaCards({ personas: [sparrowSnakeCase] });
    expect(cards).toEqual([
      {
        id: "swift-sparrow",
        name: "Swift Sparrow",
        styleTag: "Rush",
        tagline: "Calls early, builds wide waits, and races to finish.",
        glyph: "雀",
        bars: { pace: 5, value: 1, caution: 2, calling: 5, concealment: 1 },
        strength: "Nobody reaches a finished hand sooner.",
        weakness: "Opening early costs flexibility.",
      },
    ]);
  });

  it("also accepts a camelCase encoder", () => {
    const camel = { ...sparrowSnakeCase, styleTag: "Rush", style_tag: undefined };
    const cards = readBotPersonaCards({ personas: [camel] });
    expect(cards[0]?.styleTag).toBe("Rush");
  });

  it("skips a row missing an id or name rather than crashing the catalog", () => {
    const cards = readBotPersonaCards({
      personas: [{ ...sparrowSnakeCase, id: "" }, sparrowSnakeCase],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.id).toBe("swift-sparrow");
  });

  it("defaults every bar to zero when the response omits them", () => {
    const cards = readBotPersonaCards({
      personas: [{ id: "x", name: "X" }],
    });
    expect(cards[0]?.bars).toEqual({ pace: 0, value: 0, caution: 0, calling: 0, concealment: 0 });
  });

  it("returns an empty catalog rather than throwing on a malformed body", () => {
    expect(readBotPersonaCards(null)).toEqual([]);
    expect(readBotPersonaCards({})).toEqual([]);
    expect(readBotPersonaCards({ personas: "not an array" })).toEqual([]);
  });
});

describe("createBotPersonaCatalogClient", () => {
  const options = { url: "https://match.example", namespace: "gameswithout-mahjong" };

  it("requests the bot-personas endpoint with a bearer token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ personas: [sparrowSnakeCase] }),
    });
    const client = createBotPersonaCatalogClient("token-1", { ...options, fetchImpl });

    const cards = await client.list();

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://match.example/v1/namespaces/gameswithout-mahjong/bot-personas",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer token-1" },
      }),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.id).toBe("swift-sparrow");
  });

  it("throws unauthenticated on a 401 rather than a generic network error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const client = createBotPersonaCatalogClient("token-1", { ...options, fetchImpl });

    await expect(client.list()).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("rejects construction without a token or configuration", () => {
    expect(() => createBotPersonaCatalogClient("", options)).toThrow(BotPersonaCatalogError);
    expect(() => createBotPersonaCatalogClient("t", { ...options, url: "" })).toThrow(
      BotPersonaCatalogError,
    );
    expect(() => createBotPersonaCatalogClient("t", { ...options, namespace: "" })).toThrow(
      BotPersonaCatalogError,
    );
  });
});
