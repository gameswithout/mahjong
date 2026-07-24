import type { MatchTableState, SeatState } from "./matchTableTypes";
import { tile } from "./matchTableTypes";

// A realistic mid-hand snapshot chosen to stress-test the §9.2
// simultaneous-visibility layout at its worst case: the local seat holds a
// full 17-tile hand (the moment right after drawing, before discarding —
// the largest the hand row ever gets), one seat already has two exposed
// melds, and every seat has an accumulating discard pile.
const localHand = [
  "characters-1-1",
  "characters-2-1",
  "characters-3-1",
  "characters-5-1",
  "characters-5-2",
  "bamboo-4-1",
  "bamboo-5-1",
  "bamboo-6-1",
  "bamboo-9-1",
  "dots-2-1",
  "dots-2-2",
  "dots-2-3",
  "dots-7-1",
  "wind-east-1",
  "wind-east-2",
  "dragon-red-1",
  "flower-spring",
].map(tile);

const eastMelds = [
  { id: "e-m1", type: "pong" as const, tiles: ["bamboo-1-1", "bamboo-1-2", "bamboo-1-3"].map(tile) },
  { id: "e-m2", type: "chow" as const, tiles: ["dots-4-1", "dots-5-1", "dots-6-1"].map(tile) },
];

function discardRow(ids: string[]) {
  return ids.map(tile);
}

const seats: Record<string, SeatState> = {
  S: {
    seat: "S",
    displayName: "You",
    wind: "S",
    isDealer: false,
    isActive: true,
    handCount: localHand.length,
    hand: localHand,
    melds: [],
    discards: discardRow(["characters-9-1", "dots-1-1", "bamboo-3-1", "wind-north-1"]),
  },
  W: {
    seat: "W",
    displayName: "Bot",
    wind: "W",
    isDealer: false,
    isActive: false,
    handCount: 13,
    melds: [],
    discards: discardRow(["dots-9-1", "characters-4-1", "bamboo-8-1", "dragon-white-1", "characters-6-1"]),
  },
  N: {
    seat: "N",
    displayName: "Bot",
    wind: "N",
    isDealer: false,
    isActive: false,
    handCount: 14,
    melds: [],
    discards: discardRow(["bamboo-2-1", "dots-3-1", "characters-8-1"]),
  },
  E: {
    seat: "E",
    displayName: "Bot",
    wind: "E",
    isDealer: true,
    isActive: false,
    handCount: 8,
    melds: eastMelds,
    discards: discardRow(["dots-8-1", "wind-south-1", "characters-2-2", "bamboo-7-1", "dots-6-2", "characters-7-1"]),
  },
};

export const mockMatchTableState: MatchTableState = {
  localSeat: "S",
  prevailingWind: "E",
  continuation: 2,
  wall: { drawableRemaining: 41, reserveRemaining: 16 },
  seats: seats as MatchTableState["seats"],
  lastDiscard: { seat: "E", tile: tile("dots-6-2") },
  claimSource: "E",
  countdownSeconds: 7,
  countdownTotalSeconds: 15,
  untimed: false,
  legalActions: [
    { id: "Pass", label: "Pass" },
    {
      id: "Chow",
      label: "Chow",
      chowPreview: {
        tiles: ["dots-4-1", "dots-5-1", "dots-6-2"].map(tile),
        claimedTileId: "dots-6-2",
      },
    },
    { id: "Pong", label: "Pong" },
    { id: "Win", label: "Win" },
  ],
  waits: [
    { tile: tile("characters-4-2"), visibleRemaining: 2 },
    { tile: tile("dots-9-3"), visibleRemaining: 0 },
  ],
};

// A second scenario exercising the timer's urgent state (<=3s) and a
// discard with no legal claim response other than Pass, to validate that
// state's visibility too.
export const mockMatchTableUrgentState: MatchTableState = {
  ...mockMatchTableState,
  countdownSeconds: 2,
  legalActions: [{ id: "Pass", label: "Pass" }],
};
