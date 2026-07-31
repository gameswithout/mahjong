import { beforeEach, describe, expect, it } from "vitest";

import {
  MAX_PROFILE_NICKNAME_LENGTH,
  PROFILE_TILE_OPTIONS,
  loadPlayerProfile,
  savePlayerProfile,
} from "./player-profile";

describe("player profile", () => {
  beforeEach(() => localStorage.clear());

  it("offers every suited, honor, flower, and season tile", () => {
    expect(PROFILE_TILE_OPTIONS).toHaveLength(42);
    expect(PROFILE_TILE_OPTIONS.map((option) => option.id)).toEqual(
      expect.arrayContaining([
        "characters-1-1",
        "bamboo-9-1",
        "dots-9-1",
        "wind-north-1",
        "dragon-white-1",
        "flower-plum",
        "flower-winter",
      ]),
    );
  });

  it("persists customization per player identity", () => {
    savePlayerProfile("player-1", {
      nickname: "River Wind",
      tileSlotIds: ["bamboo-8-1", "flower-plum", "dragon-white-1"],
    });

    expect(loadPlayerProfile("player-1", false)).toEqual({
      nickname: "River Wind",
      tileSlotIds: ["bamboo-8-1", "flower-plum", "dragon-white-1"],
    });
    expect(loadPlayerProfile("player-2", true).nickname).toBe("Guest player");
  });

  it("caps nicknames to the profile badge width", () => {
    savePlayerProfile("player-long-name", {
      nickname: "A nickname that cannot fit in the badge",
      tileSlotIds: ["bamboo-8-1", "flower-plum", "dragon-white-1"],
    });

    const nickname = loadPlayerProfile("player-long-name", false).nickname;
    expect(nickname.length).toBeLessThanOrEqual(MAX_PROFILE_NICKNAME_LENGTH);
    expect(nickname).toBe("A nickname that");
  });

  it("migrates the original avatar and achievement fields into equal slots", () => {
    localStorage.setItem(
      "mahjong-player-profile:legacy-player",
      JSON.stringify({
        nickname: "Legacy",
        avatarTileId: "dots-2-1",
        achievementTileIds: ["wind-west-1", "flower-summer"],
      }),
    );

    expect(loadPlayerProfile("legacy-player", false).tileSlotIds).toEqual([
      "dots-2-1",
      "wind-west-1",
      "flower-summer",
    ]);
  });
});
