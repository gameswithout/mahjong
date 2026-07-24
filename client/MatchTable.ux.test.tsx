import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MatchTable } from "./MatchTable";
import { mockMatchTableState } from "./matchTableMockData";
import { tile } from "./matchTableTypes";

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
    vi.useRealTimers();
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

  it("shows the complete tile sequence for every Chow option", () => {
    const state = {
      ...mockMatchTableState,
      legalActions: [
        {
          id: "chow-0",
          label: "Chow 1",
          chowPreview: {
            tiles: ["characters-3-1", "characters-4-1", "characters-5-1"].map(tile),
            claimedTileId: "characters-4-1",
          },
        },
        {
          id: "chow-1",
          label: "Chow 2",
          chowPreview: {
            tiles: ["characters-4-2", "characters-5-2", "characters-6-1"].map(tile),
            claimedTileId: "characters-4-2",
          },
        },
      ],
    };
    act(() => root.render(<MatchTable state={state} />));

    const previews = container.querySelectorAll(".chow-option-preview");
    expect(previews).toHaveLength(2);
    expect(previews[0].querySelectorAll(".tile")).toHaveLength(3);
    expect(previews[1].querySelectorAll(".tile")).toHaveLength(3);
    expect(container.querySelectorAll(".chow-preview-claimed")).toHaveLength(2);
  });

  it("treats the hand as a cockpit and auto-sorts the newly drawn tile", () => {
    const onDiscardTile = vi.fn();
    act(() =>
      root.render(
        <MatchTable
          state={mockMatchTableState}
          interaction={{ canDiscard: true, onDiscardTile }}
        />,
      ),
    );

    expect(container.querySelectorAll(".local-hand-tile-wrap")).toHaveLength(17);
    expect(container.querySelectorAll(".local-hand-tile-drawn")).toHaveLength(1);
    expect(container.querySelectorAll('.local-hand-tile-button[draggable="true"]')).toHaveLength(0);
    expect(container.querySelector(".sort-toggle-button")?.textContent).toContain("Suit");
    expect(
      container.querySelector(".local-hand-tile-drawn")?.getAttribute("draggable"),
    ).toBe("false");
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).toContain("All visible");
  });

  it("stages a new draw at far right and sorts only after the discard", () => {
    const initialHand = mockMatchTableState.seats.S.hand!.slice(0, 16);
    const beforeDraw = {
      ...mockMatchTableState,
      seats: {
        ...mockMatchTableState.seats,
        S: { ...mockMatchTableState.seats.S, hand: initialHand, handCount: 16 },
      },
    };
    act(() => root.render(<MatchTable state={beforeDraw} />));
    const sortedBefore = Array.from(
      container.querySelectorAll(".local-hand [role='img']"),
    ).map((tile) => tile.getAttribute("aria-label"));

    const drawn = mockMatchTableState.seats.S.hand![16];
    const afterDraw = {
      ...beforeDraw,
      seats: {
        ...beforeDraw.seats,
        S: { ...beforeDraw.seats.S, hand: [...initialHand, drawn], handCount: 17 },
      },
    };
    act(() =>
      root.render(
        <MatchTable
          state={afterDraw}
          interaction={{ canDiscard: true, onDiscardTile: vi.fn() }}
        />,
      ),
    );
    const staged = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".local-hand-tile-button"),
    ).map((button) => button.getAttribute("aria-label")?.replace(/^Discard /, ""));
    expect(staged.slice(0, 16)).toEqual(sortedBefore);
    expect(staged[16]).toContain(drawn.label);

    const afterDiscard = {
      ...beforeDraw,
      seats: {
        ...beforeDraw.seats,
        S: { ...beforeDraw.seats.S, hand: [...initialHand.slice(1), drawn], handCount: 16 },
      },
    };
    act(() => root.render(<MatchTable state={afterDiscard} />));
    const sortedAfter = Array.from(
      container.querySelectorAll(".local-hand [role='img']"),
    ).map((tile) => tile.getAttribute("aria-label"));
    expect(sortedAfter.at(-1)).toContain("wind east");
  });

  it("shows an indefinite elapsed move timer for untimed development play", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T18:00:00Z"));
    act(() =>
      root.render(
        <MatchTable state={{ ...mockMatchTableState, untimed: true }} />,
      ),
    );
    expect(container.querySelector('[role="timer"]')?.getAttribute("aria-label")).toBe(
      "0 seconds elapsed",
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(container.querySelector('[role="timer"]')?.getAttribute("aria-label")).toBe(
      "3 seconds elapsed",
    );
    expect(container.querySelector(".countdown-elapsed-time")?.textContent).toBe("0:03");
    vi.useRealTimers();
  });

  it("gives the current tile a large, clearly labelled center stage", () => {
    act(() => root.render(<MatchTable state={mockMatchTableState} />));

    const focus = container.querySelector(".current-tile-focus");
    expect(focus?.textContent).toContain("Tile in play");
    expect(focus?.textContent).toContain("6 of dots");
    expect(focus?.getAttribute("aria-label")).toContain("from Bot · East");
    expect(focus?.querySelector(".tile-focus")).not.toBeNull();
    expect(container.querySelector(".discard-slot-recent .tile-focus")).toBeNull();
  });

  it("keeps claim choices in a compact dock without duplicating the center tile", () => {
    act(() => root.render(<MatchTable state={mockMatchTableState} />));

    const dock = container.querySelector(".action-bar-claim");
    expect(dock?.querySelectorAll("button")).toHaveLength(4);
    expect(dock?.querySelector(".tile")).toBeNull();
  });

  it("discards a hand tile in one tap without a confirm step", () => {
    const onDiscardTile = vi.fn();
    act(() =>
      root.render(
        <MatchTable
          state={mockMatchTableState}
          interaction={{ canDiscard: true, onDiscardTile }}
        />,
      ),
    );

    const firstTile = container.querySelector<HTMLButtonElement>(
      '.local-hand-tile-button[aria-label="Discard 1 of characters"]',
    );
    act(() => firstTile?.click());

    expect(onDiscardTile).toHaveBeenCalledOnce();
    expect(onDiscardTile).toHaveBeenCalledWith("characters-1-1");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Discard",
      ),
    ).toBe(false);
  });

  it("automatically passes when Pass is the only legal response", () => {
    const onPass = vi.fn();
    const passOnlyState = {
      ...mockMatchTableState,
      legalActions: [{ id: "pass", label: "Pass", onClick: onPass }],
    };

    act(() => root.render(<MatchTable state={passOnlyState} />));
    expect(onPass).toHaveBeenCalledOnce();
    expect(container.querySelector(".action-bar")).toBeNull();
    expect(container.querySelector(".current-tile-focus")?.textContent).toContain(
      "No claim · passing",
    );

    act(() => root.render(<MatchTable state={{ ...passOnlyState }} />));
    expect(onPass).toHaveBeenCalledOnce();
  });

  it("never auto-passes when another claim is available", () => {
    const onPass = vi.fn();
    act(() =>
      root.render(
        <MatchTable
          state={{
            ...mockMatchTableState,
            legalActions: [
              { id: "pong", label: "Pong", onClick: vi.fn() },
              { id: "pass", label: "Pass", onClick: onPass },
            ],
          }}
        />,
      ),
    );

    expect(onPass).not.toHaveBeenCalled();
    expect(container.querySelector(".action-bar-claim")).not.toBeNull();
  });

  it("reorders manual-sort tiles with drag and drop", () => {
    const onDiscardTile = vi.fn();
    act(() =>
      root.render(
        <MatchTable
          state={mockMatchTableState}
          interaction={{ canDiscard: true, onDiscardTile }}
        />,
      ),
    );
    const sortToggle = container.querySelector<HTMLButtonElement>(".sort-toggle-button");
    act(() => sortToggle?.click()); // Sets
    act(() => sortToggle?.click()); // Off / manual
    const hand = container.querySelector(".local-hand");
    const tiles = Array.from(hand?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const firstLabel = tiles[0].getAttribute("aria-label");
    const thirdLabel = tiles[2].getAttribute("aria-label");
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
    expect(reordered[0]).toBe(tiles[1].getAttribute("aria-label"));
    expect(reordered[1]).toBe(firstLabel);
    expect(reordered[2]).toBe(thirdLabel);
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
