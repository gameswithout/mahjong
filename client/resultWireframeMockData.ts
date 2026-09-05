// Fixtures for the P0.3 result-comprehension evidence harness
// (result-wireframe.html). These mirror the shapes the component tests
// already assert against, so a rendered capture and the component suite are
// describing the same result scenarios rather than drifting apart.
//
// Every field here is authoritative server output in production: the result
// screen recomputes no legality, scoring, transfer, cap, or balance.
import type { SeatView } from "../protocol/envelope";

export type ResultScenarioId =
  | "jade-capped"
  | "jade-standard"
  | "self-draw"
  | "multi-winner"
  | "practice"
  | "exhaustive-draw"
  | "deal-in-review"
  | "alternate-settlement";

const TAIWANESE_SETTLEMENT_METHOD = {
  id: "taiwanese-linear-base-tai-v1",
  model: "linear_base_tai",
  base_units: 1,
  tai_cap: 16,
  dealer_multiplier: 2,
};

function taiwaneseCalculation(unitValue: number, tai: number, multiplier: number) {
  return {
    method_id: TAIWANESE_SETTLEMENT_METHOD.id,
    model: TAIWANESE_SETTLEMENT_METHOD.model,
    unit_value: unitValue,
    components: [
      { kind: "base", units: 1, amount: unitValue },
      { kind: "tai", units: tai, amount: unitValue * tai },
    ],
    multiplier,
  };
}

function baseCompletedView(): SeatView {
  return {
    match_id: "3a205eaa57b34fc991022c63a20bee09",
    seat: "E",
    state_version: 42,
    phase: "hand_complete",
    active_seat: "E",
    own_hand: [],
    own_exposed: [],
    players: [
      { seat: "E", hand_count: 0 },
      { seat: "S", hand_count: 0 },
      { seat: "W", hand_count: 0 },
      { seat: "N", hand_count: 0 },
    ],
    wall: { remaining: 20, drawable_remaining: 4, reserve_remaining: 16 },
    hand_result: {
      kind: "discard",
      payer: "S",
      winning_tile_id: "dots-1-1",
      winners: [
        {
          seat: "E",
          context: { seat: "E", prevailing_wind: "E", discard_win: true },
          score: {
            winning: true,
            raw_tai: 3,
            patterns: [
              { name: "Seat Wind", tai: 1 },
              { name: "All Chows", tai: 2 },
            ],
            shape: {
              pair: [
                { id: "dots-1-1", kind: "dots", rank: 1, copy: 1 },
                { id: "dots-1-2", kind: "dots", rank: 1, copy: 2 },
              ],
              melds: [
                {
                  type: "chow",
                  tiles: [
                    { id: "bamboo-2-1", kind: "bamboo", rank: 2, copy: 1 },
                    { id: "bamboo-3-1", kind: "bamboo", rank: 3, copy: 1 },
                    { id: "bamboo-4-1", kind: "bamboo", rank: 4, copy: 1 },
                  ],
                },
                {
                  type: "chow",
                  tiles: [
                    { id: "characters-5-1", kind: "characters", rank: 5, copy: 1 },
                    { id: "characters-6-1", kind: "characters", rank: 6, copy: 1 },
                    { id: "characters-7-1", kind: "characters", rank: 7, copy: 1 },
                  ],
                },
              ],
            },
            effective_tiles: 17,
          },
        },
      ],
    },
    settlement: {
      method: TAIWANESE_SETTLEMENT_METHOD,
      transfers: [{
        from: "S", to: "E", effective_tai: 8, raw_amount: 8, amount: 8,
        calculation: taiwaneseCalculation(1, 3, 2),
      }],
      net: { E: 8, S: -8 },
      total_credits: 8,
      total_debits: 8,
    },
    next_dealer: { next_dealer: "S", next_continuations: 0, dealer_retains: false },
    xp_award: {
      award_id: "hand:3a205eaa57b34fc991022c63a20bee09:player-east",
      source: "public_hand",
      total: 205,
      components: [
        { code: "hand_completed", label: "Hand completed", amount: 100 },
        { code: "hand_won", label: "Won the hand", amount: 75 },
        { code: "tai", label: "Tai scored", amount: 30 },
      ],
    },
    progression: {
      level: 2,
      lifetime_xp: 705,
      xp_into_level: 205,
      xp_for_next_level: 600,
      earned: [
        {
          code: "level-2-student-title",
          level: 2,
          kind: "title",
          name: "Student",
        },
      ],
      next: {
        code: "level-5-tea-house-theme",
        level: 5,
        kind: "table_theme",
        name: "Tea House",
      },
    },
  };
}

// The §9.7 cap disclosure: the uncapped calculation and the applied cap have
// to stay legible together, which is the hardest case for the compact
// 640x360 landscape minimum.
function jadeCappedView(): SeatView {
  const view = baseCompletedView();
  // The displayed hand can exceed the ordinary 16-Tai payment cap. Dealer
  // involvement doubles the base-plus-capped-Tai obligation to 34 units.
  const winner = view.hand_result?.winners?.[0];
  if (winner) {
    winner.score.raw_tai = 44;
    winner.score.patterns = [
      { name: "Big Four Winds", tai: 16 },
      { name: "All Honors", tai: 16 },
      { name: "Concealed Hand", tai: 5 },
      { name: "Flowers", tai: 5 },
      { name: "Seat Wind", tai: 1 },
      { name: "Round Wind", tai: 1 },
    ];
  }
  view.jade_account = {
    currency_code: "JADE",
    balance: 300_000,
    reserved: 0,
    available: 300_000,
    eligible: true,
    minimum_balance: 500_000,
    stake_per_tai: 10_000,
    debit_cap: 300_000,
    wallet_sync_status: "synced",
  };
  view.settlement = {
    method: TAIWANESE_SETTLEMENT_METHOD,
    transfers: [
      {
        from: "S", to: "E", effective_tai: 34, raw_amount: 340_000, amount: 300_000, capped: true,
        calculation: taiwaneseCalculation(10_000, 16, 2),
      },
    ],
    net: { E: 300_000, S: -300_000, W: 0, N: 0 },
    total_credits: 300_000,
    total_debits: 300_000,
  };
  view.jade_settlement = {
    seat: "E",
    delta: 300_000,
    balance_before: 5_000,
    balance_after: 305_000,
    journal_id: "settlement:8ccf9cf1baf43b96f46b3a819c69a74105c99e59b3d6984fd7fb68f3d0f5e60e",
  };
  return view;
}

// An ordinary Bamboo-tier hand where all four seats move, including the two
// that neither paid nor received — the four-seat net summary has to show a
// zero as explicitly as it shows a debit.
function jadeStandardView(): SeatView {
  const view = baseCompletedView();
  view.achievements = [
    {
      award_id: "achievement:first-hand:player-east",
      source: "achievement",
      total: 100,
      components: [{ code: "first-hand", label: "First Hand", amount: 100 }],
    },
    {
      award_id: "achievement:first-win:player-east",
      source: "achievement",
      total: 200,
      components: [{ code: "first-win", label: "First Win", amount: 200 }],
    },
  ];
  view.jade_account = {
    currency_code: "JADE",
    balance: 5_080,
    reserved: 300,
    available: 4_780,
    eligible: true,
    minimum_balance: 1_000,
    stake_per_tai: 10,
    debit_cap: 300,
    wallet_sync_status: "synced",
  };
  view.settlement = {
    method: TAIWANESE_SETTLEMENT_METHOD,
    transfers: [{
      from: "S", to: "E", effective_tai: 8, raw_amount: 80, amount: 80,
      calculation: taiwaneseCalculation(10, 3, 2),
    }],
    net: { E: 80, S: -80, W: 0, N: 0 },
    total_credits: 80,
    total_debits: 80,
  };
  view.jade_settlement = {
    seat: "E",
    delta: 80,
    balance_before: 5_000,
    balance_after: 5_080,
    journal_id: "settlement:8ccf9cf1baf43b96f46b3a819c69a74105c99e59b3d6984fd7fb68f3d0f5e60e",
  };
  return view;
}

// A dealer self-draw creates one independently calculated payment from every
// opponent. Keeping this as rendered evidence protects both the three-row
// settlement shape and the aggregate four-seat reconciliation.
function selfDrawView(): SeatView {
  const view = jadeStandardView();
  if (view.hand_result) {
    view.hand_result.kind = "zimo";
    delete view.hand_result.payer;
  }
  view.settlement = {
    method: TAIWANESE_SETTLEMENT_METHOD,
    transfers: (["S", "W", "N"] as const).map((from) => ({
      from,
      to: "E" as const,
      effective_tai: 8,
      raw_amount: 80,
      amount: 80,
      calculation: taiwaneseCalculation(10, 3, 2),
    })),
    net: { E: 240, S: -80, W: -80, N: -80 },
    total_credits: 240,
    total_debits: 240,
  };
  view.jade_settlement = {
    seat: "E",
    delta: 240,
    balance_before: 5_000,
    balance_after: 5_240,
    journal_id: "settlement:self-draw",
  };
  return view;
}

// Two winners share one discard payer's debit cap. The authoritative transfer
// rows retain each uncapped calculation while showing the server allocation.
function multiWinnerView(): SeatView {
  const view = jadeStandardView();
  const original = view.hand_result?.winners?.[0];
  if (!view.hand_result || !original) return view;
  view.hand_result.payer = "N";
  view.hand_result.winners = [
    {
      ...original,
      seat: "S",
      context: { ...original.context, seat: "S" },
      score: { ...original.score, raw_tai: 20 },
    },
    {
      ...original,
      seat: "W",
      context: { ...original.context, seat: "W" },
      score: { ...original.score, raw_tai: 15 },
    },
  ];
  view.settlement = {
    method: TAIWANESE_SETTLEMENT_METHOD,
    transfers: [
      {
        from: "N", to: "S", effective_tai: 17, raw_amount: 170, amount: 155, capped: true,
        calculation: taiwaneseCalculation(10, 16, 1),
      },
      {
        from: "N", to: "W", effective_tai: 16, raw_amount: 160, amount: 145, capped: true,
        calculation: taiwaneseCalculation(10, 15, 1),
      },
    ],
    net: { E: 0, S: 155, W: 145, N: -300 },
    total_credits: 300,
    total_debits: 300,
  };
  view.jade_settlement = {
    seat: "E",
    delta: 0,
    balance_before: 5_000,
    balance_after: 5_000,
    journal_id: "settlement:multi-winner",
  };
  return view;
}

// Practice saves a small, capped mastery award and history while leaving Jade,
// rating, and achievements untouched.
function practiceView(): SeatView {
  const view = baseCompletedView();
  view.match_id = "practice-1";
  view.xp_award = {
    award_id: "hand:practice-1:player-east",
    source: "practice_hand",
    total: 25,
    components: [{ code: "practice_hand", label: "Practice mastery", amount: 25 }],
  };
  view.progression = {
    level: 2,
    lifetime_xp: 525,
    xp_into_level: 25,
    xp_for_next_level: 600,
    earned: [
      {
        code: "level-2-student-title",
        level: 2,
        kind: "title",
        name: "Student",
      },
    ],
    next: {
      code: "level-5-tea-house-theme",
      level: 5,
      kind: "table_theme",
      name: "Tea House",
    },
  };
  return view;
}

function exhaustiveDrawView(): SeatView {
  const view = baseCompletedView();
  view.phase = "exhaustive_draw";
  view.hand_result = {
    kind: "exhaustive_draw",
    draw_analysis: [
      {
        seat: "E",
        tenpai: true,
        waits: [
          {
            tile: { id: "dots-5-2", kind: "dots", rank: 5, copy: 2 },
            visible_remaining: 2,
          },
          {
            tile: { id: "dragon-red-4", kind: "dragon", copy: 4 },
            visible_remaining: 1,
          },
        ],
      },
      { seat: "S", tenpai: false },
      {
        seat: "W",
        tenpai: true,
        waits: [{
          tile: { id: "characters-7-3", kind: "characters", rank: 7, copy: 3 },
          visible_remaining: 3,
        }],
      },
      { seat: "N", tenpai: false },
    ],
  };
  view.settlement = {
    method: TAIWANESE_SETTLEMENT_METHOD,
    net: { E: 0, S: 0, W: 0, N: 0 },
    total_credits: 0,
    total_debits: 0,
  };
  view.xp_award = {
    award_id: "hand:draw:player-east",
    source: "public_hand",
    total: 100,
    components: [{ code: "hand_completed", label: "Hand completed", amount: 100 }],
  };
  return view;
}

function dealInReviewView(): SeatView {
  const view = jadeStandardView();
  view.achievements = [];
  const winner = view.hand_result?.winners?.[0];
  if (!view.hand_result || !winner) return view;
  view.hand_result.payer = "E";
  winner.seat = "S";
  winner.context.seat = "S";
  view.own_hand = [
    { id: "wind-east-4", kind: "wind", copy: 4 },
    { id: "characters-9-4", kind: "characters", rank: 9, copy: 4 },
    { id: "dragon-white-3", kind: "dragon", copy: 3 },
  ];
  view.discards = [
    { seat: "W", tile: { id: "wind-east-1", kind: "wind", copy: 1 }, sequence: 1 },
    { seat: "N", tile: { id: "wind-east-2", kind: "wind", copy: 2 }, sequence: 2 },
    {
      seat: "E",
      tile: { id: "dots-1-1", kind: "dots", rank: 1, copy: 1 },
      sequence: 3,
    },
  ];
  view.settlement = {
    method: TAIWANESE_SETTLEMENT_METHOD,
    transfers: [{
      from: "E", to: "S", effective_tai: 8, raw_amount: 80, amount: 80,
      calculation: taiwaneseCalculation(10, 3, 2),
    }],
    net: { E: -80, S: 80, W: 0, N: 0 },
    total_credits: 80,
    total_debits: 80,
  };
  view.jade_settlement = {
    seat: "E",
    delta: -80,
    balance_before: 5_000,
    balance_after: 4_920,
    journal_id: "settlement:deal-in-review",
  };
  view.xp_award = {
    award_id: "hand:deal-in:player-east",
    source: "public_hand",
    total: 100,
    components: [{ code: "hand_completed", label: "Hand completed", amount: 100 }],
  };
  return view;
}

function alternateSettlementView(): SeatView {
  const view = jadeStandardView();
  view.settlement = {
    method: {
      id: "future-fixed-components-v1",
      model: "fixed_components",
      base_units: 0,
      tai_cap: 0,
      dealer_multiplier: 1,
    },
    transfers: [{
      from: "S",
      to: "E",
      effective_tai: 0,
      raw_amount: 75,
      amount: 75,
      calculation: {
        method_id: "future-fixed-components-v1",
        model: "fixed_components",
        unit_value: 5,
        components: [
          { kind: "hand_value", units: 10, amount: 50 },
          { kind: "special_bonus", units: 5, amount: 25 },
        ],
        multiplier: 1,
      },
    }],
    net: { E: 75, S: -75, W: 0, N: 0 },
    total_credits: 75,
    total_debits: 75,
  };
  view.jade_settlement = {
    seat: "E",
    delta: 75,
    balance_before: 5_000,
    balance_after: 5_075,
    journal_id: "settlement:alternate-method",
  };
  return view;
}

export const RESULT_SCENARIOS: {
  id: ResultScenarioId;
  label: string;
  practice: boolean;
  view: SeatView;
}[] = [
  { id: "jade-capped", label: "Jade — debit cap applied", practice: false, view: jadeCappedView() },
  { id: "jade-standard", label: "Jade — standard hand", practice: false, view: jadeStandardView() },
  { id: "self-draw", label: "Jade — dealer self-draw", practice: false, view: selfDrawView() },
  { id: "multi-winner", label: "Jade — multi-winner cap", practice: false, view: multiWinnerView() },
  { id: "practice", label: "Practice — Mastery XP", practice: true, view: practiceView() },
  { id: "exhaustive-draw", label: "Draw — four-seat waits", practice: false, view: exhaustiveDrawView() },
  { id: "deal-in-review", label: "Loss — discard review", practice: false, view: dealInReviewView() },
  { id: "alternate-settlement", label: "Settlement — alternate method", practice: false, view: alternateSettlementView() },
];
