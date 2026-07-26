import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LOBBY_TIERS, lockedTiers, playableTier, tierSummary } from "./lobby-tiers";
import { LockedTiers } from "./LockedTiers";

describe("lobby tiers", () => {
  it("matches the specification's tier table", () => {
    expect(LOBBY_TIERS.map((tier) => [tier.name, tier.minimumBalance, tier.stakePerTai, tier.debitCap])).toEqual([
      ["Bamboo Courtyard", 1_000, 10, 300],
      ["Sparrow Pavilion", 10_000, 100, 3_000],
      ["Wind and Cloud Lounge", 100_000, 1_000, 30_000],
      ["Dragon's Den", 1_000_000, 10_000, 300_000],
    ]);
  });

  it("opens exactly one tier, and locks the rest with a stated reason", () => {
    expect(playableTier().name).toBe("Bamboo Courtyard");
    expect(playableTier().lockedReason).toBeUndefined();
    expect(lockedTiers()).toHaveLength(3);
    for (const tier of lockedTiers()) {
      expect(tier.lockedReason).toBeTruthy();
    }
  });

  it("summarises a tier in the three numbers that decide entry", () => {
    expect(tierSummary(playableTier())).toBe(
      "1,000 Jade minimum · 10 per Tai · 300 maximum loss",
    );
  });
});

describe("LockedTiers", () => {
  it("shows the ladder above the player instead of hiding it", () => {
    const markup = renderToStaticMarkup(<LockedTiers />);

    expect(markup).toContain("Sparrow Pavilion");
    expect(markup).toContain("Wind and Cloud Lounge");
    expect(markup).toContain("Dragon&#x27;s Den");
    expect(markup).not.toContain("Bamboo Courtyard");
  });

  it("gives every locked tier a reason and no way to click it", () => {
    const markup = renderToStaticMarkup(<LockedTiers />);

    expect(markup).not.toContain("<button");
    expect(markup.match(/Locked/g)).toHaveLength(3);
    expect(markup).toContain("Opens once its queue is running.");
    expect(markup).toContain("Opens when enough players hold the minimum balance.");
  });
});
