import type { MatchTableState, SeatState, SeatId } from "../matchTableTypes";
import { tile } from "../matchTableTypes";

// Versioned so a saved "completed the tutorial" marker can tell whether the
// player finished *this* tutorial. Bump on any change to the steps below.
export const TUTORIAL_SCRIPT_VERSION = "tutorial-v1";

// A tutorial step is either something to read or something to do. "Do" steps
// name the exact action that advances them, and the screen refuses to advance
// on anything else — a tutorial that accepts any input teaches nothing.
export type TutorialExpectation =
  | { kind: "read" }
  | { kind: "discard"; tileId: string }
  | { kind: "action"; actionId: string };

export interface TutorialStep {
  id: string;
  // Shown as the instruction. Kept to one idea per step.
  instruction: string;
  // Optional second line: the reasoning behind the instruction. Separated so
  // the instruction itself stays scannable.
  detail?: string;
  expect: TutorialExpectation;
  // What the player sees on the table for this step.
  table: MatchTableState;
  // Shown after a correct action, before moving on.
  confirmation?: string;
  // Shown when the player acts on the wrong tile or button. Never scolds; it
  // re-states the goal, because a stuck beginner needs the instruction again,
  // not a verdict.
  hint?: string;
}

export interface TutorialChapter {
  id: string;
  title: string;
  summary: string;
  steps: TutorialStep[];
}

const HAND_SORT = (ids: string[]) => ids.map(tile);

function opponent(seat: SeatId, overrides: Partial<SeatState> = {}): SeatState {
  return {
    seat,
    displayName: "Practice opponent",
    wind: seat,
    isDealer: seat === "E",
    isActive: false,
    handCount: 16,
    melds: [],
    bonusTiles: [],
    discards: [],
    ...overrides,
  };
}

function table(overrides: Partial<MatchTableState> & { hand: string[] }): MatchTableState {
  const { hand, ...rest } = overrides;
  const localHand = HAND_SORT(hand);
  return {
    localSeat: "S",
    prevailingWind: "E",
    continuation: 0,
    wall: { drawableRemaining: 48, reserveRemaining: 16 },
    seats: {
      E: opponent("E"),
      S: {
        seat: "S",
        displayName: "You",
        wind: "S",
        isDealer: false,
        isActive: true,
        handCount: localHand.length,
        hand: localHand,
        melds: [],
        bonusTiles: [],
        discards: [],
      },
      W: opponent("W"),
      N: opponent("N"),
    },
    lastDiscard: null,
    claimSource: null,
    countdownSeconds: 0,
    countdownTotalSeconds: 0,
    // §5.10: the tutorial is untimed. Nothing here should punish a player for
    // reading slowly.
    untimed: true,
    legalActions: [],
    waits: [],
    ...rest,
  };
}

// Chapter 1 — the shape of a winning hand: five sets and one pair.
const CHAPTER_ONE: TutorialChapter = {
  id: "chapter-1-sets",
  title: "Five sets and one pair",
  summary: "What a finished Taiwanese hand looks like, and how to build toward it.",
  steps: [
    {
      id: "c1-s1-shape",
      instruction: "A finished hand is five sets and one pair.",
      detail:
        "A set is three of a kind, or three consecutive tiles in one suit. The pair is two identical tiles. Sixteen tiles in hand, plus the one that finishes it.",
      expect: { kind: "read" },
      table: table({
        hand: [
          "characters-1-1", "characters-2-1", "characters-3-1",
          "bamboo-4-1", "bamboo-5-1", "bamboo-6-1",
          "dots-7-1", "dots-8-1", "dots-9-1",
          "dots-2-1", "dots-2-2", "dots-2-3",
          "wind-east-1", "wind-east-2", "wind-east-3",
          "dragon-red-1",
        ],
      }),
    },
    {
      id: "c1-s2-lone-tile",
      instruction: "Discard the red dragon.",
      detail:
        "Every other tile here already belongs to a set. The lone red dragon belongs to nothing, and one tile that belongs to nothing is what you shed first.",
      expect: { kind: "discard", tileId: "dragon-red-1" },
      hint: "Tap the red dragon 中 at the end of your hand, then tap it again to discard.",
      confirmation: "That leaves five sets and a tile short of the pair.",
      table: table({
        hand: [
          "characters-1-1", "characters-2-1", "characters-3-1",
          "bamboo-4-1", "bamboo-5-1", "bamboo-6-1",
          "dots-7-1", "dots-8-1", "dots-9-1",
          "dots-2-1", "dots-2-2", "dots-2-3",
          "wind-east-1", "wind-east-2", "wind-east-3",
          "dragon-red-1",
        ],
      }),
    },
    {
      id: "c1-s3-pair",
      instruction: "You are now waiting on one tile: another East wind.",
      detail:
        "Three East winds are a set. A fourth would be your pair — and the hand would be complete.",
      expect: { kind: "read" },
      table: table({
        hand: [
          "characters-1-1", "characters-2-1", "characters-3-1",
          "bamboo-4-1", "bamboo-5-1", "bamboo-6-1",
          "dots-7-1", "dots-8-1", "dots-9-1",
          "dots-2-1", "dots-2-2", "dots-2-3",
          "wind-east-1", "wind-east-2", "wind-east-3",
        ],
        waits: [{ tile: tile("wind-east-4"), visibleRemaining: 1 }],
        seats: {
          // The red dragon is in *your* river — you discarded it a step ago.
          E: opponent("E"),
          S: {
            seat: "S",
            displayName: "You",
            wind: "S",
            isDealer: false,
            isActive: true,
            handCount: 15,
            hand: HAND_SORT([
              "characters-1-1", "characters-2-1", "characters-3-1",
              "bamboo-4-1", "bamboo-5-1", "bamboo-6-1",
              "dots-7-1", "dots-8-1", "dots-9-1",
              "dots-2-1", "dots-2-2", "dots-2-3",
              "wind-east-1", "wind-east-2", "wind-east-3",
            ]),
            melds: [],
            bonusTiles: [],
            discards: [tile("dragon-red-1")],
          },
          W: opponent("W"),
          N: opponent("N"),
        },
      }),
    },
  ],
};

// Chapter 2 — claiming other players' discards, and who wins a contested one.
const CHAPTER_TWO: TutorialChapter = {
  id: "chapter-2-claims",
  title: "Chow, Pong, Kong",
  summary: "Taking a discarded tile, and who gets it when more than one player wants it.",
  steps: [
    {
      id: "c2-s1-pong",
      instruction: "West discarded a 2 of dots. Pong it.",
      detail:
        "You hold two already. Pong takes a discard to complete three of a kind — from any player, on any turn.",
      expect: { kind: "action", actionId: "Pong" },
      hint: "Use the Pong button below your hand.",
      confirmation: "The set is now exposed. Everyone can see it, and it can no longer change.",
      table: table({
        hand: [
          "characters-1-1", "characters-2-1", "characters-3-1",
          "bamboo-4-1", "bamboo-5-1", "bamboo-6-1",
          "dots-2-1", "dots-2-2",
          "dots-7-1", "dots-8-1",
          "wind-east-1", "wind-east-2",
          "characters-9-1", "bamboo-1-1", "dots-5-1", "dragon-green-1",
        ],
        lastDiscard: { seat: "W", tile: tile("dots-2-3") },
        claimSource: "W",
        legalActions: [
          { id: "Pass", label: "Pass" },
          { id: "Pong", label: "Pong" },
        ],
      }),
    },
    {
      id: "c2-s2-chow-only-upstream",
      instruction: "Chow is different: only from the player to your left.",
      detail:
        "A Chow is three consecutive tiles in one suit, and you may only claim it from the seat directly before yours. Pong and Kong have no such restriction.",
      expect: { kind: "read" },
      table: table({
        hand: [
          "characters-1-1", "characters-2-1", "characters-3-1",
          "bamboo-4-1", "bamboo-5-1", "bamboo-6-1",
          "dots-7-1", "dots-8-1",
          "wind-east-1", "wind-east-2",
          "characters-9-1", "bamboo-1-1", "dots-5-1",
        ],
        lastDiscard: { seat: "E", tile: tile("dots-9-1") },
        claimSource: "E",
        legalActions: [
          { id: "Pass", label: "Pass" },
          {
            id: "Chow",
            label: "Chow",
            chowPreview: {
              tiles: HAND_SORT(["dots-7-1", "dots-8-1", "dots-9-1"]),
              claimedTileId: "dots-9-1",
            },
          },
        ],
      }),
    },
    {
      id: "c2-s3-priority",
      instruction: "When two players want the same tile, the stronger claim wins.",
      detail:
        "A Win beats a Pong or Kong, and a Pong or Kong beats a Chow. Passing costs you nothing — a claim you do not want is never forced on you.",
      expect: { kind: "read" },
      table: table({
        hand: [
          "characters-1-1", "characters-2-1", "characters-3-1",
          "bamboo-4-1", "bamboo-5-1", "bamboo-6-1",
          "dots-7-1", "dots-8-1", "dots-9-1",
          "wind-east-1", "wind-east-2",
          "characters-9-1", "bamboo-1-1",
        ],
        lastDiscard: { seat: "E", tile: tile("wind-east-3") },
        claimSource: "E",
        legalActions: [
          { id: "Pass", label: "Pass" },
          { id: "Pong", label: "Pong" },
        ],
      }),
    },
  ],
};

// Chapter 3 — reading the table before discarding, and finishing a hand.
const CHAPTER_THREE: TutorialChapter = {
  id: "chapter-3-ting",
  title: "Ting, and what to discard",
  summary: "Recognising when you are one tile away, and choosing a discard that is unlikely to be claimed.",
  steps: [
    {
      id: "c3-s1-ting",
      instruction: "You are in Ting: one tile from a winning hand.",
      detail:
        "The waits panel lists what would finish it, and how many of each are still unseen. It counts only what is visible — tiles in other players' hands are unknown to everyone, including this panel.",
      expect: { kind: "read" },
      table: table({
        hand: [
          "characters-1-1", "characters-2-1", "characters-3-1",
          "bamboo-4-1", "bamboo-5-1", "bamboo-6-1",
          "dots-7-1", "dots-8-1", "dots-9-1",
          "dots-2-1", "dots-2-2", "dots-2-3",
          "wind-east-1", "wind-east-2",
          "characters-5-1", "dots-4-1",
        ],
        waits: [
          { tile: tile("wind-east-3"), visibleRemaining: 2 },
        ],
      }),
    },
    {
      id: "c3-s2-safe-discard",
      instruction: "Discard the 4 of dots, not the 5 of characters.",
      detail:
        "East has already discarded a 4 of dots. A tile someone discarded themselves cannot be claimed by them for a Win — that makes it the safer of the two.",
      expect: { kind: "discard", tileId: "dots-4-1" },
      hint: "The 4 of dots is safe because East discarded one already. Tap it, then tap again to discard.",
      confirmation: "Safe discard. Reading the discard rivers is most of what separates a careful player from a lucky one.",
      table: table({
        hand: [
          "characters-1-1", "characters-2-1", "characters-3-1",
          "bamboo-4-1", "bamboo-5-1", "bamboo-6-1",
          "dots-7-1", "dots-8-1", "dots-9-1",
          "dots-2-1", "dots-2-2", "dots-2-3",
          "wind-east-1", "wind-east-2",
          "characters-5-1", "dots-4-1",
        ],
        waits: [{ tile: tile("wind-east-3"), visibleRemaining: 2 }],
        seats: {
          E: opponent("E", {
            discards: HAND_SORT(["dots-4-2", "bamboo-9-1", "characters-7-1"]),
          }),
          S: {
            seat: "S",
            displayName: "You",
            wind: "S",
            isDealer: false,
            isActive: true,
            handCount: 16,
            hand: HAND_SORT([
              "characters-1-1", "characters-2-1", "characters-3-1",
              "bamboo-4-1", "bamboo-5-1", "bamboo-6-1",
              "dots-7-1", "dots-8-1", "dots-9-1",
              "dots-2-1", "dots-2-2", "dots-2-3",
              "wind-east-1", "wind-east-2",
              "characters-5-1", "dots-4-1",
            ]),
            melds: [],
            bonusTiles: [],
            discards: [],
          },
          W: opponent("W", { discards: HAND_SORT(["dragon-white-1"]) }),
          N: opponent("N", { discards: HAND_SORT(["bamboo-2-1"]) }),
        },
      }),
    },
    {
      id: "c3-s3-win",
      instruction: "North discarded your East wind. Take the win.",
      detail: "This is the tile you were waiting for. Claiming it on a discard completes the hand.",
      expect: { kind: "action", actionId: "Win" },
      hint: "Use the Win button below your hand.",
      confirmation: "That is a complete hand: five sets and a pair.",
      table: table({
        hand: [
          "characters-1-1", "characters-2-1", "characters-3-1",
          "bamboo-4-1", "bamboo-5-1", "bamboo-6-1",
          "dots-7-1", "dots-8-1", "dots-9-1",
          "dots-2-1", "dots-2-2", "dots-2-3",
          "wind-east-1", "wind-east-2",
          "characters-5-1",
        ],
        lastDiscard: { seat: "N", tile: tile("wind-east-3") },
        claimSource: "N",
        waits: [{ tile: tile("wind-east-3"), visibleRemaining: 2 }],
        legalActions: [
          { id: "Pass", label: "Pass" },
          {
            id: "Win",
            label: "Win",
            preview: {
              rawTai: 2,
              patterns: [
                { name: "Base Win", tai: 1 },
                { name: "Seat Wind set", tai: 1 },
              ],
            },
          },
        ],
      }),
    },
  ],
};

export const TUTORIAL_CHAPTERS: TutorialChapter[] = [CHAPTER_ONE, CHAPTER_TWO, CHAPTER_THREE];

export function allTutorialSteps(): TutorialStep[] {
  return TUTORIAL_CHAPTERS.flatMap((chapter) => chapter.steps);
}
