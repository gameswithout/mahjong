import { describe, expect, it } from "vitest";

import {
  MINIMUM_RATE_SAMPLE,
  createPlayerStatsClient,
  PlayerStatsError,
  readStatValues,
  summarisePlayerStats,
  STAT_DEALT_IN,
  STAT_HANDS,
  STAT_TING,
  STAT_WINS,
  STAT_ZIMO,
} from "./player-stats";

describe("summarisePlayerStats", () => {
  const played = (extra: Record<string, number> = {}) => ({
    [STAT_HANDS]: 100,
    [STAT_WINS]: 25,
    [STAT_ZIMO]: 10,
    [STAT_DEALT_IN]: 30,
    [STAT_TING]: 60,
    ...extra,
  });

  it("takes each rate against the denominator that makes it meaningful", () => {
    const summary = summarisePlayerStats(played());

    // Win, deal-in and Ting are shares of every hand played.
    expect(summary.winRate.ratio).toBeCloseTo(0.25);
    expect(summary.dealInRate.ratio).toBeCloseTo(0.3);
    expect(summary.tingRate.ratio).toBeCloseTo(0.6);
    // Zimo share is a share of wins — "how often does a win come by
    // self-draw" — not of hands played.
    expect(summary.zimoShare.ratio).toBeCloseTo(10 / 25);
    expect(summary.zimoShare.denominator).toBe(25);
    expect(summary.zimoShare.denominatorLabel).toBe("wins");
  });

  // A percentage from four hands describes the shuffle, not the player.
  it("withholds a ratio until the sample earns it", () => {
    const thin = summarisePlayerStats({ [STAT_HANDS]: MINIMUM_RATE_SAMPLE - 1, [STAT_WINS]: 4 });
    expect(thin.winRate.ratio).toBeNull();
    // The counts are still there, so the screen can show them instead.
    expect(thin.winRate.numerator).toBe(4);
    expect(thin.winRate.denominator).toBe(MINIMUM_RATE_SAMPLE - 1);

    const earned = summarisePlayerStats({ [STAT_HANDS]: MINIMUM_RATE_SAMPLE, [STAT_WINS]: 4 });
    expect(earned.winRate.ratio).toBeCloseTo(4 / MINIMUM_RATE_SAMPLE);
  });

  // Each rate has its own denominator, so a player with plenty of hands but
  // few wins still gets no Zimo share.
  it("gates each rate on its own denominator", () => {
    const summary = summarisePlayerStats({ [STAT_HANDS]: 200, [STAT_WINS]: 3, [STAT_ZIMO]: 2 });
    expect(summary.winRate.ratio).not.toBeNull();
    expect(summary.zimoShare.ratio).toBeNull();
  });

  it("reads a missing stat as a real zero", () => {
    // A player who has never dealt in has no stat item at all; that is a zero,
    // not a failure.
    const summary = summarisePlayerStats({ [STAT_HANDS]: 40, [STAT_WINS]: 10 });
    expect(summary.dealInRate.numerator).toBe(0);
    expect(summary.dealInRate.ratio).toBe(0);
    expect(summary.bestHandTai).toBe(0);
  });

  it("never divides by zero for a player who has not played", () => {
    const summary = summarisePlayerStats({});
    expect(summary.hasPlayed).toBe(false);
    for (const rate of [summary.winRate, summary.zimoShare, summary.dealInRate, summary.tingRate]) {
      expect(rate.ratio).toBeNull();
      expect(Number.isNaN(rate.numerator / rate.denominator || 0)).toBe(false);
    }
  });
});

describe("readStatValues", () => {
  it("reads stat codes and values out of an AGS page", () => {
    expect(
      readStatValues({ statistics: [{ stat_code: "public-hands-won", value: 12 }] }),
    ).toEqual({ "public-hands-won": 12 });
  });

  // protojson drops a zero double, so an untouched counter arrives as a bare
  // stat code. Verified against the live service, which returns exactly this
  // for a player who has not played.
  it("reads a value-less entry as the zero protojson omitted", () => {
    expect(readStatValues({ statistics: [{ stat_code: "public-hands-dealt-in" }] })).toEqual({
      "public-hands-dealt-in": 0,
    });
  });

  it("skips entries it does not understand rather than failing the screen", () => {
    const values = readStatValues({
      statistics: [
        { stat_code: "public-hands-won", value: 12 },
        { value: 5 },
        null,
        "nonsense",
      ],
    });
    expect(values).toEqual({ "public-hands-won": 12 });
  });

  it("treats an empty or malformed body as no statistics", () => {
    expect(readStatValues({ statistics: [] })).toEqual({});
    expect(readStatValues({})).toEqual({});
    expect(readStatValues(null)).toEqual({});
  });
});

describe("createPlayerStatsClient", () => {
  const options = { url: "https://match.test/mahjong", namespace: "gameswithout-mahjong" };

  it("asks the match service for its own player's stats, by token rather than by id", async () => {
    let requested = "";
    let auth = "";
    const client = createPlayerStatsClient("player-token", {
      ...options,
      fetchImpl: (async (url: string, init?: RequestInit) => {
        requested = String(url);
        auth = new Headers(init?.headers).get("Authorization") ?? "";
        return new Response(JSON.stringify({ statistics: [{ stat_code: "public-hands-completed", value: 30 }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    });

    const summary = await client.get();
    expect(summary.handsPlayed).toBe(30);
    expect(requested).toBe("https://match.test/mahjong/v1/namespaces/gameswithout-mahjong/statistics");
    expect(auth).toBe("Bearer player-token");
  });

  it("asks the player to sign in again on a 401 rather than showing zeroes", async () => {
    const client = createPlayerStatsClient("stale-token", {
      ...options,
      fetchImpl: (async () => new Response("", { status: 401 })) as typeof fetch,
    });
    await expect(client.get()).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("reports an unreachable service as network rather than empty statistics", async () => {
    const client = createPlayerStatsClient("player-token", {
      ...options,
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    });
    await expect(client.get()).rejects.toMatchObject({ code: "network" });
  });

  it("refuses to be built without the configuration it needs", () => {
    expect(() => createPlayerStatsClient("", options)).toThrow(PlayerStatsError);
    expect(() => createPlayerStatsClient("t", { ...options, namespace: "" })).toThrow(PlayerStatsError);
    expect(() => createPlayerStatsClient("t", { ...options, url: "" })).toThrow(PlayerStatsError);
  });
});
