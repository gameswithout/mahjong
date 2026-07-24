import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MatchTable } from "./MatchTable";
import { mockMatchTableState } from "./matchTableMockData";

describe("MatchTable table-first UX", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("moves every discard river into the central playfield", () => {
    act(() => root.render(<MatchTable state={mockMatchTableState} />));

    const playfield = container.querySelector(".table-playfield");
    expect(playfield).not.toBeNull();
    expect(playfield?.querySelectorAll(".discard-river")).toHaveLength(4);
    expect(playfield?.querySelector('[aria-label="Your discard river"]')).not.toBeNull();
    expect(container.querySelector(".seat .discard-grid")).toBeNull();
  });

  it("treats the hand as a cockpit and separates the newly drawn tile", () => {
    act(() =>
      root.render(
        <MatchTable
          state={mockMatchTableState}
          interaction={{ canDiscard: true, selectedTileId: null }}
        />,
      ),
    );

    expect(container.querySelectorAll(".local-hand-tile-wrap")).toHaveLength(17);
    expect(container.querySelectorAll(".local-hand-tile-drawn")).toHaveLength(1);
    expect(container.querySelectorAll('.local-hand-tile-button[draggable="true"]')).toHaveLength(16);
    expect(
      container.querySelector(".local-hand-tile-drawn")?.getAttribute("draggable"),
    ).toBe("false");
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).toContain("All visible");
  });

  it("keeps legal decisions in a contextual dock above the hand", () => {
    act(() => root.render(<MatchTable state={mockMatchTableState} />));

    const dock = container.querySelector(".action-bar-claim");
    expect(dock?.textContent).toContain("discarded — your move");
    expect(dock?.querySelectorAll("button")).toHaveLength(4);
  });

  it("reorders manual-sort tiles with drag and drop", () => {
    act(() =>
      root.render(
        <MatchTable
          state={mockMatchTableState}
          interaction={{ canDiscard: true, selectedTileId: null }}
        />,
      ),
    );
    const hand = container.querySelector(".local-hand");
    const tiles = Array.from(hand?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "none",
      dropEffect: "none",
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? "",
    };
    const dragStart = new Event("dragstart", { bubbles: true });
    Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });
    const drop = new Event("drop", { bubbles: true });
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });

    act(() => {
      tiles[0].dispatchEvent(dragStart);
      tiles[2].dispatchEvent(drop);
    });

    const reordered = Array.from(
      hand?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).map((tile) => tile.getAttribute("aria-label"));
    expect(reordered[0]).toContain("2 of characters");
    expect(reordered[1]).toContain("1 of characters");
  });

  it("presents automatic drawing as flow with a manual fallback", () => {
    const onDraw = vi.fn();
    act(() =>
      root.render(
        <MatchTable
          state={{ ...mockMatchTableState, legalActions: [] }}
          interaction={{ canDraw: true, onDraw, drawPending: false }}
        />,
      ),
    );

    expect(container.textContent).toContain("will draw automatically");
    const fallback = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Draw now",
    );
    act(() => fallback?.click());
    expect(onDraw).toHaveBeenCalledOnce();
  });

  it("persists the optional table feedback preference", () => {
    act(() => root.render(<MatchTable state={mockMatchTableState} />));

    const toggle = container.querySelector<HTMLButtonElement>(".table-fx-toggle");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    act(() => toggle?.click());
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem("mahjong-table-fx")).toBe("on");
  });
});
