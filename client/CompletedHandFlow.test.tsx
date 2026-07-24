import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SeatView } from "../protocol/envelope";
import { CompletedHandFlow, WINNING_HAND_REVEAL_MS } from "./CompletedHandFlow";

function winningView(): SeatView {
  return {
    match_id: "showdown-1",
    seat: "E",
    state_version: 20,
    phase: "hand_complete",
    active_seat: "E",
    own_hand: [],
    own_exposed: [],
    players: ["E", "S", "W", "N"].map((seat) => ({ seat: seat as "E" | "S" | "W" | "N", hand_count: 0 })),
    wall: { remaining: 20, drawable_remaining: 4, reserve_remaining: 16 },
    hand_result: {
      kind: "zimo",
      winning_tile_id: "dots-2-2",
      winners: [{
        seat: "E",
        context: { zimo: true },
        score: {
          winning: true,
          raw_tai: 1,
          patterns: [{ name: "Base Win", tai: 1 }],
          shape: {
            melds: [{
              type: "pong",
              tiles: [
                { id: "dots-2-1", kind: "dots", rank: 2, copy: 1 },
                { id: "dots-2-2", kind: "dots", rank: 2, copy: 2 },
                { id: "dots-2-3", kind: "dots", rank: 2, copy: 3 },
              ],
            }],
            pair: [
              { id: "wind-east-1", kind: "wind" },
              { id: "wind-east-2", kind: "wind" },
            ],
          },
          effective_tiles: 5,
        },
      }],
    },
  };
}

describe("CompletedHandFlow", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("reveals the winning hand before showing results", () => {
    act(() => root.render(
      <CompletedHandFlow
        view={winningView()}
        practice
        revealTable={<div data-testid="table-stays-visible">table</div>}
        onReturn={vi.fn()}
      />,
    ));

    expect(container.querySelector('[data-testid="table-stays-visible"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Winning hand revealed"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Hand result"]')).toBeNull();

    act(() => vi.advanceTimersByTime(WINNING_HAND_REVEAL_MS));

    expect(container.querySelector(".winning-table-reveal")).toBeNull();
    expect(container.querySelector('[aria-label="Hand result"]')).not.toBeNull();
  });

  it("skips the reveal for an exhaustive draw", () => {
    const view = winningView();
    view.phase = "exhaustive_draw";
    view.hand_result = { kind: "exhaustive_draw", winners: [] };
    act(() => root.render(
      <CompletedHandFlow view={view} practice onReturn={vi.fn()} />,
    ));

    expect(container.querySelector(".winning-hand-reveal")).toBeNull();
    expect(container.querySelector('[aria-label="Hand result"]')).not.toBeNull();
  });
});
