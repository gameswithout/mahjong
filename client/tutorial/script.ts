import type { MatchTableState, SeatState, SeatId } from "../matchTableTypes";
import { tile } from "../matchTableTypes";

// Versioned so a saved "completed the tutorial" marker can tell whether the
// player finished *this* tutorial. Bump whenever the learning path changes.
export const TUTORIAL_SCRIPT_VERSION = "tutorial-v2";

// A tutorial step is either something to read or something to do. "Do" steps
// name the exact interaction that advances them, and the screen refuses to
// advance on anything else.
export type TutorialExpectation =
  | { kind: "read" }
  | { kind: "draw" }
  | { kind: "discard"; tileId: string }
  | { kind: "action"; actionId: string }
  | { kind: "answer"; answerId: string };

export interface TutorialTerm {
  term: string;
  meaning: string;
}

export interface TutorialAnswer {
  id: string;
  label: string;
}

export interface TutorialScoreBreakdown {
  title: string;
  lines: { label: string; tai: number }[];
  total: number;
}

export interface TutorialStep {
  id: string;
  // Shown as the instruction. Kept to one idea per step.
  instruction: string;
  // Optional second line: the reasoning behind the instruction. Separated so
  // the instruction itself stays scannable.
  detail?: string;
  // A compact takeaway that stays visually separate from explanatory prose.
  keyPoint?: string;
  // Plain-language definitions shown only when a step introduces vocabulary.
  terms?: TutorialTerm[];
  // Used by the Tai lesson to make the addition visible, not tooltip-only.
  score?: TutorialScoreBreakdown;
  answers?: TutorialAnswer[];
  expect: TutorialExpectation;
  // What the player sees on the table for this step.
  table: MatchTableState;
  // Shown after a correct action, before moving on.
  confirmation?: string;
  // Shown when the player acts on the wrong tile, button, or answer. Never
  // scolds; a stuck beginner needs the goal again, not a verdict.
  hint?: string;
}

export interface TutorialChapter {
  id: string;
  title: string;
  summary: string;
  steps: TutorialStep[];
}

const HAND_SORT = (ids: string[]) => ids.map(tile);

function opponent(
  seat: SeatId,
  activeSeat: SeatId,
  discards: string[] = [],
): SeatState {
  return {
    seat,
    displayName: "Practice opponent",
    wind: seat,
    isDealer: seat === "E",
    isActive: activeSeat === seat,
    handCount: 16,
    melds: [],
    bonusTiles: [],
    discards: HAND_SORT(discards),
  };
}

type TutorialTableOptions = Omit<
  Partial<MatchTableState>,
  "seats" | "localSeat"
> & {
  hand: string[];
  activeSeat?: SeatId;
  bonusTiles?: string[];
  discards?: Partial<Record<SeatId, string[]>>;
};

function table(options: TutorialTableOptions): MatchTableState {
  const {
    hand,
    activeSeat = "S",
    bonusTiles = [],
    discards = {},
    ...overrides
  } = options;
  const localHand = HAND_SORT(hand);
  return {
    localSeat: "S",
    prevailingWind: "E",
    continuation: 0,
    wall: { drawableRemaining: 48, reserveRemaining: 16 },
    seats: {
      E: opponent("E", activeSeat, discards.E),
      S: {
        seat: "S",
        displayName: "You",
        wind: "S",
        isDealer: false,
        isActive: activeSeat === "S",
        handCount: localHand.length,
        hand: localHand,
        melds: [],
        bonusTiles: HAND_SORT(bonusTiles),
        discards: HAND_SORT(discards.S ?? []),
      },
      W: opponent("W", activeSeat, discards.W),
      N: opponent("N", activeSeat, discards.N),
    },
    lastDiscard: null,
    claimSource: null,
    countdownSeconds: 0,
    countdownTotalSeconds: 0,
    // The tutorial is untimed. Nothing here should punish a player for
    // reading slowly or trying the wrong control.
    untimed: true,
    legalActions: [],
    waits: [],
    ...overrides,
  };
}

const TURN_HAND = [
  "characters-1-1",
  "characters-2-1",
  "characters-4-1",
  "characters-9-1",
  "bamboo-2-1",
  "bamboo-3-1",
  "bamboo-5-1",
  "bamboo-6-1",
  "dots-1-1",
  "dots-3-1",
  "dots-5-1",
  "dots-7-1",
  "wind-east-1",
  "wind-south-1",
  "dragon-white-1",
  "dragon-green-1",
];

// Four complete groups, one pair, and 8–9 of Characters waiting for the 7.
// Claiming that 7 creates the fifth group and a legal 17-tile hand.
const READY_HAND = [
  "characters-1-1",
  "characters-2-1",
  "characters-3-1",
  "characters-8-1",
  "characters-9-1",
  "bamboo-4-1",
  "bamboo-5-1",
  "bamboo-6-1",
  "dots-2-1",
  "dots-2-2",
  "dots-2-3",
  "dots-7-1",
  "dots-8-1",
  "dots-9-1",
  "wind-east-1",
  "wind-east-2",
];

const THREE_TAI_SCORE: TutorialScoreBreakdown = {
  title: "This hand's Tai",
  lines: [
    { label: "Base Win — every legal win", tai: 1 },
    { label: "Concealed — no open claims", tai: 1 },
    { label: "Single Wait — only one tile can finish it", tai: 1 },
  ],
  total: 3,
};

// Chapter 1 — the turn loop before any Mahjong-specific vocabulary.
const CHAPTER_ONE: TutorialChapter = {
  id: "chapter-1-first-turn",
  title: "Your first turn",
  summary: "Learn the goal and practise the draw-one, discard-one rhythm.",
  steps: [
    {
      id: "c1-s1-goal",
      instruction: "Finish a complete hand before anyone else.",
      detail:
        "This is Taiwanese 16-tile Mahjong. You normally hold 16 tiles. The tile that completes your hand makes 17, and then you choose Win.",
      keyPoint: "For now, remember only this: collect useful groups and keep one pair.",
      terms: [
        {
          term: "Hand",
          meaning: "The tiles you are building. Your tiles are always along the bottom.",
        },
        {
          term: "Wall",
          meaning: "The shared supply of face-down tiles in the middle.",
        },
      ],
      expect: { kind: "read" },
      table: table({ hand: TURN_HAND }),
    },
    {
      id: "c1-s2-draw",
      instruction: "Start your turn by drawing one tile.",
      detail:
        "Most turns are simple: draw one tile, decide what helps, then discard one tile. There is no timer in this lesson.",
      keyPoint: "Draw 1 → inspect your hand → discard 1",
      expect: { kind: "draw" },
      hint: "Choose Draw now in the action bar below the table.",
      table: table({ hand: TURN_HAND }),
    },
    {
      id: "c1-s3-discard",
      instruction: "You drew a Red Dragon. Discard it to return to 16 tiles.",
      detail:
        "Tap the tile once to inspect it, then tap the same tile again to discard. The two-tap action helps prevent accidental discards.",
      expect: { kind: "discard", tileId: "dragon-red-1" },
      hint: "Find the Red Dragon marked 中 at the end of your hand. Tap it twice.",
      confirmation:
        "Nice. Your turn is complete: you drew one tile and discarded one tile.",
      table: table({ hand: [...TURN_HAND, "dragon-red-1"] }),
    },
  ],
};

// Chapter 2 — tile families and the exact legal winning shape.
const CHAPTER_TWO: TutorialChapter = {
  id: "chapter-2-winning-shape",
  title: "Build a winning hand",
  summary: "Meet the tile families and see exactly what five groups plus a pair means.",
  steps: [
    {
      id: "c2-s1-tile-families",
      instruction: "Numbered tiles come in three suits: Characters, Bamboo, and Dots.",
      detail:
        "Each suit runs from 1 to 9. Winds and Dragons are Honor tiles and match only identical copies. Flower and Season bonus tiles are revealed and replaced automatically.",
      terms: [
        {
          term: "Suit",
          meaning: "One numbered family: Characters, Bamboo, or Dots.",
        },
        {
          term: "Honor",
          meaning: "A Wind or Dragon. Honors do not form number sequences.",
        },
        {
          term: "Bonus tile",
          meaning: "A Flower or Season. The game reveals it and draws a replacement for you.",
        },
      ],
      expect: { kind: "read" },
      table: table({
        hand: [
          "characters-1-1",
          "characters-5-1",
          "characters-9-1",
          "bamboo-1-1",
          "bamboo-5-1",
          "bamboo-9-1",
          "dots-1-1",
          "dots-5-1",
          "dots-9-1",
          "wind-east-1",
          "wind-south-1",
          "wind-west-1",
          "wind-north-1",
          "dragon-red-1",
          "dragon-green-1",
          "dragon-white-1",
        ],
        bonusTiles: ["flower-summer"],
      }),
    },
    {
      id: "c2-s2-groups",
      instruction: "A normal winning hand is five groups plus one matching pair.",
      detail:
        "A group is either three consecutive numbers in one suit, three identical tiles, or four identical tiles. A pair is two identical tiles.",
      keyPoint: "5 groups + 1 pair = a complete hand",
      terms: [
        {
          term: "Sequence (Chow)",
          meaning: "Three consecutive numbers in one suit, such as 4–5–6 Bamboo.",
        },
        {
          term: "Triplet (Pong)",
          meaning: "Three identical tiles, such as three 2 Dots.",
        },
        {
          term: "Four of a kind (Kong / Gang)",
          meaning: "Four identical tiles. It counts as one group and gives a replacement draw.",
        },
        {
          term: "Pair",
          meaning: "Two identical tiles. A normal hand needs exactly one.",
        },
      ],
      expect: { kind: "read" },
      table: table({
        hand: READY_HAND,
        waits: [{ tile: tile("characters-7-1"), visibleRemaining: 4 }],
      }),
    },
    {
      id: "c2-s3-ready",
      instruction: "This hand needs the 7 of Characters to become complete.",
      detail:
        "It already has four finished groups and a pair of East Winds. The 8–9 Characters need the 7 to form the fifth group: 7–8–9.",
      keyPoint:
        "When only one more tile can complete your hand, you are Ready — also called Ting.",
      terms: [
        {
          term: "Ready (Ting)",
          meaning: "Your hand is one tile away from winning.",
        },
        {
          term: "Winning tile / wait",
          meaning: "A tile that would complete your hand. The Ready panel shows every option.",
        },
      ],
      expect: { kind: "read" },
      table: table({
        hand: READY_HAND,
        waits: [{ tile: tile("characters-7-1"), visibleRemaining: 4 }],
      }),
    },
  ],
};

// Chapter 3 — claim vocabulary introduced as plain-language translations.
const CHAPTER_THREE: TutorialChapter = {
  id: "chapter-3-claims",
  title: "Use another player's discard",
  summary: "Learn what the claim buttons mean and try a Pong and a Chow.",
  steps: [
    {
      id: "c3-s1-claim-words",
      instruction: "Sometimes another player's discard can finish one of your groups.",
      detail:
        "When that happens, the game shows only the legal claim buttons. You may always Pass and wait for your own draw instead.",
      terms: [
        {
          term: "Chow",
          meaning: "Take the previous player's discard to finish a three-number sequence.",
        },
        {
          term: "Pong",
          meaning: "Take any player's discard to finish three identical tiles.",
        },
        {
          term: "Kong / Gang",
          meaning: "Complete four identical tiles, then receive a replacement draw.",
        },
        {
          term: "Pass",
          meaning: "Do not take the discard. Passing an unwanted group claim is safe.",
        },
      ],
      expect: { kind: "read" },
      table: table({ hand: TURN_HAND }),
    },
    {
      id: "c3-s2-pong",
      instruction: "West discarded a 2 of Dots. Use Pong to take it.",
      detail:
        "You already hold two matching 2 Dots. Pong combines them with the discard to expose a group of three identical tiles.",
      expect: { kind: "action", actionId: "Pong" },
      hint: "Choose Pong in the action bar below the table.",
      confirmation:
        "Pong made a visible group of three. After any Chow or Pong, you discard one tile.",
      table: table({
        hand: [
          "characters-1-1",
          "characters-2-1",
          "characters-3-1",
          "characters-9-1",
          "bamboo-1-1",
          "bamboo-4-1",
          "bamboo-5-1",
          "bamboo-6-1",
          "dots-2-1",
          "dots-2-2",
          "dots-5-1",
          "dots-7-1",
          "dots-8-1",
          "wind-east-1",
          "wind-east-2",
          "dragon-green-1",
        ],
        activeSeat: "W",
        lastDiscard: { seat: "W", tile: tile("dots-2-3") },
        claimSource: "W",
        legalActions: [
          { id: "Pass", label: "Pass" },
          { id: "Pong", label: "Pong" },
        ],
      }),
    },
    {
      id: "c3-s3-chow",
      instruction: "East discarded a 3 of Characters. Use Chow to make 1–2–3.",
      detail:
        "Chow makes a number sequence, so it works only in one suit and only on the discard from the player immediately before you in turn order.",
      expect: { kind: "action", actionId: "Chow" },
      hint: "Choose the Chow option that previews 1–2–3 Characters.",
      confirmation:
        "Chow made a visible sequence. Win claims beat Pong or Kong claims, which beat Chow claims.",
      table: table({
        hand: [
          "characters-1-1",
          "characters-2-1",
          "characters-9-1",
          "bamboo-1-1",
          "bamboo-4-1",
          "bamboo-5-1",
          "bamboo-6-1",
          "dots-2-1",
          "dots-2-2",
          "dots-2-3",
          "dots-5-1",
          "dots-7-1",
          "dots-8-1",
          "dots-9-1",
          "wind-east-1",
          "wind-east-2",
        ],
        activeSeat: "E",
        lastDiscard: { seat: "E", tile: tile("characters-3-2") },
        claimSource: "E",
        legalActions: [
          { id: "Pass", label: "Pass" },
          {
            id: "Chow",
            label: "Chow",
            chowPreview: {
              tiles: HAND_SORT([
                "characters-1-1",
                "characters-2-1",
                "characters-3-2",
              ]),
              claimedTileId: "characters-3-2",
            },
          },
        ],
      }),
    },
  ],
};

// Chapter 4 — make Ready/Ting, Tai, and the final Win action concrete.
const CHAPTER_FOUR: TutorialChapter = {
  id: "chapter-4-tai-and-win",
  title: "Count Tai and win",
  summary: "Add a small Tai example, then claim the tile that completes the hand.",
  steps: [
    {
      id: "c4-s1-read-ready-panel",
      instruction: "The Ready panel shows which tiles can complete your hand.",
      detail:
        "Here it shows the 7 of Characters. “4 left” means none of its four copies are visible on the table yet; some may still be hidden in other hands.",
      keyPoint:
        "You do not have to work out every possible winning tile yourself — the Ready panel checks the legal shape.",
      expect: { kind: "read" },
      table: table({
        hand: READY_HAND,
        waits: [{ tile: tile("characters-7-1"), visibleRemaining: 4 }],
      }),
    },
    {
      id: "c4-s2-count-tai",
      instruction: "Tai is the score for a winning hand. Add the awarded lines.",
      detail:
        "Every legal hand receives 1 Base Win Tai, so there is no separate minimum-Tai gate. Extra patterns add more, and the game lists them for you.",
      keyPoint: "Tai measures the winning patterns. It is not the number of tiles.",
      terms: [
        {
          term: "Tai",
          meaning: "Points awarded for a legal win and its scoring patterns.",
        },
        {
          term: "Concealed",
          meaning: "You did not open your hand with Chow, Pong, or an exposed Kong.",
        },
        {
          term: "Single Wait",
          meaning: "Only one tile identity can complete the hand.",
        },
      ],
      score: THREE_TAI_SCORE,
      answers: [
        { id: "2", label: "2 Tai" },
        { id: "3", label: "3 Tai" },
        { id: "5", label: "5 Tai" },
      ],
      expect: { kind: "answer", answerId: "3" },
      hint: "Add the three lines: 1 + 1 + 1.",
      confirmation:
        "Correct: 1 Base Win + 1 Concealed + 1 Single Wait = 3 Tai.",
      table: table({
        hand: READY_HAND,
        waits: [{ tile: tile("characters-7-1"), visibleRemaining: 4 }],
      }),
    },
    {
      id: "c4-s3-win",
      instruction: "North discarded your 7 of Characters. Choose Win.",
      detail:
        "The Win button appears only because this tile legally completes five groups plus one pair. If you draw the winning tile yourself, the button says Self-Draw (Zimo).",
      terms: [
        {
          term: "Win (Hu)",
          meaning: "Claim another player's discard to complete your hand.",
        },
        {
          term: "Self-Draw (Zimo)",
          meaning: "Draw the tile that completes your own hand.",
        },
      ],
      score: THREE_TAI_SCORE,
      expect: { kind: "action", actionId: "Win" },
      hint: "Choose the Win button showing 3 Tai in the action bar.",
      confirmation:
        "You won: five groups plus one pair, worth 3 Tai in this example.",
      table: table({
        hand: READY_HAND,
        activeSeat: "N",
        lastDiscard: { seat: "N", tile: tile("characters-7-1") },
        claimSource: "N",
        legalActions: [
          { id: "Pass", label: "Pass" },
          {
            id: "Win",
            label: "Win",
            preview: {
              rawTai: 3,
              patterns: THREE_TAI_SCORE.lines.map((line) => ({
                name: line.label.split(" — ")[0],
                tai: line.tai,
              })),
            },
          },
        ],
      }),
    },
  ],
};

export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
  CHAPTER_ONE,
  CHAPTER_TWO,
  CHAPTER_THREE,
  CHAPTER_FOUR,
];

export function allTutorialSteps(): TutorialStep[] {
  return TUTORIAL_CHAPTERS.flatMap((chapter) => chapter.steps);
}
