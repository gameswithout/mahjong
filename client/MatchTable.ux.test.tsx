import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MatchTable } from "./MatchTable";
import { mockMatchTableState, mockMatchTableUrgentState } from "./matchTableMockData";
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

  it("renders the simplified table as an isolated feature-flagged layout", () => {
    act(() => root.render(
      <MatchTable
        state={mockMatchTableState}
        preferences={{
          expertHud: false,
          autoPassDelay: "off",
          claimImpactAnalysis: false,
          experimentalTableUi: true,
          tableLayoutOutlines: true,
        }}
      />,
    ));

    expect(container.querySelector('[data-testid="essential-match-table"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="match-table"]')).toBeNull();
    expect(container.querySelector(".essential-table--outlines")).not.toBeNull();
    expect(container.querySelectorAll(".essential-opponent")).toHaveLength(3);
    expect(container.querySelectorAll(".essential-discard-row")).toHaveLength(4);
    expect(container.querySelector(".essential-console")).not.toBeNull();
    expect(container.querySelector(".essential-hand-track")).not.toBeNull();
    expect(container.querySelector(".essential-hand-settled")).not.toBeNull();
    expect(container.querySelector(".essential-draw-slot")).not.toBeNull();
    expect(container.querySelector(".essential-profile-row--local")).not.toBeNull();
    expect(container.querySelector(".essential-waits")).not.toBeNull();
    expect(container.querySelectorAll(".essential-wait")).toHaveLength(mockMatchTableState.waits.length);
    expect(container.querySelector(".essential-compass-top")).not.toBeNull();
    expect(container.querySelector(".essential-compass-right")).not.toBeNull();
    expect(container.querySelector(".essential-compass-bottom")).not.toBeNull();
    expect(container.querySelector(".essential-compass-left")).not.toBeNull();
    expect(Array.from(container.querySelectorAll(".essential-discard-row > b")).map((node) => node.textContent)).toEqual(["N", "W", "S", "E"]);
    expect(container.querySelector(".essential-last-discard")).toBeNull();
    expect(container.querySelector(".essential-console-discard .tile-lg")).not.toBeNull();
    expect(container.querySelector(".essential-console-discard .tile-sm")).toBeNull();
    expect(container.querySelector(".essential-compass-top")?.textContent).toBe("N");
    expect(container.querySelector(".essential-compass-right")?.textContent).toBe("W");
    expect(container.querySelector(".essential-compass-bottom")?.textContent).toBe("S");
    expect(container.querySelector(".essential-compass-left")?.textContent).toBe("E");
    expect(container.querySelectorAll(".essential-chow-preview .tile-sm")).toHaveLength(3);
    expect(container.querySelectorAll(".essential-chow-preview .is-claimed")).toHaveLength(1);
    expect(container.querySelector(".learning-hud")).toBeNull();
    expect(container.querySelector(".recent-actions")).toBeNull();
  });

  it("hides a non-actionable Pass and overlays the compact win declaration on the discard pile", () => {
    const winner = mockMatchTableUrgentState.localSeat;
    const state = {
      ...mockMatchTableUrgentState,
      showdown: true,
      showdownWinningTile: mockMatchTableState.lastDiscard?.tile,
      showdownWinType: { chinese: "胡", romanized: "Hu" },
      seats: {
        ...mockMatchTableUrgentState.seats,
        [winner]: {
          ...mockMatchTableUrgentState.seats[winner],
          revealedHand: [tile("dots-1-1")],
        },
      },
    };

    act(() => root.render(
      <MatchTable
        state={state}
        preferences={{
          expertHud: false,
          autoPassDelay: "off",
          claimImpactAnalysis: false,
          experimentalTableUi: true,
        }}
      />,
    ));

    expect(container.querySelector(".essential-actions")?.textContent).not.toContain("Pass");
    expect(container.querySelector(".essential-win-declaration")?.textContent).toContain("胡");
    expect(container.querySelector(".essential-win-declaration")?.textContent).toContain("Hu");
    expect(container.querySelector(".essential-win-declaration")?.textContent).toContain("You win");
    expect(container.querySelector(".essential-win-declaration")?.textContent).not.toContain("You wins");
    expect(container.querySelector(".essential-win-declaration .tile-lg")).not.toBeNull();
    const discardPile = container.querySelector(".essential-discards");
    const winDeclaration = container.querySelector(".essential-win-declaration");
    expect(discardPile?.parentElement).toBe(winDeclaration?.parentElement);
    expect(discardPile?.parentElement?.classList.contains("essential-discard-stage")).toBe(true);
  });

  it("keeps timer, wall, round, turn, discard, source, and message in one central dashboard", () => {
    act(() => root.render(<MatchTable state={mockMatchTableState} />));

    const dashboard = container.querySelector(".central-dashboard");
    expect(dashboard).not.toBeNull();
    expect(dashboard?.querySelector('[role="timer"]')).not.toBeNull();
    expect(dashboard?.querySelector(".wall-outline")).not.toBeNull();
    expect(dashboard?.querySelector(".round-status")).not.toBeNull();
    expect(dashboard?.querySelector(".active-seat-callout")).not.toBeNull();
    expect(dashboard?.querySelector(".current-tile-focus .tile-focus")).not.toBeNull();
    expect(dashboard?.querySelector(".current-tile-source")).not.toBeNull();
    expect(dashboard?.querySelector(".current-tile-prompt")).not.toBeNull();
  });

  it("uses the shared player profile structure while keeping local game controls separate", () => {
    act(() => root.render(<MatchTable state={mockMatchTableState} />));

    const localSeat = container.querySelector(".local-seat");
    const localProfile = localSeat?.querySelector(".seat-header");
    const localActivity = localSeat?.querySelector(".seat-activity");
    const controls = localSeat?.querySelector(".local-game-controls");
    expect(localProfile).not.toBeNull();
    expect(localProfile?.querySelector(".seat-identity")).not.toBeNull();
    expect(localProfile?.querySelector(".seat-activity")).toBeNull();
    expect(localActivity?.querySelector(".hand-count")).toBeNull();
    expect(controls).not.toBeNull();
    expect(localProfile?.contains(controls ?? null)).toBe(false);
    expect(controls?.querySelector(".sort-toggle-button")).not.toBeNull();
    expect(controls?.querySelector(".table-fx-toggle")).not.toBeNull();
    expect(container.querySelectorAll(".player-profile")).toHaveLength(4);
    expect(container.querySelectorAll(".seat-activity")).toHaveLength(4);
    expect(container.querySelectorAll(".player-profile .wind-badge")).toHaveLength(0);
    expect(container.querySelectorAll(".seat-activity .wind-badge")).toHaveLength(4);
    expect(container.querySelector(".player-profile .dealer-badge")).toBeNull();
    expect(container.querySelector(".seat-activity .dealer-badge")).not.toBeNull();
    expect(container.querySelectorAll(".bot-badge")).toHaveLength(0);
    expect(container.querySelectorAll(".hand-count")).toHaveLength(0);
  });

  it("centers the winning hand and marks the winner seat for celebration", () => {
    const winner = "E";
    const state = {
      ...mockMatchTableState,
      showdown: true,
      showdownWinningDiscard: mockMatchTableState.lastDiscard ?? undefined,
      showdownWinningTile: mockMatchTableState.lastDiscard?.tile,
      showdownWinType: { chinese: "胡", romanized: "Hu" },
      seats: {
        ...mockMatchTableState.seats,
        [winner]: {
          ...mockMatchTableState.seats[winner],
          revealedHand: [tile("dots-1-1"), tile("dots-1-2")],
        },
      },
    };

    act(() => root.render(<MatchTable state={state} />));

    const reveal = container.querySelector(".showdown-hands");
    expect(reveal?.closest(".table-playfield")).not.toBeNull();
    expect(reveal?.querySelectorAll(".showdown-hand-tile")).toHaveLength(2);
    const winningDiscard = reveal?.querySelector(".showdown-winning-discard");
    expect(winningDiscard?.textContent).toContain(mockMatchTableState.lastDiscard?.tile.label);
    expect(winningDiscard?.textContent).toContain("胡");
    expect(winningDiscard?.textContent).toContain("Hu");
    expect(winningDiscard?.textContent).not.toContain("Winning discard");
    expect(reveal?.querySelector(".showdown-win-type + strong")?.textContent).toBe(
      mockMatchTableState.lastDiscard?.tile.label,
    );
    expect(reveal?.classList).toContain("showdown-hands");
    expect(container.querySelector('[aria-label="East seat"]')?.classList).toContain("seat-celebrating");
  });

  it("escalates the wall warning from yellow at 16 tiles to red at 8", () => {
    const withWall = (drawableRemaining: number) => ({
      ...mockMatchTableState,
      wall: { ...mockMatchTableState.wall, drawableRemaining },
    });

    act(() => root.render(<MatchTable state={withWall(17)} />));
    expect(container.querySelector(".wall-outline-warning")).toBeNull();
    expect(container.querySelector(".wall-outline-critical")).toBeNull();

    act(() => root.render(<MatchTable state={withWall(16)} />));
    expect(container.querySelector(".wall-outline-warning")).not.toBeNull();
    expect(container.querySelector(".wall-outline")?.getAttribute("aria-label")).toContain("wall running low");

    act(() => root.render(<MatchTable state={withWall(8)} />));
    expect(container.querySelector(".wall-outline-critical")).not.toBeNull();
    expect(container.querySelector(".wall-outline")?.getAttribute("aria-label")).toContain("wall critically low");

    act(() => root.render(<MatchTable state={withWall(2)} />));
    expect(container.querySelector(".wall-outline")?.getAttribute("style")).toContain("animation-duration");
  });

  it("highlights the active seat border and renders exposed bonus tiles", () => {
    act(() => root.render(<MatchTable state={mockMatchTableState} />));

    expect(container.querySelectorAll(".seat-active")).toHaveLength(1);
    expect(container.querySelector(".local-seat.seat-active")).not.toBeNull();
    expect(container.querySelectorAll(".bonus-tile-area")).toHaveLength(3);
    const localFlowers = container.querySelector(
      '[aria-label="Your exposed Flowers and Seasons"]',
    );
    expect(localFlowers).not.toBeNull();
    expect(localFlowers?.querySelectorAll(".tile")).toHaveLength(2);
    expect(
      Array.from(container.querySelectorAll(".claim-badge")).map((badge) => badge.textContent),
    ).toEqual(["waiting", "thinking"]);
    expect(container.textContent).not.toContain("CLAIM");
  });

  it("marks only the seat's own Flowers without showing a live Tai counter", () => {
    act(() => root.render(<MatchTable state={mockMatchTableState} />));

    // South holds summer (its own, +1 Tai) and plum (East's, worth nothing).
    const marked = container.querySelectorAll(".bonus-tile-area-local .bonus-tile-matching");
    expect(marked).toHaveLength(1);
    expect(marked[0]?.getAttribute("title")).toBe("flower summer — your Flower, +1 Tai");

    // The non-scoring Flower is still shown, just not marked — a player needs
    // to see everything they have exposed, not only what pays.
    expect(container.querySelectorAll(".bonus-tile-area-local .bonus-tile")).toHaveLength(2);

    // Tai is summarized after the hand rather than occupying live-table space.
    expect(container.querySelector('[data-testid="flower-tai-badge"]')).toBeNull();
  });

  it("keeps turn emphasis on the authoritative active player during a claim decision", () => {
    const state = {
      ...mockMatchTableState,
      seats: {
        ...mockMatchTableState.seats,
        S: { ...mockMatchTableState.seats.S, isActive: false },
        E: { ...mockMatchTableState.seats.E, isActive: true },
      },
    };
    act(() => root.render(<MatchTable state={state} />));

    expect(container.querySelector(".local-seat.seat-active")).toBeNull();
    expect(container.querySelector(".seat-left.seat-active")).not.toBeNull();
    expect(container.querySelector(".active-seat-callout")?.textContent).toBe(
      "Bot's turn · East",
    );
    expect(container.querySelector(".seat-left .claim-badge")?.textContent).toBe("waiting");
    expect(container.querySelector(".local-seat .claim-badge")?.textContent).toBe("thinking");
  });

  it("states the turn owner, latest discard, and local decision in plain language", () => {
    const state = {
      ...mockMatchTableState,
      seats: {
        ...mockMatchTableState.seats,
        S: { ...mockMatchTableState.seats.S, isActive: false },
        E: { ...mockMatchTableState.seats.E, isActive: true },
      },
    };

    act(() => root.render(<MatchTable state={state} />));

    expect(container.querySelector(".active-seat-callout")?.textContent).toContain(
      "Bot's turn",
    );
    const tileFocus = container.querySelector(".current-tile-focus");
    expect(tileFocus?.textContent).toContain("Tile in play");
    expect(tileFocus?.textContent).toContain("6 of dots");
    expect(tileFocus?.textContent).toContain("Choose a claim or pass");
    expect(container.querySelector(".action-bar")?.getAttribute("aria-label")).toBe(
      "Respond to the tile in play",
    );
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

  it("suppresses Chow when the same discard can be won with Hu", () => {
    const onChow = vi.fn();
    const onWin = vi.fn();
    const state = {
      ...mockMatchTableState,
      legalActions: [
        { id: "pass", label: "Pass" },
        { id: "chow-0", label: "Chow", onClick: onChow },
        { id: "win-discard", label: "Win", onClick: onWin },
      ],
    };
    act(() => root.render(<MatchTable state={state} />));

    expect(container.querySelector(".action-chow-0")).toBeNull();
    expect(container.querySelector(".action-win-discard")).not.toBeNull();
    expect(
      container.querySelector(".action-row button:first-child")?.classList,
    ).toContain("action-win-discard");
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
    expect(container.textContent).toContain("Ting · Ready");
    expect(container.textContent).toContain("All visible");
    expect(container.querySelector(".wait-explainer")).toBeNull();
    expect(container.textContent).not.toContain("How counted");
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
    ).map((button) => button.querySelector('[role="img"]')?.getAttribute("aria-label"));
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

  it("shows elapsed time for the whole untimed hand without resetting each turn", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T18:00:00Z"));
    act(() =>
      root.render(
        <MatchTable state={{ ...mockMatchTableState, untimed: true }} />,
      ),
    );
    expect(container.querySelector('[role="timer"]')?.getAttribute("aria-label")).toBe(
      "0 seconds into this hand",
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(container.querySelector('[role="timer"]')?.getAttribute("aria-label")).toBe(
      "3 seconds into this hand",
    );
    act(() => root.render(
      <MatchTable
        state={{
          ...mockMatchTableState,
          untimed: true,
          seats: {
            ...mockMatchTableState.seats,
            E: { ...mockMatchTableState.seats.E, isActive: false },
            S: { ...mockMatchTableState.seats.S, isActive: true },
          },
        }}
      />,
    ));
    expect(container.querySelector('[role="timer"]')?.getAttribute("aria-label")).toBe(
      "3 seconds into this hand",
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

  it("keeps non-winning claim choices in a compact dock without duplicating the center tile", () => {
    act(() => root.render(<MatchTable state={mockMatchTableState} />));

    const dock = container.querySelector(".action-bar-claim");
    expect(dock?.querySelectorAll("button")).toHaveLength(3);
    expect(dock?.querySelector(".tile-focus")).toBeNull();
    expect(dock?.querySelectorAll(".chow-option-preview .tile")).toHaveLength(0);
  });

  it("keeps the draw fallback mounted while the automatic draw is pending", () => {
    const state = { ...mockMatchTableState, legalActions: [] };
    const onDraw = vi.fn();
    act(() =>
      root.render(
        <MatchTable
          state={state}
          interaction={{ canDraw: true, drawPending: false, onDraw }}
        />,
      ),
    );

    const before = container.querySelector<HTMLButtonElement>(".action-draw-fallback");
    expect(before?.disabled).toBe(false);

    act(() =>
      root.render(
        <MatchTable
          state={state}
          interaction={{ canDraw: true, drawPending: true, onDraw }}
        />,
      ),
    );

    const pending = container.querySelector<HTMLButtonElement>(".action-draw-fallback");
    expect(pending).toBe(before);
    expect(pending?.disabled).toBe(true);
    expect(container.textContent).toContain("Drawing your tile…");
  });

  it("inspects a tile on first activation and discards it on the second", () => {
    const onDiscardTile = vi.fn();
    const state = {
      ...mockMatchTableState,
      claimSource: null,
      legalActions: [],
      seats: {
        ...mockMatchTableState.seats,
        E: {
          ...mockMatchTableState.seats.E,
          melds: [
            ...mockMatchTableState.seats.E.melds,
            {
              id: "e-m3",
              type: "pong" as const,
              tiles: ["characters-1-2", "characters-1-3", "characters-1-4"].map(tile),
            },
          ],
        },
      },
    };
    act(() =>
      root.render(
        <MatchTable
          state={state}
          interaction={{ canDiscard: true, onDiscardTile }}
        />,
      ),
    );

    const firstTile = container.querySelector<HTMLButtonElement>(
      '.local-hand-tile-button[aria-label^="Inspect 1 of characters"]',
    );
    act(() => firstTile?.click());

    expect(onDiscardTile).not.toHaveBeenCalled();
    expect(firstTile?.getAttribute("aria-pressed")).toBe("true");
    expect(firstTile?.classList).toContain("local-hand-tile-selected");
    // Selecting or seeing a discard no longer reveals every matching copy.
    // The player still gets a clear selected-tile state and the latest tile
    // remains emphasized in its own discard river.
    expect(container.querySelectorAll(".tile-match")).toHaveLength(0);
    expect(container.querySelector(".discard-river .discard-slot-recent")).not.toBeNull();
    expect(container.querySelector(".current-tile-prompt")?.textContent).toContain(
      "select again to discard",
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

  it("requires a deliberate second activation for irreversible Gang actions", () => {
    const onGang = vi.fn();
    act(() =>
      root.render(
        <MatchTable
          state={{
            ...mockMatchTableState,
            legalActions: [{ id: "kong-concealed-0", label: "Gang", onClick: onGang }],
          }}
        />,
      ),
    );

    const gang = container.querySelector<HTMLButtonElement>(".action-kong-concealed-0");
    act(() => gang?.click());
    expect(onGang).not.toHaveBeenCalled();
    expect(gang?.textContent).toContain("Confirm Gang");
    expect(container.querySelector(".action-explanation")?.textContent).toContain(
      "cannot be undone",
    );

    act(() => gang?.click());
    expect(onGang).toHaveBeenCalledOnce();
  });

  it("confirms Chow and Pong before changing the learner's hand", () => {
    const onPong = vi.fn();
    act(() => root.render(
      <MatchTable
        state={{
          ...mockMatchTableState,
          legalActions: [{ id: "pong", label: "Pong", onClick: onPong }],
        }}
      />,
    ));

    const pong = container.querySelector<HTMLButtonElement>(".action-pong");
    act(() => pong?.click());
    expect(onPong).not.toHaveBeenCalled();
    expect(pong?.textContent).toContain("Confirm Pong");
    expect(container.querySelector(".action-explanation")?.textContent).toContain(
      "changes your hand and cannot be undone",
    );
    act(() => pong?.click());
    expect(onPong).toHaveBeenCalledOnce();
  });

  it("explains actions disabled while a table request is pending", () => {
    act(() =>
      root.render(
        <MatchTable
          state={{
            ...mockMatchTableState,
            legalActions: [
              {
                id: "pong",
                label: "Pong",
                disabled: true,
                disabledReason: "Waiting for the table to confirm your last choice.",
              },
            ],
          }}
        />,
      ),
    );

    const action = container.querySelector<HTMLButtonElement>(".action-pong");
    expect(action?.disabled).toBe(true);
    expect(action?.getAttribute("title")).toContain("Waiting for the table");
    expect(container.querySelector(".action-explanation")?.textContent).toContain(
      "Waiting for the table",
    );
  });

  it("immediately resolves Pass when there is no meaningful claim choice", () => {
    vi.useFakeTimers();
    const onPass = vi.fn();
    const passOnlyState = {
      ...mockMatchTableState,
      legalActions: [{ id: "pass", label: "Pass", onClick: onPass }],
    };
    const preferences = {
      expertHud: false,
      autoPassDelay: "3s" as const,
      claimImpactAnalysis: false,
    };

    act(() => root.render(<MatchTable state={passOnlyState} preferences={preferences} />));
    act(() => vi.advanceTimersByTime(0));
    expect(onPass).toHaveBeenCalledOnce();
    expect(container.querySelector(".action-bar")).toBeNull();
    expect(container.querySelector(".seat-bottom .seat-activity-message")?.textContent).not.toContain(
      "Thinking",
    );
    expect(container.querySelector(".current-tile-focus")?.textContent).toContain(
      "No claim · passing",
    );

    // A re-render for the same discard must not queue a second pass.
    act(() => root.render(<MatchTable state={{ ...passOnlyState }} preferences={preferences} />));
    act(() => vi.advanceTimersByTime(5_000));
    expect(onPass).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("puts the impact and auto-pass controls in the footer, both starting off", () => {
    const onClaimImpactChange = vi.fn();
    const onAutoPassDelayChange = vi.fn();
    const claimState = {
      ...mockMatchTableState,
      legalActions: [
        { id: "pong", label: "Pong", onClick: vi.fn(), impact: "Opens the hand." },
        { id: "pass", label: "Pass", onClick: vi.fn() },
      ],
    };

    act(() => root.render(
      <MatchTable
        state={claimState}
        preferences={{
          expertHud: false,
          autoPassDelay: "off",
          claimImpactAnalysis: false,
          onClaimImpactChange,
          onAutoPassDelayChange,
        }}
      />,
    ));

    const controls = container.querySelector(".local-game-controls");
    const impactButton = Array.from(
      controls?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.startsWith("Impact"));
    const autoPassButton = Array.from(
      controls?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.startsWith("Auto-pass"));

    // Beside the sort control, which is the whole point of putting them here:
    // they are pacing and verbosity dials reached for mid-hand.
    expect(impactButton).toBeDefined();
    expect(autoPassButton).toBeDefined();
    expect(impactButton?.textContent).toContain("off");
    expect(autoPassButton?.textContent).toContain("off");
    // Default off means the wordy sentence is absent until asked for.
    expect(container.querySelector(".claim-impact")).toBeNull();

    act(() => impactButton?.click());
    expect(onClaimImpactChange).toHaveBeenCalledWith(true);
    expect(container.querySelector(".claim-impact")?.textContent).toContain("Opens the hand.");

    // Off -> 1s -> 3s -> 5s -> off, so every offered wait is reachable and the
    // cycle returns to off rather than trapping the player in a delay.
    for (const expected of ["1s", "3s", "5s", "off"]) {
      act(() => autoPassButton?.click());
      expect(autoPassButton?.textContent).toContain(expected);
    }
    expect(onAutoPassDelayChange.mock.calls.map(([value]) => value)).toEqual([
      "1s",
      "3s",
      "5s",
      "off",
    ]);
  });

  it("does not present a false Pass decision when the delay is off", () => {
    vi.useFakeTimers();
    const onPass = vi.fn();

    act(() => root.render(
      <MatchTable
        state={{
          ...mockMatchTableState,
          legalActions: [{ id: "pass", label: "Pass", onClick: onPass }],
        }}
      />,
    ));

    act(() => vi.advanceTimersByTime(0));
    expect(onPass).toHaveBeenCalledOnce();
    expect(container.querySelector(".action-pass")).toBeNull();
    vi.useRealTimers();
  });

  it("keeps real claim choices visible when automatic passing is disabled", () => {
    const onPass = vi.fn();
    act(() => root.render(
      <MatchTable
        state={{
          ...mockMatchTableState,
          legalActions: [
            { id: "pong", label: "Pong", onClick: vi.fn() },
            { id: "pass", label: "Pass", onClick: onPass },
          ],
        }}
        preferences={{ expertHud: false, autoPassDelay: "off", claimImpactAnalysis: false }}
      />,
    ));

    expect(onPass).not.toHaveBeenCalled();
    expect(container.querySelector(".action-pass")).not.toBeNull();
    expect(
      (container.querySelector(".seat-bottom .seat-activity-message")?.textContent ?? "").toLowerCase(),
    ).toContain("thinking");
  });

  it("shows the optional Learning HUD with an explicit public-information boundary", () => {
    act(() => root.render(
      <MatchTable
        state={mockMatchTableState}
        preferences={{ expertHud: true, autoPassDelay: "1s", claimImpactAnalysis: false }}
      />,
    ));

    expect(container.querySelector('[aria-label="Learning HUD"]')).not.toBeNull();
    expect(container.textContent).toContain("Public information only");
    expect(container.querySelector('[aria-label="Learning HUD"] .wait-panel')).toBeNull();
    const expand = container.querySelector<HTMLButtonElement>('[aria-label="Open Learning HUD details"]');
    act(() => expand?.click());
    expect(container.querySelector('[aria-label="Learning HUD"]')?.textContent).toContain(
      "Select a tile to inspect its public visibility",
    );
    expect(expand?.getAttribute("aria-expanded")).toBe("true");

    act(() => root.render(
      <MatchTable
        state={mockMatchTableState}
        preferences={{ expertHud: false, autoPassDelay: "1s", claimImpactAnalysis: false }}
      />,
    ));
    expect(container.querySelector('[aria-label="Learning HUD"]')).toBeNull();
    expect(container.querySelector('[aria-label="Learning HUD hidden"]')).not.toBeNull();
    const show = container.querySelector<HTMLButtonElement>('[aria-label="Learning HUD hidden"] button');
    act(() => show?.click());
    expect(container.querySelector('[aria-label="Learning HUD"]')).not.toBeNull();
  });

  it("keeps a visible feed of recent discards and claims", () => {
    act(() => root.render(<MatchTable state={mockMatchTableState} />));
    expect(container.querySelector('[aria-label="Recent actions"]')?.textContent).toContain(
      "Bot discarded 6 of dots",
    );

    const claimed = {
      ...mockMatchTableState,
      lastDiscard: { seat: "W" as const, tile: tile("dots-5-4") },
      seats: {
        ...mockMatchTableState.seats,
        W: {
          ...mockMatchTableState.seats.W,
          discards: [...mockMatchTableState.seats.W.discards, tile("dots-5-4")],
          melds: [{
            id: "w-pong-1",
            type: "pong" as const,
            tiles: ["wind-west-1", "wind-west-2", "wind-west-3"].map(tile),
          }],
        },
      },
    };
    act(() => root.render(<MatchTable state={claimed} />));

    const feed = container.querySelector('[aria-label="Recent actions"]');
    expect(feed?.textContent).toContain("Bot discarded 5 of dots");
    expect(feed?.textContent).toContain("Bot claimed Pong");

    // A reconnect can briefly render an older authoritative projection. When
    // the latest projection returns, the same physical tile is refreshed in
    // place rather than appended with a duplicate React key.
    act(() => root.render(<MatchTable state={mockMatchTableState} />));
    act(() => root.render(<MatchTable state={claimed} />));
    expect(
      Array.from(container.querySelectorAll('[aria-label="Recent actions"] li'))
        .filter((item) => item.textContent === "Bot discarded 5 of dots"),
    ).toHaveLength(1);
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

  // The local seat is S, so W renders in the right-hand slot and E in the
  // left (see remapSeats).
  it("labels an AI Practice seat with its playing style, and a takeover without one", () => {
    const state = {
      ...mockMatchTableState,
      seats: {
        ...mockMatchTableState.seats,
        W: {
          ...mockMatchTableState.seats.W,
          displayName: "Stone Lion",
          takenOver: true,
          isBot: true,
          botStyleTag: "Guard",
        },
        E: {
          ...mockMatchTableState.seats.E,
          displayName: "Player",
          takenOver: true,
          isBot: false,
        },
      },
    };
    act(() => root.render(<MatchTable state={state} />));

    // §11 keeps a bot visibly a bot: the style rides on the badge rather
    // than replacing it.
    const bot = container.querySelector(".seat-right .takeover-badge");
    expect(bot?.textContent).toBe("Bot · Guard");
    expect(bot?.className).toContain("bot-badge");
    expect(container.querySelector(".seat-right")?.textContent).toContain("Stone Lion");

    // A disconnected human is not a persona seat and must not be dressed up
    // as one.
    const takeover = container.querySelector(".seat-left .takeover-badge");
    expect(takeover?.textContent).toBe("Auto-playing");
    expect(takeover?.className).not.toContain("bot-badge");
  });

  it("falls back to a plain Bot label when no persona was sent", () => {
    const state = {
      ...mockMatchTableState,
      seats: {
        ...mockMatchTableState.seats,
        W: {
          ...mockMatchTableState.seats.W,
          displayName: "Bot",
          takenOver: true,
          isBot: true,
        },
      },
    };
    act(() => root.render(<MatchTable state={state} />));

    expect(container.querySelector(".seat-right .takeover-badge")?.textContent).toBe("Bot");
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
