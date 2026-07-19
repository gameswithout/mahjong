import { describe, expect, it } from "vitest";

import { tile } from "./matchTableTypes";
import { applySort, sortBySetsAndConnections, sortBySuitThenRank } from "./matchTableSort";

function ids(tiles: { id: string }[]): string[] {
  return tiles.map((t) => t.id);
}

describe("sortBySuitThenRank", () => {
  it("orders by tileTypeKey, then by full id for same-type copies", () => {
    const hand = ["dots-2-1", "bamboo-9-1", "characters-1-2", "characters-1-1", "wind-east-1", "dragon-red-1"].map(
      tile,
    );
    expect(ids(sortBySuitThenRank(hand))).toEqual([
      "bamboo-9-1",
      "characters-1-1",
      "characters-1-2",
      "dots-2-1",
      "dragon-red-1",
      "wind-east-1",
    ]);
  });
});

describe("sortBySetsAndConnections", () => {
  it("clusters a triplet into one adjacent block", () => {
    const hand = ["dots-1-1", "characters-5-1", "characters-5-2", "characters-5-3", "bamboo-3-1"].map(tile);
    const sorted = ids(sortBySetsAndConnections(hand));
    const triplet = ["characters-5-1", "characters-5-2", "characters-5-3"];
    const start = sorted.indexOf("characters-5-1");
    expect(sorted.slice(start, start + 3).sort()).toEqual(triplet.sort());
  });

  it("clusters a three-consecutive-rank run into one adjacent block", () => {
    const hand = ["dots-9-1", "bamboo-4-1", "bamboo-5-1", "bamboo-6-1", "wind-north-1"].map(tile);
    const sorted = ids(sortBySetsAndConnections(hand));
    const start = sorted.indexOf("bamboo-4-1");
    expect(sorted.slice(start, start + 3)).toEqual(["bamboo-4-1", "bamboo-5-1", "bamboo-6-1"]);
  });

  it("falls back to suit-then-rank for leftover tiles with no set or run", () => {
    const hand = ["dots-2-1", "bamboo-9-1", "wind-east-1"].map(tile);
    expect(ids(sortBySetsAndConnections(hand))).toEqual(ids(sortBySuitThenRank(hand)));
  });

  it("never drops or duplicates a tile", () => {
    const hand = [
      "characters-1-1",
      "characters-2-1",
      "characters-3-1",
      "bamboo-7-1",
      "bamboo-7-2",
      "bamboo-7-3",
      "dots-5-1",
      "wind-south-1",
    ].map(tile);
    expect(ids(sortBySetsAndConnections(hand)).sort()).toEqual(ids(hand).sort());
  });
});

describe("applySort", () => {
  it("returns the hand unchanged for 'off'", () => {
    const hand = ["dots-2-1", "bamboo-9-1", "characters-1-1"].map(tile);
    expect(applySort("off", hand)).toBe(hand);
  });

  it("delegates to sortBySuitThenRank for 'suit-rank'", () => {
    const hand = ["dots-2-1", "bamboo-9-1"].map(tile);
    expect(ids(applySort("suit-rank", hand))).toEqual(ids(sortBySuitThenRank(hand)));
  });

  it("delegates to sortBySetsAndConnections for 'sets'", () => {
    const hand = ["characters-5-1", "characters-5-2", "characters-5-3"].map(tile);
    expect(ids(applySort("sets", hand))).toEqual(ids(sortBySetsAndConnections(hand)));
  });
});
