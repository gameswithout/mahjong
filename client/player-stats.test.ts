import { describe, expect, it } from "vitest";

import {
  MINIMUM_RATE_SAMPLE,
  createPlayerStatsClient,
  PlayerStatsError,
  readStatValues,
  reconcilePlayerStatsWithHistory,
  summarisePlayerStats,
  STAT_DEALT_IN,
  STAT_HANDS,
  STAT_TING,
  STAT_WINS,
  STAT_ZIMO,
  STAT_DISCARDS,
  STAT_DISCARDS_EFFICIENT,
  STAT_DRAWN,
  STAT_OPENED,
  STAT_TING_AT_DRAW,
  STAT_TOTAL_TAI,
} from "./player-stats";

describe("statistics added for the P2.3 dashboard", () => {
  const base = {
    [STAT_HANDS]: 100,
    [STAT_WINS]: 25,
    [STAT_TOTAL_TAI]: 150,
    [STAT_OPENED]: 40,
    [STAT_DRAWN]: 30,
    [STAT_TING_AT_DRAW]: 12,
    [STAT_DISCARDS]: 900,
    [STAT_DISCARDS_EFFICIENT]: 630,
    "hands-seat-east": 25,
    "hands-won-seat-east": 9,
    "hands-seat-north": 25,
    "hands-won-seat-north": 4,
  };

  it("divides average Tai by wins, not by hands played", () => {
    const summary = summarisePlayerStats(base);
    // 150 Tai over 25 wins. Dividing by the 100 hands played would report
    // 1.5 and describe a player who wins far more often than they do.
    expect(summary.averageWinTai.mean).toBe(6);
    expect(summary.averageWinTai.countLabel).toBe("wins");
  });

  it("measures the call rate per hand and tenpai against drawn hands only", () => {
    const summary = summarisePlayerStats(base);
    expect(summary.callRate.ratio).toBeCloseTo(0.4);
    expect(summary.callRate.denominatorLabel).toBe("hands played");
    // 12 of the 30 hands that reached a draw, not 12 of 100.
    expect(summary.tenpaiAtDrawRate.ratio).toBeCloseTo(0.4);
    expect(summary.tenpaiAtDrawRate.denominatorLabel).toBe("drawn hands");
  });

  it("measures tile efficiency against discards made", () => {
    const summary = summarisePlayerStats(base);
    expect(summary.tileEfficiency.ratio).toBeCloseTo(0.7);
    expect(summary.tileEfficiency.denominatorLabel).toBe("discards");
  });

  it("splits by seat and keeps each seat's own denominator", () => {
    const summary = summarisePlayerStats(base);
    const east = summary.seatSplits.find((split) => split.seat === "E");
    const north = summary.seatSplits.find((split) => split.seat === "N");
    expect(east?.winRate.ratio).toBeCloseTo(0.36);
    expect(north?.winRate.ratio).toBeCloseTo(0.16);
    // A seat never played reads as zero hands, not as a zero win rate that
    // would look like failure rather than absence.
    const west = summary.seatSplits.find((split) => split.seat === "W");
    expect(west?.hands).toBe(0);
    expect(west?.winRate.ratio).toBeNull();
    expect(summary.seatSplits).toHaveLength(4);
  });

  it("withholds every new rate until its own denominator earns it", () => {
    // Plenty of hands, but almost no draws and few discards: the per-hand
    // rates resolve while the others must stay null rather than reporting a
    // percentage drawn from three events.
    const summary = summarisePlayerStats({
      [STAT_HANDS]: 100,
      [STAT_WINS]: 3,
      [STAT_TOTAL_TAI]: 30,
      [STAT_OPENED]: 40,
      [STAT_DRAWN]: 3,
      [STAT_TING_AT_DRAW]: 3,
      [STAT_DISCARDS]: 5,
      [STAT_DISCARDS_EFFICIENT]: 5,
    });
    expect(summary.callRate.ratio).toBeCloseTo(0.4);
    expect(summary.tenpaiAtDrawRate.ratio).toBeNull();
    expect(summary.tileEfficiency.ratio).toBeNull();
    expect(summary.averageWinTai.mean).toBeNull();
    // The counts are still there for a screen that wants to show them.
    expect(summary.tenpaiAtDrawRate.numerator).toBe(3);
    expect(summary.averageWinTai.total).toBe(30);
  });

  it("reads a missing code as zero rather than failing", () => {
    const summary = summarisePlayerStats({ [STAT_HANDS]: 40 });
    expect(summary.tileEfficiency.denominator).toBe(0);
    expect(summary.averageWinTai.total).toBe(0);
    expect(summary.seatSplits.every((split) => split.hands === 0)).toBe(true);
  });
});

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

describe("reconcilePlayerStatsWithHistory", () => {
  it("uses completed session history when aggregate counters lag", () => {
    const summary = summarisePlayerStats({});
    const reconciled = reconcilePlayerStatsWithHistory(summary, [{ result: "Win" }]);

    expect(reconciled).toMatchObject({ handsPlayed: 1, wins: 1, hasPlayed: true });
  });

  it("counts wins when history and aggregate hand totals are equal", () => {
    const summary = summarisePlayerStats({ [STAT_HANDS]: 4, [STAT_WINS]: 0 });
    const reconciled = reconcilePlayerStatsWithHistory(summary, [
      { result: "Loss" },
      { result: "Win" },
      { result: "Loss" },
      { result: "Loss" },
    ]);

    expect(reconciled).toMatchObject({ handsPlayed: 4, wins: 1, hasPlayed: true });
    expect(reconciled.winRate).toMatchObject({ numerator: 1, denominator: 4 });
  });

  it("keeps newer aggregate counters when history is limited", () => {
    const summary = summarisePlayerStats({ [STAT_HANDS]: 12, [STAT_WINS]: 4 });
    expect(reconcilePlayerStatsWithHistory(summary, [{ result: "Win" }])).toBe(summary);
  });
});

describe("readStatValues", () => {
  it("reads stat codes and values out of an AGS page", () => {
    expect(
      readStatValues({ statistics: [{ stat_code: "public-hands-won", value: 12 }] }),
    ).toEqual({ "public-hands-won": 12 });
  });

  it("accepts the gateway's lower-camel statCode field", () => {
    expect(
      readStatValues({ statistics: [{ statCode: "public-hands-completed", value: 3 }] }),
    ).toEqual({ "public-hands-completed": 3 });
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
    let cache: RequestCache | undefined;
    const client = createPlayerStatsClient("player-token", {
      ...options,
      fetchImpl: (async (url: string, init?: RequestInit) => {
        requested = String(url);
        auth = new Headers(init?.headers).get("Authorization") ?? "";
        cache = init?.cache;
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
    expect(cache).toBe("no-store");
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
