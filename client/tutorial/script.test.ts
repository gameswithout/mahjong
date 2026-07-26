import { describe, expect, it } from "vitest";

import { tileTypeKey } from "../matchTableTypes";
import { TUTORIAL_CHAPTERS, TUTORIAL_SCRIPT_VERSION, allTutorialSteps } from "./script";

describe("tutorial script", () => {
  it("teaches the three chapters the backlog asks for, in order", () => {
    expect(TUTORIAL_CHAPTERS.map((chapter) => chapter.id)).toEqual([
      "chapter-1-sets",
      "chapter-2-claims",
      "chapter-3-ting",
    ]);
  });

  it("is versioned, so a completion marker can name what was completed", () => {
    expect(TUTORIAL_SCRIPT_VERSION).toMatch(/^tutorial-v\d+$/);
  });

  it("gives every step a unique id", () => {
    const ids = allTutorialSteps().map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never asks for an action the step's own table cannot accept", () => {
    for (const step of allTutorialSteps()) {
      if (step.expect.kind === "discard") {
        const hand = step.table.seats[step.table.localSeat].hand ?? [];
        expect(hand.map((item) => item.id)).toContain(step.expect.tileId);
      }
      if (step.expect.kind === "action") {
        expect(step.table.legalActions.map((action) => action.id)).toContain(
          step.expect.actionId,
        );
      }
    }
  });

  it("gives every step that can be failed a hint back to the goal", () => {
    for (const step of allTutorialSteps()) {
      if (step.expect.kind !== "read") {
        expect(step.hint, `${step.id} has no hint`).toBeTruthy();
      }
    }
  });

  it("stays untimed throughout", () => {
    // §5.10: nothing in the tutorial may punish a player for reading slowly.
    for (const step of allTutorialSteps()) {
      expect(step.table.untimed, `${step.id} is timed`).toBe(true);
    }
  });

  it("keeps every scripted hand within a legal tile supply", () => {
    // Four copies of each tile exist. A fixture that shows five would teach a
    // rule the engine would then contradict.
    for (const step of allTutorialSteps()) {
      const counts = new Map<string, number>();
      const seen: string[] = [];
      for (const seat of Object.values(step.table.seats)) {
        seen.push(...(seat.hand ?? []).map((item) => item.id));
        seen.push(...seat.discards.map((item) => item.id));
        seen.push(...seat.melds.flatMap((meld) => meld.tiles.map((item) => item.id)));
        seen.push(...seat.bonusTiles.map((item) => item.id));
      }
      if (step.table.lastDiscard) {
        seen.push(step.table.lastDiscard.tile.id);
      }

      // Physical tile ids must be unique: the same copy cannot be in two
      // places. Type counts must not exceed four.
      const uniqueIds = new Set(seen);
      const duplicated = seen.filter((id, index) => seen.indexOf(id) !== index);
      expect(duplicated, `${step.id} shows the same physical tile twice`).toEqual([]);

      for (const id of uniqueIds) {
        const key = tileTypeKey(id);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const [key, count] of counts) {
        expect(count, `${step.id} shows ${count} copies of ${key}`).toBeLessThanOrEqual(4);
      }
    }
  });

  it("shows a local hand of a plausible size at every step", () => {
    for (const step of allTutorialSteps()) {
      const hand = step.table.seats[step.table.localSeat].hand ?? [];
      expect(hand.length, `${step.id} hand size`).toBeGreaterThanOrEqual(13);
      expect(hand.length, `${step.id} hand size`).toBeLessThanOrEqual(17);
    }
  });
});
