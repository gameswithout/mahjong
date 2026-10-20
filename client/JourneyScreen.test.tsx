import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { JourneyScreen } from "./JourneyScreen";
import type { PlayerJourney } from "../protocol/envelope";

const journey: PlayerJourney = {
  completed_rotations: 12,
  first_completed_at: "2020-02-29T00:00:00Z",
  prestige: [
    { games: 1, title: "Newcomer", chapter: "First Seat" },
    { games: 10, title: "Table Regular", chapter: "Familiar Table" },
    { games: 50, title: "Familiar Face", chapter: "A Place of Your Own" },
  ],
  anniversaries: [{ year: 5, earned_at: "2025-02-28", material: "Wood", cosmetic_code: "anniversary-5" }],
};

describe("My Mahjong Journey", () => {
  it("uses verified rotations for Prestige and locks future chapters", () => {
    const node = document.createElement("div");
    node.innerHTML = renderToStaticMarkup(<JourneyScreen journey={journey} onClose={vi.fn()} />);
    expect(node.querySelector("h1")?.textContent).toBe("My Mahjong Journey");
    expect(node.querySelector("h2")?.textContent).toBe("Table Regular");
    expect(node.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("12");
    expect(node.querySelector('[role="progressbar"]')?.getAttribute("aria-valuemax")).toBe("50");
    expect(node.querySelectorAll("ol button:disabled")).toHaveLength(1);
    expect(node.textContent).toContain("38 rotations to go");
    expect(node.textContent).toContain("Anniversary badge · Wood");
    expect(node.textContent).not.toContain("XP");
  });
  it("does not invent earned progress when the server has no Journey support", () => {
    const html = renderToStaticMarkup(<JourneyScreen onClose={vi.fn()} />);
    expect(html).toContain("Your Journey is unavailable");
    expect(html).not.toContain("completed games");
  });
  it("starts the anniversary clock only after the first full rotation", () => {
    const html = renderToStaticMarkup(<JourneyScreen journey={{ ...journey, completed_rotations: 0, first_completed_at: undefined, anniversaries: [] }} onClose={vi.fn()} />);
    expect(html).toContain("Your first seat awaits");
    expect(html).toContain("starts your anniversary clock");
    expect(html).not.toContain("Anniversary badge · Wood");
  });
});
