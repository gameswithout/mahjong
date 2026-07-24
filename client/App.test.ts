import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SeatView } from "../protocol/envelope";
import {
  ageInYears,
  shouldAutomaticallyDraw,
  shouldAutomaticallyEnterHumanMatch,
} from "./App";

function drawView(overrides: Partial<SeatView> = {}): SeatView {
  return {
    match_id: "match-1",
    seat: "S",
    state_version: 4,
    phase: "awaiting_draw",
    active_seat: "S",
    own_hand: [],
    own_exposed: [],
    players: [],
    wall: { remaining: 80, drawable_remaining: 64, reserve_remaining: 16 },
    ...overrides,
  };
}

// §10.3: minimum stated age is 13, computed from month/year only (never a
// full birth date).
describe("ageInYears", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts a full year once the birth month has passed this year", () => {
    expect(ageInYears(2013, 1)).toBe(13);
    expect(ageInYears(2013, 7)).toBe(13);
  });

  it("has not yet turned this year's age when the birth month hasn't arrived", () => {
    expect(ageInYears(2013, 8)).toBe(12);
    expect(ageInYears(2013, 12)).toBe(12);
  });
});

describe("shouldAutomaticallyEnterHumanMatch", () => {
  it("waits until all four matched Session members are visible", () => {
    expect(shouldAutomaticallyEnterHumanMatch("matchmaking", 1, "idle")).toBe(false);
    expect(shouldAutomaticallyEnterHumanMatch("matchmaking", 3, "idle")).toBe(false);
    expect(shouldAutomaticallyEnterHumanMatch("matchmaking", 4, "idle")).toBe(true);
  });

  it("does not auto-enter manual sessions or duplicate an active runtime transition", () => {
    expect(shouldAutomaticallyEnterHumanMatch("manual", 4, "idle")).toBe(false);
    expect(shouldAutomaticallyEnterHumanMatch("matchmaking", 4, "preparing")).toBe(false);
    expect(shouldAutomaticallyEnterHumanMatch("matchmaking", 4, "connecting")).toBe(false);
    expect(shouldAutomaticallyEnterHumanMatch("matchmaking", 4, "joined")).toBe(false);
    expect(shouldAutomaticallyEnterHumanMatch("matchmaking", 4, "error")).toBe(false);
  });
});

describe("shouldAutomaticallyDraw", () => {
  it("draws only for the local seat's unblocked draw phase", () => {
    expect(shouldAutomaticallyDraw(drawView(), false)).toBe(true);
    expect(shouldAutomaticallyDraw(drawView(), true)).toBe(false);
    expect(shouldAutomaticallyDraw(drawView({ active_seat: "E" }), false)).toBe(false);
    expect(
      shouldAutomaticallyDraw(drawView({ phase: "awaiting_discard" }), false),
    ).toBe(false);
  });
});
