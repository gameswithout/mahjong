import { describe, expect, it } from "vitest";
import { journeyFixture } from "./fixtures/journey";
import { anniversaryDate, chronicleStage, founderCosmetics, legacyAchievements, prestigeProgress, publicProfilePreview, recentMilestones, selectShowcase, SKILL_CANDIDATES, type JourneyCosmetic } from "./journey-model";

const journey = journeyFixture(12).journey;
describe("Journey projections and approval boundaries", () => {
  it("uses rotations, not XP or hands, and measures progress from the last earned milestone", () => {
    const progress = prestigeProgress(journey);
    expect(progress.current?.title).toBe("Table Regular"); expect(progress.next?.games).toBe(50);
    expect(progress.percent).toBe(5);
    expect(chronicleStage(1)?.title).toBe("Familiar Table");
    expect(chronicleStage(2)?.title).toBe("Familiar Table");
    expect(chronicleStage(6)?.title).toBe("Living Legend");
    expect(chronicleStage(-1)).toBeUndefined();
  });
  it("does not turn proposed Skill definitions or missing referral progress into unlocks", () => {
    expect(SKILL_CANDIDATES.every((item) => item.status === "proposed" && !item.unlocked && !item.reward)).toBe(true);
    const community = legacyAchievements(journey).find((item) => item.id === "friend-of-mahjong")!;
    expect(community.unlocked).toBe(false); expect(community.current).toBeUndefined();
    expect(community.unavailableReason).toContain("not connected");
  });
  it("is read-only and idempotent, with no fabricated timestamps or reward ownership", () => {
    const before = JSON.stringify(journey);
    expect(legacyAchievements(journey)).toEqual(legacyAchievements(journey));
    expect(JSON.stringify(journey)).toBe(before);
    const ten = legacyAchievements(journey).find((item) => item.id === "prestige-10")!;
    expect(ten.unlocked).toBe(true); expect(ten.unlockedAt).toBeUndefined();
    expect(legacyAchievements(journey).every((item) => item.rewardDelivered !== true)).toBe(true);
    expect(recentMilestones(journey).some((event) => event.id === "prestige-10")).toBe(false);
    expect(recentMilestones(journey).map((event) => event.date)).toEqual([...recentMilestones(journey).map((event) => event.date)].sort((a, b) => Date.parse(b) - Date.parse(a)));
  });
  it("uses UTC calendar anniversaries and an explicit leap-day policy", () => {
    expect(anniversaryDate("2020-02-29T18:00:00Z", 1)).toBe("2021-02-28");
    expect(anniversaryDate("2020-02-29T18:00:00Z", 4)).toBe("2024-02-29");
    expect(anniversaryDate("2020-07-01T23:00:00-07:00", 1)).toBe("2021-07-02");
    expect(anniversaryDate("invalid", 1)).toBeUndefined();
    expect(anniversaryDate("2020-01-01", 0)).toBeUndefined();
  });
});

describe("private showcase draft ownership", () => {
  const inventory: JourneyCosmetic[] = [
    ...founderCosmetics(true),
    { id: "anniversary", name: "Wood", type: "tile_skin", source: "Anniversary", owned: true, compatibleDisplays: ["showcase"] },
    { id: "shop", name: "Tea", type: "table_theme", source: "Jade Shop", owned: true, compatibleDisplays: ["showcase", "chronicle"] },
    { id: "skill", name: "Skill cosmetic", type: "avatar_frame", source: "Skill", owned: true, compatibleDisplays: ["showcase"] },
    { id: "not-owned", name: "Locked", type: "tile_skin", source: "Legacy", owned: false, compatibleDisplays: ["showcase"] },
    { id: "not-compatible", name: "Other", type: "tile_skin", source: "Legacy", owned: true, compatibleDisplays: [] },
  ];
  it("accepts any owned compatible source without changing equipment or inventory", () => {
    const equipment = { tileSkin: "other" }; const before = JSON.stringify(inventory);
    let draft = selectShowcase([], "anniversary", inventory);
    draft = selectShowcase(draft, "shop", inventory); draft = selectShowcase(draft, "skill", inventory);
    expect(draft).toEqual(["anniversary", "shop", "skill"]);
    expect(equipment.tileSkin).toBe("other"); expect(JSON.stringify(inventory)).toBe(before);
    expect(selectShowcase(draft, "shop", inventory)).toEqual(["anniversary", "skill"]);
  });
  it("rejects unowned, missing, incompatible, and excess selections", () => {
    for (const id of ["not-owned", "missing", "not-compatible"]) expect(() => selectShowcase([], id, inventory)).toThrow("owned, compatible");
    expect(() => selectShowcase(["founder-og", "anniversary", "shop"], "skill", inventory)).toThrow("full");
    expect(() => selectShowcase([], "shop", inventory, -1)).toThrow("Invalid");
  });
  it("revalidates drafts, deduplicates IDs, and strips private fields from previews", () => {
    const rawProfile = { ...journeyFixture().profile, userId: "private-id", email: "private@example.test", jade: 9000 };
    const result = publicProfilePreview(rawProfile, journey, inventory, ["not-owned", "missing", "shop", "shop", "founder-og"]);
    expect(result.showcasedCosmetics.map((item) => item.id)).toEqual(["shop", "founder-og"]);
    expect(JSON.stringify(result)).not.toMatch(/private-id|private@example|9000/);
    const revoked = inventory.map((item) => ({ ...item, owned: false }));
    expect(publicProfilePreview(rawProfile, journey, revoked, ["shop"]).showcasedCosmetics).toEqual([]);
  });
});
