import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { StatisticsScreen } from "./StatisticsScreen";
import { summarisePlayerStats, STAT_HANDS, STAT_WINS } from "./player-stats";
import type { MatchHistoryEntry } from "./match-history";

describe("StatisticsScreen", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (
    values: Record<string, number>,
    onPlay?: () => void,
    history: MatchHistoryEntry[] = [],
  ) =>
    act(() =>
      root.render(
        <StatisticsScreen summary={summarisePlayerStats(values)} history={history} onClose={() => {}} onPlay={onPlay} />,
      ),
    );

  it("shows completed sessions newest-first with result summaries", () => {
    render({ [STAT_HANDS]: 2, [STAT_WINS]: 1 }, undefined, [{
      matchId: "match-1",
      completedAt: "2026-07-30T20:00:00Z",
      mode: "Practice",
      result: "Win",
      winKind: "zimo",
      winningTileId: "dots-8",
      rawTai: 3,
      xpAwarded: 50,
    }]);

    expect(container.textContent).toContain("Practice");
    expect(container.textContent).toContain("Zimo · 3 Tai");
    expect(container.textContent).toContain("50 XP");
    expect(container.textContent).toContain("match-1");
  });

  it("labels uninvolved discard wins as Neutral", () => {
    render({ [STAT_HANDS]: 1 }, undefined, [{
      matchId: "match-neutral",
      completedAt: "2026-08-03T20:00:00Z",
      mode: "Play Online",
      result: "Neutral",
      winKind: "discard",
      winningTileId: "dots-8",
      rawTai: 0,
      xpAwarded: 50,
    }]);

    expect(container.textContent).toContain("Neutral");
    expect(container.textContent).toContain("Another player won from someone else's discard");
  });

  it("invites a first hand rather than showing a wall of zeroes", () => {
    const onPlay = vi.fn();
    render({}, onPlay);

    expect(container.textContent).toContain("No completed session records are available yet");

    const play = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Play a Game",
    );
    act(() => play?.click());
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it("shows one combined match history without unreleased modes", () => {
    render({ [STAT_HANDS]: 100, [STAT_WINS]: 25 });

    expect(container.textContent).toContain("25 Wins / 100 Games Played");
    expect(container.textContent).not.toContain("Full Rotation");
  });

  it("closes when asked", () => {
    const onClose = vi.fn();
    act(() =>
      root.render(
        <StatisticsScreen summary={summarisePlayerStats({})} onClose={onClose} />,
      ),
    );
    const close = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Close",
    );
    act(() => close?.click());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
