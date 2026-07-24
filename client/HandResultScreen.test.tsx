import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SeatView } from "../protocol/envelope";
import { HandResultScreen } from "./HandResultScreen";

function completedView(): SeatView {
  return {
    match_id: "practice-1",
    seat: "E",
    state_version: 42,
    phase: "hand_complete",
    active_seat: "E",
    own_hand: [],
    own_exposed: [],
    players: [
      { seat: "E", hand_count: 0 },
      { seat: "S", hand_count: 0, is_bot: true },
      { seat: "W", hand_count: 0, is_bot: true },
      { seat: "N", hand_count: 0, is_bot: true },
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
            patterns: [{ name: "Seat Wind", tai: 1 }],
            shape: {
              pair: [
                { id: "dots-1-1", kind: "dots", rank: 1, copy: 1 },
                { id: "dots-1-2", kind: "dots", rank: 1, copy: 2 },
              ],
              melds: [],
            },
            effective_tiles: 17,
          },
        },
      ],
    },
    settlement: {
      transfers: [
        {
          from: "S",
          to: "E",
          effective_tai: 3,
          raw_amount: 3,
          amount: 3,
        },
      ],
      net: { E: 3, S: -3 },
      total_credits: 3,
      total_debits: 3,
    },
    next_dealer: {
      next_dealer: "S",
      next_continuations: 0,
      dealer_retains: false,
    },
  };
}

describe("HandResultScreen", () => {
  it("presents Practice scoring as non-persistent and offers a fresh hand", () => {
    const markup = renderToStaticMarkup(
      <HandResultScreen
        view={completedView()}
        practice
        onPlayAgain={vi.fn()}
        onReturn={vi.fn()}
      />,
    );

    expect(markup).toContain("Practice result");
    expect(markup).toContain("no Jade, rating, or progression is changed");
    expect(markup).toContain('aria-label="1 of dots"');
    expect(markup).toContain("3 Practice points");
    expect(markup).not.toContain("3 Jade");
    expect(markup).not.toContain("Dealer rotates");
    expect(markup).toContain("Play Again");
    expect(markup).toContain("Return to Lobby");
  });

  it("preserves standard settlement and continuation copy outside Practice", () => {
    const markup = renderToStaticMarkup(
      <HandResultScreen view={completedView()} onReturn={vi.fn()} />,
    );

    expect(markup).toContain("3 Jade");
    expect(markup).toContain("Dealer rotates to South");
    expect(markup).not.toContain("Practice result");
    expect(markup).not.toContain("Play Again");
    expect(markup).toContain("Return to Lobby");
  });

  it("shows the caller's durable Jade delta and resulting balance", () => {
    const view = completedView();
    view.players = view.players.map((player) => ({ ...player, is_bot: false }));
    view.jade_account = {
      currency_code: "JADE",
      balance: 5030,
      reserved: 0,
      available: 5030,
      eligible: true,
      minimum_balance: 1000,
      stake_per_tai: 10,
      debit_cap: 300,
      wallet_sync_status: "synced",
    };
    view.jade_settlement = {
      seat: "E",
      delta: 30,
      balance_before: 5000,
      balance_after: 5030,
      journal_id: "settlement:match-1",
    };

    const markup = renderToStaticMarkup(<HandResultScreen view={view} />);

    expect(markup).toContain("+30 Jade");
    expect(markup).toContain("5,000");
    expect(markup).toContain("5,030 Jade");
    expect(markup).toContain("Settlement posted");
    expect(markup).toContain("AGS Wallet synced");
  });

  it("makes a discard win explicit in Chinese and shows who discarded to whom", () => {
    const markup = renderToStaticMarkup(<HandResultScreen view={completedView()} />);

    expect(markup).toContain('lang="zh-Hant">放炮</h2>');
    expect(markup).toContain("Fan Pao · Discard Win");
    expect(markup).toContain("You (East)");
    expect(markup).toContain("South");
    expect(markup).toContain("discarded to →");
    expect(markup).toContain('aria-label="South discarded the winning tile to You (East)"');
  });

  it("celebrates a self-draw with a prominent 自摸 heading", () => {
    const view = completedView();
    if (!view.hand_result) {
      throw new Error("invalid result fixture");
    }
    view.hand_result.kind = "zimo";
    view.hand_result.payer = undefined;
    const markup = renderToStaticMarkup(<HandResultScreen view={view} />);

    expect(markup).toContain('lang="zh-Hant">自摸</h2>');
    expect(markup).toContain("Zi Mo · Self-Draw");
    expect(markup).toContain("drew the winning tile themselves");
    expect(markup).not.toContain("discarded to →");
  });

  it("attributes a payer-side Dealer Tai bonus to the actual dealer", () => {
    const view = completedView();
    const winner = view.hand_result?.winners?.[0];
    if (!winner || !view.hand_result || !view.settlement) {
      throw new Error("invalid result fixture");
    }
    winner.seat = "S";
    winner.context.seat = "S";
    view.hand_result.kind = "zimo";
    view.hand_result.payer = undefined;
    view.settlement.transfers = [
      {
        from: "E",
        to: "S",
        effective_tai: 8,
        raw_amount: 8,
        amount: 8,
      },
      {
        from: "W",
        to: "S",
        effective_tai: 3,
        raw_amount: 3,
        amount: 3,
      },
    ];
    // Rotation to South means East was the dealer for the completed hand.
    view.next_dealer = {
      next_dealer: "S",
      next_continuations: 0,
      dealer_retains: false,
    };

    const markup = renderToStaticMarkup(<HandResultScreen view={view} />);

    expect(markup).toContain('lang="zh-Hant">台</span><small>(Tai)</small>');
    expect(markup).toContain(
      ": +5 when You (East) is the winner or payer",
    );
    expect(markup).not.toContain("South is dealer");
  });

  it("dispatches both Practice result actions", () => {
    const onPlayAgain = vi.fn();
    const onReturn = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    act(() => {
      root.render(
        <HandResultScreen
          view={completedView()}
          practice
          onPlayAgain={onPlayAgain}
          onReturn={onReturn}
        />,
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    act(() => buttons.find((button) => button.textContent === "Play Again")?.click());
    act(() => buttons.find((button) => button.textContent === "Return to Lobby")?.click());

    expect(onPlayAgain).toHaveBeenCalledOnce();
    expect(onReturn).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
