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
    expect(markup).toContain("No Jade or rating changed");
    expect(markup).toContain("Completed hands still earn capped XP");
    expect(markup).toContain('aria-label="1 of dots"');
    expect(markup).toContain("3 Practice points");
    expect(markup).not.toContain("3 Jade");
    expect(markup).toContain("3 Practice points paid = 3 received");
    expect(markup).toContain("Practice points do not persist");
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

  it("celebrates every achievement unlocked by the public hand", () => {
    const view = completedView();
    view.achievements = [
      {
        award_id: "achievement:first-hand:player-1",
        source: "achievement",
        total: 100,
        components: [{ code: "first-hand", label: "First Hand", amount: 100 }],
      },
      {
        award_id: "achievement:first-win:player-1",
        source: "achievement",
        total: 200,
        components: [{ code: "first-win", label: "First Win", amount: 200 }],
      },
    ];

    const markup = renderToStaticMarkup(<HandResultScreen view={view} />);

    expect(markup).toContain("Achievements unlocked");
    expect(markup).toContain("First Hand");
    expect(markup).toContain("First Win");
    expect(markup).toContain("+100 XP");
    expect(markup).toContain("+200 XP");
    expect(markup).toContain('data-achievement-code="first-win"');
  });

  it("never presents public achievement unlocks in Practice", () => {
    const view = completedView();
    view.achievements = [{
      award_id: "achievement:first-hand:player-1",
      total: 100,
      components: [{ code: "first-hand", label: "First Hand", amount: 100 }],
    }];

    const markup = renderToStaticMarkup(<HandResultScreen view={view} practice />);

    expect(markup).not.toContain("Achievement unlocked");
    expect(markup).not.toContain("First Hand");
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
    if (!view.settlement?.transfers) {
      throw new Error("invalid settlement fixture");
    }
    view.settlement.transfers[0].raw_amount = 30;
    view.settlement.transfers[0].amount = 30;
    view.settlement.net = { E: 30, S: -30 };
    view.settlement.total_credits = 30;
    view.settlement.total_debits = 30;

    const markup = renderToStaticMarkup(<HandResultScreen view={view} />);

    expect(markup).toContain("You received 30 Jade");
    expect(markup).toContain("5,000");
    expect(markup).toContain("5,030 Jade");
    expect(markup).toContain("10 Jade per 台 × 3 台 = 30 Jade");
    expect(markup).toContain("30 Jade paid = 30 received");
    expect(markup).toContain("No Jade was created or removed");
    expect(markup).toContain("Settlement posted");
    expect(markup).toContain("AGS Wallet synced");
    expect(markup).toContain('data-wallet-sync-status="synced"');
  });

  it.each([
    ["pending", "", "AGS Wallet queued"],
    ["syncing", "", "AGS Wallet syncing"],
    ["error", "credit_failed", "Wallet sync delayed; retrying automatically"],
    ["error", "forbidden", "Wallet sync needs service attention; your Jade is safe"],
  ])("explains the %s Wallet state without claiming success", (status, error, expected) => {
    const view = completedView();
    view.players = view.players.map((player) => ({ ...player, is_bot: false }));
    view.jade_account = {
      currency_code: "JADE",
      balance: 5000,
      reserved: 0,
      available: 5000,
      eligible: true,
      minimum_balance: 1000,
      stake_per_tai: 10,
      debit_cap: 300,
      wallet_sync_status: status,
      wallet_sync_error: error,
    };
    view.jade_settlement = {
      seat: "E",
      delta: 0,
      balance_before: 5000,
      balance_after: 5000,
      journal_id: "settlement:match-1",
    };

    const markup = renderToStaticMarkup(<HandResultScreen view={view} />);

    expect(markup).toContain(expected);
    expect(markup).not.toContain("AGS Wallet synced");
    expect(markup).toContain(`data-wallet-sync-status="${status}"`);
  });

  it("labels a discard win as Hu and combines payer, winning tile, and winner", () => {
    const markup = renderToStaticMarkup(<HandResultScreen view={completedView()} />);

    expect(markup).toContain('lang="zh-Hant">胡</h2>');
    expect(markup).toContain('hand-result-win-type-name">Hu</p>');
    expect(markup).toContain("You (East)");
    expect(markup).toContain("South");
    expect(markup).toContain("discarded winning tile");
    expect(markup).toContain('aria-label="1 of dots"');
    expect(markup).toContain('aria-label="South discarded the winning tile to You (East)"');
    expect(markup).not.toContain("Winning tile</span>");
    expect(markup).toContain('Scoring Breakdown <span lang="zh-Hant">台</span> (Tai)');
    expect(markup).toContain("Scoring details");
    expect(markup).toContain("Seat Wind");
    expect(markup).toContain("Raw subtotal");
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
    expect(markup).not.toContain("discarded winning tile");
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

    expect(markup).toContain('Dealer <span lang="zh-Hant">台</span>: +5');
    expect(markup).toContain("Applied when You (East) is the winner or payer");
    expect(markup).not.toContain("South is dealer");
  });

  it("carries the end-of-match account offer between the tally and the actions", () => {
    const markup = renderToStaticMarkup(
      <HandResultScreen
        view={completedView()}
        onReturn={vi.fn()}
        accountUpgrade={<p>Keep this progress</p>}
      />,
    );

    const offerAt = markup.indexOf("Keep this progress");
    expect(offerAt).toBeGreaterThan(markup.indexOf("Settlement"));
    expect(offerAt).toBeLessThan(markup.indexOf("Return to Lobby"));
  });

  it("omits the account offer once there is nothing to upgrade", () => {
    const markup = renderToStaticMarkup(<HandResultScreen view={completedView()} onReturn={vi.fn()} />);

    expect(markup).not.toContain("Keep this progress");
  });

  it("offers friend requests for available opponents and explains existing relationships", async () => {
    const onAdd = vi.fn().mockResolvedValue({ ok: true });
    const container = document.createElement("div");
    const root = createRoot(container);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    act(() => {
      root.render(
        <HandResultScreen
          view={completedView()}
          resultFriends={{
            status: "ready",
            opponents: [
              {
                userId: "player-south-1234",
                displayName: "BambooFox",
                relationship: "available",
              },
              { userId: "player-west", relationship: "friend" },
              { userId: "player-north", relationship: "outgoing" },
            ],
          }}
          onAddResultFriend={onAdd}
          onRetryResultFriends={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Add friends from this hand");
    expect(container.textContent).toContain("BambooFox");
    expect(container.textContent).toContain("Friends");
    expect(container.textContent).toContain("Request sent");

    const add = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Add Friend",
    );
    expect(add?.getAttribute("aria-label")).toBe("Add BambooFox as a friend");
    await act(async () => {
      add?.click();
      await Promise.resolve();
    });

    expect(onAdd).toHaveBeenCalledWith("player-south-1234");
    expect(container.textContent).toContain("Request sent");
    act(() => root.unmount());
  });

  it("keeps a failed result-screen friend request retryable with a stable error code", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const onAdd = vi.fn().mockResolvedValue({
      ok: false,
      code: "rate_limited",
      message: "You have sent too many friend requests. Try again later.",
    });

    act(() => {
      root.render(
        <HandResultScreen
          view={completedView()}
          resultFriends={{
            status: "ready",
            opponents: [
              { userId: "player-south", relationship: "available" },
            ],
          }}
          onAddResultFriend={onAdd}
          onRetryResultFriends={vi.fn()}
        />,
      );
    });

    const add = container.querySelector<HTMLButtonElement>(".result-friend-action button");
    await act(async () => {
      add?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-error-code="rate_limited"]')).not.toBeNull();
    expect(container.textContent).toContain("Try again later");
    expect(container.querySelector<HTMLButtonElement>(".result-friend-action button")?.disabled).toBe(false);
    act(() => root.unmount());
  });

  it("never renders result friends in Practice even if a caller supplies them", () => {
    const markup = renderToStaticMarkup(
      <HandResultScreen
        view={completedView()}
        practice
        resultFriends={{
          status: "ready",
          opponents: [
            { userId: "bot-shaped-id", relationship: "available" },
          ],
        }}
        onAddResultFriend={vi.fn()}
        onRetryResultFriends={vi.fn()}
      />,
    );

    expect(markup).not.toContain("Add friends from this hand");
    expect(markup).not.toContain("Add Friend");
  });

  it("makes a capped transfer and zero-sum Jade reconciliation explicit", () => {
    const view = completedView();
    if (!view.settlement?.transfers) {
      throw new Error("invalid settlement fixture");
    }
    view.jade_account = {
      currency_code: "JADE",
      balance: 300000,
      reserved: 0,
      available: 300000,
      eligible: true,
      minimum_balance: 500000,
      stake_per_tai: 10000,
      debit_cap: 300000,
      wallet_sync_status: "synced",
    };
    view.settlement.transfers = [{
      from: "S",
      to: "E",
      effective_tai: 45,
      raw_amount: 450000,
      amount: 300000,
      capped: true,
    }];
    view.settlement.net = { E: 300000, S: -300000 };
    view.settlement.total_credits = 300000;
    view.settlement.total_debits = 300000;

    const markup = renderToStaticMarkup(<HandResultScreen view={view} />);

    expect(markup).toContain("Table stake:");
    expect(markup).toContain("10,000 Jade per 台");
    expect(markup).toContain("Debit cap:");
    expect(markup).toContain("10,000 Jade per 台 × 45 台 = 450,000 Jade");
    expect(markup).toContain("Debit cap applied: 450,000 → 300,000 Jade");
    expect(markup).toContain("300,000 Jade paid = 300,000 received");
    expect(markup).toContain("Balances to zero");
  });

  it("lets the player collapse and reopen the score explanation", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    act(() => root.render(<HandResultScreen view={completedView()} />));

    const toggle = container.querySelector<HTMLButtonElement>(".hand-result-why-toggle");
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[aria-label="Scoring patterns"]')).not.toBeNull();

    act(() => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[aria-label="Scoring patterns"]')).toBeNull();

    act(() => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[aria-label="Scoring patterns"]')).not.toBeNull();
    act(() => root.unmount());
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
