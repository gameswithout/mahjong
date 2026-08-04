// §6 pattern guide: what each scoring line actually rewards.
//
// The result screen already names the patterns a hand scored. Naming them
// teaches nothing — "Half Flush 4台" tells a player what happened, not what to
// do differently. This is the missing half: what the pattern is, how a hand
// grows into it, and what it becomes if pushed one step further.
//
// Three rules shaped the copy:
//
//   1. **Lead with the upgrade, not the definition.** A dictionary entry is
//      inert. "Drop the honours and the same hand is Full Flush — double" is
//      the sentence that changes the next discard.
//   2. **Never claim the player was close.** Whether this hand was one tile
//      from a bigger pattern needs analysis this screen does not do, and a
//      wrong "so close!" is worse than silence. Upgrade paths are stated as
//      facts about the pattern, always true, never as claims about the hand.
//   3. **Say what it costs.** "Be aggressive" without the trade-off is bad
//      advice. Concealed hands pay more and win less often; a player told only
//      the upside will chase and lose. Where a pattern has a real cost, it is
//      named.
//
// Every name and Tai value here must match rulesengine/scoring.go exactly.
// scoring-guide.test.ts reads that file and fails on drift, because copy that
// quietly disagrees with the engine is worse than no copy at all.

export interface PatternUpgrade {
  /** The bigger pattern this one grows into. */
  name: string;
  tai: number;
  /** What has to change. Stated about the pattern, never about this hand. */
  how: string;
}

export interface PatternGuide {
  /** Exact rulesengine pattern name. */
  name: string;
  /** Tai as awarded by rulesengine. Pinned by test to prevent drift. */
  tai: number;
  /** What the pattern is, in one line. */
  what: string;
  /** How a hand is steered toward it. */
  build?: string;
  /** The next tier up, where one exists. */
  upgrade?: PatternUpgrade;
  /** The honest cost of chasing it. */
  cost?: string;
  /**
   * True when the engine pays this per occurrence rather than once.
   *
   * Kongs are scored as a rate — `Tai: concealed * 2` — so a hand with two
   * concealed Kongs scores 4台 on one line. Displaying "2台" beside a line
   * that reads 4 would look like a bug, so the copy says "each".
   */
  perInstance?: boolean;
}

// Traditional table terms are presentation data. The rules engine keeps its
// stable English identifiers so saved matches and server contracts do not
// change when wording changes.
const TRADITIONAL_PATTERN_TERMS: Record<string, string> = {
  "Base Win": "胡 (Hu)",
  Concealed: "門前清 (Mun Chin Ching)",
  Zimo: "自摸 (Zi Mo)",
  "Concealed Zimo": "門清自摸 (Mun Ching Zi Mo)",
  "Fully Exposed": "全求人 (Chuen Kau Yan)",
  "All Chows": "平胡 (Ping Hu)",
  "All Pongs": "碰碰胡 (Pong Pong Hu)",
  "Three Concealed Pongs": "三暗刻 (Sam Am Hak)",
  "Four Concealed Pongs": "四暗刻 (Sei Am Hak)",
  "Five Concealed Pongs": "五暗刻 (Ng Am Hak)",
  "Half Flush": "混一色 (Wan Yi Se)",
  "Full Flush": "清一色 (Ching Yi Se)",
  "All Honors": "字一色 (Zi Yi Se)",
  "No Honors or Flowers": "無字無花 (Mo Zi Mo Fa)",
  "Seat Wind Set": "門風刻 (Mun Fung Hak)",
  "Prevailing Wind Set": "圈風刻 (Hyun Fung Hak)",
  "Small Three Dragons": "小三元 (Siu Sam Yuen)",
  "Big Three Dragons": "大三元 (Dai Sam Yuen)",
  "Small Four Winds": "小四喜 (Siu Sei Hei)",
  "Big Four Winds": "大四喜 (Dai Sei Hei)",
  "Concealed Kong": "暗槓 (An Gong)",
  "Exposed/Added Kong": "明槓 (Ming Gong)",
  "Single Wait": "獨聽 (Duk Teng)",
  "Win After Replacement": "槓上開花 (Gong Seung Hoi Fa)",
  "Last Tile Zimo": "海底撈月 (Hoi Dai Lau Yuet)",
  "Robbing an Added Kong": "搶槓胡 (Cheung Gong Hu)",
  "Matching Flower": "正花 (Jing Fa)",
  "Complete Flowers": "四花 (Sei Fa)",
  "Complete Seasons": "四季 (Sei Gwai)",
  "Eight Flowers": "八仙過海 (Baat Sin Gwo Hoi)",
  "Heavenly Hand": "天胡 (Tin Hu)",
  "Earthly Hand": "地胡 (Dei Hu)",
};

export function patternDisplayName(name: string): string {
  return TRADITIONAL_PATTERN_TERMS[name] ?? name;
}

const GUIDES: PatternGuide[] = [
  {
    name: "Base Win",
    tai: 1,
    what: "Every completed hand scores this. It is the floor, not a bonus.",
    build:
      "Four sets and a pair. Everything else on this list is added on top, so the "
      + "difference between a 1台 hand and a 10台 one is entirely what you build around it.",
  },
  {
    name: "Concealed",
    tai: 1,
    what: "Won on a discard with nothing melded — the whole hand built in private.",
    build: "Pass on Chow and Pong that only slightly improve the hand.",
    upgrade: {
      name: "Concealed Zimo",
      tai: 3,
      how: "Draw the winning tile yourself instead of taking a discard: 3台, not 1.",
    },
    cost: "Declining melds means a slower hand and more chances for someone else to win first.",
  },
  {
    name: "Zimo",
    tai: 1,
    what: "Self-drawn win. All three opponents pay, rather than one discarder.",
    build: "Nothing to build — it is how the winning tile arrives.",
    upgrade: {
      name: "Concealed Zimo",
      tai: 3,
      how: "The same self-draw on an unmelded hand is worth 3台 instead of 1.",
    },
  },
  {
    name: "Concealed Zimo",
    tai: 3,
    what: "Self-drawn win on a hand with nothing melded. The best of the routine wins.",
    build: "Keep the hand closed and draw your own tile.",
    cost: "Requires both patience and luck; a closed hand cannot be rescued by a discard.",
  },
  {
    name: "Fully Exposed",
    tai: 2,
    what: "Won on a discard with all five sets melded — the opposite approach to Concealed.",
    build: "Take every Chow, Pong and Kong on offer and race to finish first.",
    cost: "Every meld shows opponents what you are collecting, and the hand cannot score Concealed.",
  },
  {
    name: "All Chows",
    tai: 2,
    what: "Every set is a run. The most common shape, and the cheapest.",
    build: "Collect consecutive tiles in the same suit.",
    upgrade: {
      name: "All Pongs",
      tai: 4,
      how: "A hand of triplets instead of runs is worth double.",
    },
  },
  {
    name: "All Pongs",
    tai: 4,
    what: "Every set is a triplet or Kong. Double what runs pay.",
    build: "Pong pairs rather than chasing runs; keep pairs over lone tiles.",
    upgrade: {
      name: "Four Concealed Pongs",
      tai: 5,
      how: "Make those triplets by drawing rather than by claiming discards.",
    },
    cost: "Triplets need three of a kind, so the hand is narrower than a run-based one.",
  },
  {
    name: "Three Concealed Pongs",
    tai: 2,
    what: "Three triplets formed by drawing, not by claiming discards.",
    build: "Draw into pairs instead of Ponging them.",
    upgrade: {
      name: "Four Concealed Pongs",
      tai: 5,
      how: "One more self-drawn triplet more than doubles this.",
    },
  },
  {
    name: "Four Concealed Pongs",
    tai: 5,
    what: "Four self-drawn triplets. A serious hand.",
    upgrade: {
      name: "Five Concealed Pongs",
      tai: 8,
      how: "A fifth concealed triplet takes it to 8台.",
    },
  },
  {
    name: "Five Concealed Pongs",
    tai: 8,
    what: "Every set a self-drawn triplet. One of the rarest routine hands.",
  },
  {
    name: "Half Flush",
    tai: 4,
    what: "One numbered suit plus honour tiles.",
    build: "Pick a suit early and discard the other two; keep honours.",
    upgrade: {
      name: "Full Flush",
      tai: 8,
      how: "The same hand with the honours removed is worth double.",
    },
  },
  {
    name: "Full Flush",
    tai: 8,
    what: "One numbered suit and nothing else — no honours at all.",
    build: "Commit to a suit and discard every honour, however useful it looks.",
    cost: "Opponents read a flush quickly from your discards and will hold your suit back.",
  },
  {
    name: "All Honors",
    tai: 8,
    what: "No numbered tiles whatsoever — winds and dragons only.",
    build: "Only realistic when the deal already favours it.",
  },
  {
    name: "No Honors or Flowers",
    tai: 2,
    what: "A hand of numbered tiles alone, with no honours and no flowers scored.",
    build: "Discard honours early and take no flower bonuses.",
  },
  {
    name: "Seat Wind Set",
    tai: 1,
    what: "A triplet of your own seat wind.",
    build: "Hold a pair of your seat wind — it is worth more to you than to anyone else.",
  },
  {
    name: "Prevailing Wind Set",
    tai: 1,
    what: "A triplet of the round's prevailing wind.",
    build: "Stacks with Seat Wind Set when the two winds are the same.",
  },
  {
    name: "Small Three Dragons",
    tai: 4,
    what: "Two dragon triplets and a pair of the third.",
    upgrade: {
      name: "Big Three Dragons",
      tai: 8,
      how: "Turn that dragon pair into a triplet and the value doubles.",
    },
  },
  {
    name: "Big Three Dragons",
    tai: 8,
    what: "All three dragon triplets.",
  },
  {
    name: "Small Four Winds",
    tai: 8,
    what: "Three wind triplets and a pair of the fourth.",
    upgrade: {
      name: "Big Four Winds",
      tai: 16,
      how: "Complete the fourth wind triplet to double it again.",
    },
  },
  {
    name: "Big Four Winds",
    tai: 16,
    what: "All four wind triplets. Among the largest hands in the game.",
  },
  {
    name: "Concealed Kong",
    tai: 2,
    perInstance: true,
    what: "Four identical tiles declared from your own hand. 2台 for each one.",
    build: "Draw the fourth tile of a triplet you already hold and declare it.",
    cost: "A Kong draws a replacement tile and opens a rob window on an added Kong.",
  },
  {
    name: "Exposed/Added Kong",
    tai: 1,
    perInstance: true,
    what: "A Kong completed from a discard, or added to a melded Pong. 1台 for each one.",
    upgrade: {
      name: "Concealed Kong",
      tai: 2,
      how: "The same four tiles kept in hand are worth double.",
    },
  },
  {
    name: "Single Wait",
    tai: 1,
    what: "The hand was waiting on exactly one tile when it won.",
    build: "Not chased directly — it is the shape a narrow wait leaves behind.",
  },
  {
    name: "Win After Replacement",
    tai: 1,
    what: "Won on the replacement tile drawn after a flower or a Kong.",
  },
  {
    name: "Last Tile Zimo",
    tai: 1,
    what: "Self-drew the winning tile as the last drawable tile of the wall.",
  },
  {
    name: "Robbing an Added Kong",
    tai: 1,
    what: "Won on the tile an opponent added to their melded Pong.",
    build: "Watch for a Kong added to a meld you were already waiting on.",
  },
  {
    name: "Matching Flower",
    tai: 1,
    what: "A flower or season matching your seat position.",
    build: "Flowers are drawn, not chosen — they replace themselves automatically.",
  },
  {
    name: "Complete Flowers",
    tai: 2,
    what: "All four flowers.",
  },
  {
    name: "Complete Seasons",
    tai: 2,
    what: "All four seasons.",
  },
  {
    name: "Eight Flowers",
    tai: 8,
    what: "All eight flowers and seasons — an immediate win in its own right.",
  },
  {
    name: "Heavenly Hand",
    tai: 24,
    what: "The dealer's opening hand was already complete. The largest hand in the game.",
  },
  {
    name: "Earthly Hand",
    tai: 16,
    what: "A non-dealer won on the dealer's very first discard.",
  },
];

const BY_NAME = new Map(GUIDES.map((guide) => [guide.name, guide]));

/** The guide for a pattern, or undefined when none is written for it. */
export function patternGuide(name: string): PatternGuide | undefined {
  return BY_NAME.get(name);
}

export function allPatternGuides(): PatternGuide[] {
  return [...GUIDES];
}

/**
 * What a pattern is worth at this table, in the currency the player actually
 * cares about.
 *
 * Tai is the game's unit; Jade is the one a player feels. Returns null when the
 * stake is unknown — Practice has no stake, and inventing one would imply this
 * hand paid something it did not.
 */
export function taiValue(tai: number, stakePerTai: number | undefined): string | null {
  if (!stakePerTai || stakePerTai <= 0) return null;
  return `${(tai * stakePerTai).toLocaleString()} Jade at this table`;
}
