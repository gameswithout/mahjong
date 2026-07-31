import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { StatisticsScreen } from "./StatisticsScreen";
import { summarisePlayerStats, MINIMUM_RATE_SAMPLE, STAT_HANDS, STAT_WINS, STAT_ZIMO } from "./player-stats";

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

  const render = (values: Record<string, number>, onPlay?: () => void) =>
    act(() =>
      root.render(
        <StatisticsScreen summary={summarisePlayerStats(values)} onClose={() => {}} onPlay={onPlay} />,
      ),
    );

  it("states the denominator alongside every rate", () => {
    render({ [STAT_HANDS]: 100, [STAT_WINS]: 25, [STAT_ZIMO]: 10 });

    // A percentage with no denominator is not interpretable, so both appear.
    expect(container.textContent).toContain("25%");
    expect(container.textContent).toContain("25 of 100 hands played");
    // Zimo share is explicitly a share of wins, not of hands.
    expect(container.textContent).toContain("10 of 25 wins");
  });

  it("shows counts instead of a percentage until the sample is large enough", () => {
    render({ [STAT_HANDS]: 5, [STAT_WINS]: 3 });

    expect(container.textContent).toContain("3 of 5");
    expect(container.textContent).toContain(`${MINIMUM_RATE_SAMPLE - 5} more hands`);
    // 60% off five hands would be a claim about the shuffle.
    expect(container.textContent).not.toContain("60%");
  });

  it("invites a first hand rather than showing a wall of zeroes", () => {
    const onPlay = vi.fn();
    render({}, onPlay);

    expect(container.querySelector('[data-testid="statistics-empty"]')).not.toBeNull();
    expect(container.textContent).toContain("Practice hands are not counted");

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
