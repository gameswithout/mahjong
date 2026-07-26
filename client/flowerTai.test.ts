import { describe, expect, it } from "vitest";

import { isMatchingFlower, summarizeFlowerTai } from "./flowerTai";

const ALL_SEASONS = ["flower-spring", "flower-summer", "flower-autumn", "flower-winter"];
const ALL_PLANTS = ["flower-plum", "flower-orchid", "flower-chrysanthemum", "flower-bamboo"];

// These cases pin the browser hint against rulesengine's scoreFlowerPatterns
// (scoring.go). If the Go rules move, these fail — which is the point.
describe("summarizeFlowerTai", () => {
  it("scores nothing without flowers", () => {
    expect(summarizeFlowerTai([], "E")).toMatchObject({ total: 0, patterns: [] });
  });

  it("awards one Tai per flower matching the seat, and nothing for the others", () => {
    // East owns spring and plum; summer and orchid belong to South.
    const summary = summarizeFlowerTai(
      ["flower-spring", "flower-plum", "flower-summer", "flower-orchid"],
      "E",
    );
    expect(summary.total).toBe(2);
    expect(summary.patterns).toEqual([
      { name: "Matching Flower", tai: 1, flower: "spring" },
      { name: "Matching Flower", tai: 1, flower: "plum" },
    ]);
  });

  it("gives each seat its own pair", () => {
    expect(summarizeFlowerTai(["flower-summer", "flower-orchid"], "S").total).toBe(2);
    expect(summarizeFlowerTai(["flower-autumn", "flower-chrysanthemum"], "W").total).toBe(2);
    expect(summarizeFlowerTai(["flower-winter", "flower-bamboo"], "N").total).toBe(2);
    // The same tiles are worth nothing to a seat that does not own them.
    expect(summarizeFlowerTai(["flower-summer", "flower-orchid"], "N").total).toBe(0);
  });

  it("adds two Tai for a complete set of seasons", () => {
    const summary = summarizeFlowerTai(ALL_SEASONS, "E");
    // spring matches East (1) + all four seasons (2).
    expect(summary.total).toBe(3);
    expect(summary.patterns.map((pattern) => pattern.name)).toEqual([
      "Matching Flower",
      "Complete Seasons",
    ]);
  });

  it("adds two Tai for a complete set of plants", () => {
    const summary = summarizeFlowerTai(ALL_PLANTS, "W");
    expect(summary.total).toBe(3);
    expect(summary.patterns.map((pattern) => pattern.name)).toEqual([
      "Matching Flower",
      "Complete Flowers",
    ]);
  });

  it("scores all eight flowers as both complete sets plus the seat's two", () => {
    const summary = summarizeFlowerTai([...ALL_SEASONS, ...ALL_PLANTS], "N");
    // winter + bamboo (2) + Complete Seasons (2) + Complete Flowers (2).
    expect(summary.total).toBe(6);
  });

  it("ignores non-flower tiles and duplicate flower ids", () => {
    const summary = summarizeFlowerTai(
      ["dots-1-1", "flower-spring", "flower-spring", "wind-east-1"],
      "E",
    );
    expect(summary.total).toBe(1);
    expect(summary.seasons).toEqual(["spring"]);
  });
});

describe("isMatchingFlower", () => {
  it("identifies only the seat's own two flowers", () => {
    expect(isMatchingFlower("flower-spring", "E")).toBe(true);
    expect(isMatchingFlower("flower-plum", "E")).toBe(true);
    expect(isMatchingFlower("flower-summer", "E")).toBe(false);
    expect(isMatchingFlower("dots-1-1", "E")).toBe(false);
  });
});
