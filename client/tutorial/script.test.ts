import { describe, expect, it } from "vitest";

import { tileTypeKey } from "../matchTableTypes";
import {
  TUTORIAL_CHAPTERS,
  TUTORIAL_SCRIPT_VERSION,
  allTutorialSteps,
} from "./script";

describe("tutorial script", () => {
  it("teaches first-turn basics before terminology, claims, Tai, and Win", () => {
    expect(TUTORIAL_CHAPTERS.map((chapter) => chapter.id)).toEqual([
      "chapter-1-first-turn",
      "chapter-2-winning-shape",
      "chapter-3-claims",
      "chapter-4-tai-and-win",
    ]);
  });

  it("is versioned, so a completion marker can name what was completed", () => {
    expect(TUTORIAL_SCRIPT_VERSION).toBe("tutorial-v2");
  });

  it("gives every step a unique id", () => {
    const ids = allTutorialSteps().map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never asks for an action or answer the step cannot accept", () => {
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
      if (step.expect.kind === "answer") {
        expect(step.answers?.map((answer) => answer.id)).toContain(
          step.expect.answerId,
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

  it("keeps every Tai breakdown arithmetically correct", () => {
    for (const step of allTutorialSteps()) {
      if (!step.score) {
        continue;
      }
      expect(
        step.score.lines.reduce((total, line) => total + line.tai, 0),
        `${step.id} Tai total`,
      ).toBe(step.score.total);
    }
  });

  it("defines introduced terms in plain language", () => {
    const terms = allTutorialSteps().flatMap((step) => step.terms ?? []);
    expect(terms.map((term) => term.term)).toEqual(
      expect.arrayContaining([
        "Hand",
        "Sequence (Chow)",
        "Triplet (Pong)",
        "Ready (Ting)",
        "Tai",
        "Self-Draw (Zimo)",
      ]),
    );
    for (const term of terms) {
      expect(term.meaning.trim().length, `${term.term} definition`).toBeGreaterThan(
        12,
      );
    }
  });

  it("uses a 16-tile Ready hand and a 17th tile that completes the Win", () => {
    const readyStep = allTutorialSteps().find(
      (step) => step.id === "c2-s3-ready",
    );
    const winStep = allTutorialSteps().find((step) => step.id === "c4-s3-win");
    expect(readyStep).toBeTruthy();
    expect(winStep).toBeTruthy();

    const readyHand =
      readyStep?.table.seats[readyStep.table.localSeat].hand ?? [];
    const winningHand =
      winStep?.table.seats[winStep.table.localSeat].hand ?? [];
    expect(readyHand).toHaveLength(16);
    expect(winningHand).toHaveLength(16);
    expect(winStep?.table.lastDiscard?.tile.label).toBe("7 of characters");
    expect(
      winStep?.table.legalActions.find((action) => action.id === "Win")?.preview
        ?.rawTai,
    ).toBe(3);
  });

  it("stays untimed throughout", () => {
    for (const step of allTutorialSteps()) {
      expect(step.table.untimed, `${step.id} is timed`).toBe(true);
    }
  });

  it("keeps every scripted hand within a legal tile supply", () => {
    // Four copies of each ordinary tile exist. A fixture that shows five would
    // teach a state the engine can never produce.
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
      expect(
        duplicated,
        `${step.id} shows the same physical tile twice`,
      ).toEqual([]);

      for (const id of uniqueIds) {
        const key = tileTypeKey(id);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const [key, count] of counts) {
        expect(
          count,
          `${step.id} shows ${count} copies of ${key}`,
        ).toBeLessThanOrEqual(4);
      }
    }
  });

  it("shows a plausible local hand size at every step", () => {
    for (const step of allTutorialSteps()) {
      const hand = step.table.seats[step.table.localSeat].hand ?? [];
      expect(hand.length, `${step.id} hand size`).toBeGreaterThanOrEqual(13);
      expect(hand.length, `${step.id} hand size`).toBeLessThanOrEqual(17);
    }
  });
});
