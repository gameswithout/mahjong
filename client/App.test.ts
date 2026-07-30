import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SeatView } from "../protocol/envelope";
import { ageInYears } from "./age-gate";
import {
  buildResultFriendsState,
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

describe("buildResultFriendsState", () => {
  const session = {
    sessionId: "public-table-1",
    members: [
      { userId: "player-self", displayName: "Me" },
      { userId: "player-south", displayName: "Bamboo Fox" },
      { userId: "player-west", displayName: "Jade Crane" },
      { userId: "player-north", displayName: "Plum Tiger" },
      // A duplicated AGS roster entry must never become a duplicated action.
      { userId: "player-south", displayName: "Bamboo Fox" },
    ],
  };

  it("excludes the caller, deduplicates opponents, and projects AGS relationships", () => {
    const state = buildResultFriendsState(
      session,
      {
        status: "ready",
        friends: [{ userId: "player-west", presence: "offline" }],
        incoming: [{ userId: "player-north" }],
        outgoing: [],
      },
      "player-self",
    );

    expect(state).toEqual({
      status: "ready",
      opponents: [
        {
          userId: "player-south",
          displayName: "Bamboo Fox",
          relationship: "available",
        },
        {
          userId: "player-west",
          displayName: "Jade Crane",
          relationship: "friend",
        },
        {
          userId: "player-north",
          displayName: "Plum Tiger",
          relationship: "incoming",
        },
      ],
    });
  });

  it("does not offer actions until AGS Friends has loaded successfully", () => {
    expect(
      buildResultFriendsState(session, { status: "loading" }, "player-self"),
    ).toMatchObject({ status: "loading" });
    expect(
      buildResultFriendsState(
        session,
        { status: "error", code: "network", message: "Friends unavailable." },
        "player-self",
      ),
    ).toMatchObject({
      status: "error",
      code: "network",
      message: "Friends unavailable.",
    });
  });
});
