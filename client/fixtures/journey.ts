import type { PlayerJourney, PlayerProgression } from "../../protocol/envelope";
import { defaultPlayerProfile } from "../player-profile";
import { summarisePlayerStats } from "../player-stats";
import { founderCosmetics } from "../journey-model";

// Design evidence only. Never imported by the authenticated production app.
export function journeyFixture(games = 325) {
  const completed = Math.max(0, Math.floor(Number.isFinite(games) ? games : 0));
  const journey: PlayerJourney = {
    completed_rotations: completed,
    first_completed_at: completed ? "2020-02-29T12:00:00Z" : undefined,
    anniversaries: completed ? Array.from({ length: 6 }, (_, i) => ({ year: i + 1, earned_at: `${2021 + i}-02-${i === 3 ? "29" : "28"}`, ...(i === 4 ? { material: "Wood", cosmetic_code: "anniversary-5" } : {}) })) : [],
    prestige: [
      { games: 1, title: "Newcomer", chapter: "First Seat" },
      { games: 10, title: "Table Regular", chapter: "Familiar Table" },
      { games: 50, title: "Familiar Face", chapter: "A Place of Your Own" },
      { games: 100, title: "Mahjong Veteran", chapter: "Veteran’s Room" },
      { games: 500, title: "Table Elder", chapter: "Gathering Place" },
      { games: 1000, title: "Mahjong Luminary", chapter: "Hall of Memories" },
      { games: 5000, title: "Living Legend", chapter: "A Lifetime at the Table" },
    ],
  };
  const progression: PlayerProgression = { journey, level: completed ? 4 : 1, lifetime_xp: completed ? 1350 : 0, xp_into_level: completed ? 150 : 0, xp_for_next_level: 500 };
  return {
    matches: Array.from({ length: Math.min(completed, 15) }, (_, index) => ({ matchId: `sample-history-${index + 1}`, completedAt: new Date(Date.UTC(2026, 9, 1, 12, index)).toISOString(), mode: index % 2 ? "ranked" : "unranked", result: index % 3 ? "Win" as const : "Loss" as const, winKind: "", winningTileId: "", rawTai: index % 8, xpAwarded: 100 })),
    journey, progression, profile: { ...defaultPlayerProfile(false), nickname: "Jade Sparrow" },
    // These are illustrative server-shaped values, not generated achievements.
    inventory: completed ? founderCosmetics(true) : [],
    statistics: summarisePlayerStats(completed ? { "public-hands-completed": completed * 4, "public-hands-won": Math.floor(completed * 0.8), "highest-raw-tai": 12 } : {}),
  };
}
