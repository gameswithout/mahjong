// §9.3 hand sorting: "Auto-sort options are Off, by Suit then Rank, and by
// Sets/Connections." Purely a client display concern — "Server state is
// tile-identity based and does not depend on client order" — so these are
// pure functions over WireTile[] with no protocol involvement.

import { tileTypeKey, type WireTile } from "./matchTableTypes";

export type SortMode = "off" | "suit-rank" | "sets";

export const SORT_MODES: SortMode[] = ["off", "suit-rank", "sets"];

export function sortModeLabel(mode: SortMode): string {
  switch (mode) {
    case "suit-rank":
      return "Suit·Rank";
    case "sets":
      return "Sets";
    default:
      return "Off";
  }
}

// Mirrors rulesengine's sortTiles/tileTypeKey exactly: same tileTypeKey
// (suit+rank, or the honor/flower id) sorts lexically, tied-broken by the
// full physical id.
export function sortBySuitThenRank(hand: WireTile[]): WireTile[] {
  return [...hand].sort((a, b) => {
    const ka = tileTypeKey(a.id);
    const kb = tileTypeKey(b.id);
    if (ka !== kb) {
      return ka < kb ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

const NUMBERED_SUITS = ["characters", "bamboo", "dots"];

// "By Sets/Connections": clusters tiles that already form a complete
// triplet, or a run of three consecutive ranks in the same suit, into one
// visual block, then falls back to suit-then-rank order for whatever is
// left over (pairs, isolated singles, honors, flowers).
export function sortBySetsAndConnections(hand: WireTile[]): WireTile[] {
  const pool = [...hand];
  const groups: WireTile[][] = [];

  const countOfType = (key: string) => pool.filter((t) => tileTypeKey(t.id) === key).length;

  const takeByTypeKey = (key: string, count: number): WireTile[] => {
    const chosen: WireTile[] = [];
    for (let i = pool.length - 1; i >= 0 && chosen.length < count; i--) {
      if (tileTypeKey(pool[i].id) === key) {
        chosen.push(pool[i]);
        pool.splice(i, 1);
      }
    }
    return chosen;
  };

  const typeKeysPresent = () => {
    const keys = new Set<string>();
    for (const t of pool) {
      keys.add(tileTypeKey(t.id));
    }
    return Array.from(keys).sort();
  };

  // Triplets first — three of the same tile reads as one block regardless
  // of suit or rank.
  for (const key of typeKeysPresent()) {
    while (countOfType(key) >= 3) {
      groups.push(sortBySuitThenRank(takeByTypeKey(key, 3)));
    }
  }

  // Runs: three consecutive ranks within the same numbered suit.
  for (const suit of NUMBERED_SUITS) {
    let progress = true;
    while (progress) {
      progress = false;
      for (let rank = 1; rank <= 7; rank++) {
        const keys = [`${suit}-${rank}`, `${suit}-${rank + 1}`, `${suit}-${rank + 2}`];
        if (keys.every((key) => countOfType(key) >= 1)) {
          groups.push(keys.flatMap((key) => takeByTypeKey(key, 1)));
          progress = true;
          break;
        }
      }
    }
  }

  groups.sort((a, b) => {
    const ka = tileTypeKey(a[0].id);
    const kb = tileTypeKey(b[0].id);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return [...groups.flat(), ...sortBySuitThenRank(pool)];
}

export function applySort(mode: SortMode, hand: WireTile[]): WireTile[] {
  if (mode === "suit-rank") {
    return sortBySuitThenRank(hand);
  }
  if (mode === "sets") {
    return sortBySetsAndConnections(hand);
  }
  return hand;
}
