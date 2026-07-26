// Flower Tai running total for the in-play assist (§9.4).
//
// This mirrors rulesengine's scoreFlowerPatterns (scoring.go) exactly, and it
// must keep mirroring it. Every input is public information the seat already
// owns — its own exposed Flowers plus its own seat wind — so this reads no
// opponent hand and no wall order, and it never decides legality. It is a
// running hint only: the authoritative Tai for a hand is whatever the server
// puts on the result screen, which supersedes anything shown here.
//
// It lives in the browser because the projection does not currently carry a
// flower-Tai field. Promoting it to the server (a `flower_tai` block on
// MatchState, computed by the same Go function that scores the hand) is the
// right end state and would delete this file; it was not done here only
// because the proto was under concurrent edit. Until then, the tests in
// flowerTai.test.ts pin this against the Go rules.
import type { SeatId } from "./matchTableTypes";

export const SEASON_NAMES = ["spring", "summer", "autumn", "winter"] as const;
export const PLANT_NAMES = ["plum", "orchid", "chrysanthemum", "bamboo"] as const;

// rulesengine matchingFlowerNames: each seat owns one season and one plant,
// in East/South/West/North order.
const MATCHING_BY_SEAT: Record<SeatId, [string, string]> = {
  E: ["spring", "plum"],
  S: ["summer", "orchid"],
  W: ["autumn", "chrysanthemum"],
  N: ["winter", "bamboo"],
};

export interface FlowerTaiPattern {
  name: string;
  tai: number;
  // The flower that earned it, where one did — lets the UI point at the tile
  // rather than only naming the pattern.
  flower?: string;
}

export interface FlowerTaiSummary {
  total: number;
  patterns: FlowerTaiPattern[];
  seasons: string[];
  plants: string[];
}

// Flower IDs are single-copy ("flower-spring") and carry no copy suffix, so
// the full ID is already the type identity — same as the Go side.
function flowerName(tileId: string): string | null {
  return tileId.startsWith("flower-") ? tileId.slice("flower-".length) : null;
}

export function summarizeFlowerTai(tileIds: string[], seat: SeatId): FlowerTaiSummary {
  const seasons: string[] = [];
  const plants: string[] = [];
  for (const tileId of tileIds) {
    const name = flowerName(tileId);
    if (name === null) {
      continue;
    }
    const bucket = (SEASON_NAMES as readonly string[]).includes(name) ? seasons : plants;
    // Deduplicated the way the Go scorer's map-of-names is.
    if (!bucket.includes(name)) {
      bucket.push(name);
    }
  }

  const patterns: FlowerTaiPattern[] = [];
  for (const name of MATCHING_BY_SEAT[seat]) {
    if (seasons.includes(name) || plants.includes(name)) {
      patterns.push({ name: "Matching Flower", tai: 1, flower: name });
    }
  }
  if (seasons.length === 4) {
    patterns.push({ name: "Complete Seasons", tai: 2 });
  }
  if (plants.length === 4) {
    patterns.push({ name: "Complete Flowers", tai: 2 });
  }

  return {
    total: patterns.reduce((sum, pattern) => sum + pattern.tai, 0),
    patterns,
    seasons,
    plants,
  };
}

// Whether this flower is one of the seat's own two — the copy that earns a
// Matching Flower Tai, and the one worth marking on the tile itself.
export function isMatchingFlower(tileId: string, seat: SeatId): boolean {
  const name = flowerName(tileId);
  return name !== null && MATCHING_BY_SEAT[seat].includes(name);
}
