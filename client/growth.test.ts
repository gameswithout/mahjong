import { describe, expect, it } from "vitest";

import {
  createGrowthStore,
  jadeBalanceBand,
  levelBand,
  returnBand,
  sessionCountBand,
  sessionDepth,
} from "./growth";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    size: () => values.size,
  };
}

const DAY = 86_400_000;
const START = Date.parse("2026-08-01T09:00:00Z");

describe("jadeBalanceBand", () => {
  it("bands against the minimum that gates play, not an absolute amount", () => {
    // Two players with wildly different balances are in the same product
    // situation when both are one stake short of being able to enter.
    expect(jadeBalanceBand({ available: 0, minimum_balance: 100 })).toBe("empty");
    expect(jadeBalanceBand({ available: 99, minimum_balance: 100 })).toBe("below_minimum");
    expect(jadeBalanceBand({ available: 250, minimum_balance: 100 })).toBe("low");
    expect(jadeBalanceBand({ available: 900, minimum_balance: 100 })).toBe("healthy");
    expect(jadeBalanceBand({ available: 5_000, minimum_balance: 100 })).toBe("deep");
    expect(jadeBalanceBand({ available: 900, minimum_balance: 1_000 })).toBe("below_minimum");
  });

  it("treats a missing or unusable minimum as one rather than dividing by zero", () => {
    expect(jadeBalanceBand({ available: 40 })).toBe("deep");
    expect(jadeBalanceBand({ available: 2, minimum_balance: 0 })).toBe("low");
    expect(jadeBalanceBand({ available: Number.NaN, minimum_balance: 100 })).toBe("empty");
  });
});

describe("returnBand", () => {
  it("separates a first session from a same-day reload", () => {
    // The distinction matters: a reload is not a return, and counting it as
    // one inflates every retention number in the dashboard.
    expect(returnBand(null, START)).toBe("first_session");
    expect(returnBand(START - 1_000, START)).toBe("same_day");
  });

  it("bands the day-N cohorts retention is reported in", () => {
    expect(returnBand(START - 1.5 * DAY, START)).toBe("next_day");
    expect(returnBand(START - 5 * DAY, START)).toBe("within_week");
    expect(returnBand(START - 20 * DAY, START)).toBe("within_month");
    expect(returnBand(START - 90 * DAY, START)).toBe("lapsed");
  });

  it("does not report a clock that moved backwards as a lapse", () => {
    expect(returnBand(START + 5 * DAY, START)).toBe("same_day");
  });
});

describe("sessionCountBand and levelBand", () => {
  it("bands rather than counting, so a session index cannot identify a player", () => {
    expect(sessionCountBand(1)).toBe("1");
    expect(sessionCountBand(3)).toBe("2_3");
    expect(sessionCountBand(10)).toBe("4_10");
    expect(sessionCountBand(30)).toBe("11_30");
    expect(sessionCountBand(31)).toBe("31_plus");
  });

  it("bands levels around the reward thresholds", () => {
    expect(levelBand(1)).toBe("1");
    expect(levelBand(5)).toBe("2_5");
    expect(levelBand(26)).toBe("26_50");
    expect(levelBand(51)).toBe("51_plus");
  });
});

describe("sessionDepth", () => {
  it("distinguishes the ways a session can fail to become play", () => {
    expect(sessionDepth({ matchesEntered: 0, queueEntries: 0, handsCompleted: 0 })).toBe(
      "bounced",
    );
    expect(sessionDepth({ matchesEntered: 0, queueEntries: 1, handsCompleted: 0 })).toBe(
      "queued",
    );
    // Seated but never finished a hand still counts as play: the player got
    // to the game. The hand they abandoned is match_abandoned's business.
    expect(sessionDepth({ matchesEntered: 1, queueEntries: 1, handsCompleted: 0 })).toBe(
      "played",
    );
    expect(sessionDepth({ matchesEntered: 1, queueEntries: 1, handsCompleted: 2 })).toBe(
      "played",
    );
  });
});

describe("growth store", () => {
  it("reports the first session as first_session and the next one as a return", () => {
    const storage = memoryStorage();
    const store = createGrowthStore(storage);

    const first = store.beginSession(START);
    expect(first).toMatchObject({
      returnBand: "first_session",
      sessionCountBand: "1",
      daysSinceLastSession: 0,
    });

    const second = createGrowthStore(storage).beginSession(START + 3 * DAY);
    expect(second).toMatchObject({
      returnBand: "within_week",
      sessionCountBand: "2_3",
      daysSinceLastSession: 3,
    });
  });

  it("reaches each milestone once per device, across reloads", () => {
    const storage = memoryStorage();
    createGrowthStore(storage).beginSession(START);

    const reached = createGrowthStore(storage).reach("first_hand_completed", START + 600_000);
    expect(reached).toMatchObject({
      milestone: "first_hand_completed",
      minutesSinceFirstSession: 10,
      sessionCountBand: "1",
    });

    // A new store over the same storage is a page reload. The milestone must
    // not fire again, or activation counts every returning player as new.
    expect(createGrowthStore(storage).reach("first_hand_completed", START + 700_000)).toBeNull();
    expect(createGrowthStore(storage).reach("first_staked_hand", START + 700_000)).not.toBeNull();
  });

  it("keeps playing when storage is unavailable", () => {
    const blocked = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
    };
    const store = createGrowthStore(blocked);

    expect(store.beginSession(START).returnBand).toBe("first_session");
    // Over-reporting a first reach is the safe direction to be wrong in: it
    // never puts a returning player into a first-time cohort.
    expect(store.reach("first_lobby", START)).not.toBeNull();
    expect(store.reach("first_lobby", START)).not.toBeNull();
  });
});
