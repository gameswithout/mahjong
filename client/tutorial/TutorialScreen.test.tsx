import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TutorialEvent } from "./analytics";
import { TutorialScreen } from "./TutorialScreen";
import { TUTORIAL_CHAPTERS, TUTORIAL_SCRIPT_VERSION, allTutorialSteps } from "./script";

describe("TutorialScreen", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let events: TutorialEvent[];
  let onExit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    events = [];
    onExit = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render() {
    act(() =>
      root.render(<TutorialScreen onExit={onExit} analytics={(event) => events.push(event)} />),
    );
  }

  function click(label: string) {
    const target = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    if (!target) {
      throw new Error(`Button not found: ${label}`);
    }
    act(() => target.click());
  }

  function names(): string[] {
    return events.map((event) => event.name);
  }

  it("opens on the first chapter, on the real table", () => {
    render();

    expect(container.textContent).toContain(TUTORIAL_CHAPTERS[0].title);
    expect(container.textContent).toContain(TUTORIAL_CHAPTERS[0].steps[0].instruction);
    // The same component live play uses, not a diagram of it.
    expect(container.querySelector('[data-testid="match-table"]')).not.toBeNull();
  });

  it("advances a read step on Continue and reports both steps", () => {
    render();
    click("Continue");

    expect(container.textContent).toContain(TUTORIAL_CHAPTERS[0].steps[1].instruction);
    expect(names()).toEqual([
      "tutorial_started",
      "tutorial_step_shown",
      "tutorial_step_completed",
      "tutorial_step_shown",
    ]);
  });

  it("refuses the wrong discard, hints, and accepts the right one", () => {
    render();
    click("Continue"); // reach the discard step

    const step = TUTORIAL_CHAPTERS[0].steps[1];
    expect(step.expect.kind).toBe("discard");

    // Discarding the wrong tile must not advance the tutorial.
    const wrongTile = container.querySelector<HTMLElement>('[data-tile-id="characters-1-1"]');
    expect(wrongTile).not.toBeNull();
    // Select, then activate again: two separate commits, because the second
    // click only discards once React has recorded the first as a selection.
    act(() => wrongTile?.click());
    act(() => wrongTile?.click());

    expect(container.textContent).toContain(step.hint);
    expect(names()).toContain("tutorial_step_retried");
    expect(container.textContent).toContain(step.instruction);

    // The right tile earns the confirmation before moving on.
    const rightTile = container.querySelector<HTMLElement>('[data-tile-id="dragon-red-1"]');
    act(() => rightTile?.click());
    act(() => rightTile?.click());

    expect(container.textContent).toContain(step.confirmation);
    click("Continue");
    expect(container.textContent).toContain(TUTORIAL_CHAPTERS[0].steps[2].instruction);
  });

  it("replays the current step without advancing it", () => {
    render();
    click("Continue");
    const step = TUTORIAL_CHAPTERS[0].steps[1];

    const wrongTile = container.querySelector<HTMLElement>('[data-tile-id="characters-1-1"]');
    act(() => wrongTile?.click());
    act(() => wrongTile?.click());
    expect(container.textContent).toContain(step.hint);

    click("Replay this step");

    // Same step, clean slate: the hint from the failed attempt is gone.
    expect(container.textContent).toContain(step.instruction);
    expect(container.textContent).not.toContain(step.hint);
    expect(names()).toContain("tutorial_step_replayed");
  });

  it("skips one step without leaving the tutorial", () => {
    render();
    click("Skip this step");

    expect(onExit).not.toHaveBeenCalled();
    expect(container.textContent).toContain(TUTORIAL_CHAPTERS[0].steps[1].instruction);
    expect(events.find((event) => event.name === "tutorial_skipped")?.fromStepId).toBe(
      TUTORIAL_CHAPTERS[0].steps[0].id,
    );
  });

  it("leaves entirely on Skip the tutorial, recording where the player gave up", () => {
    render();
    click("Continue");
    click("Skip the tutorial");

    expect(onExit).toHaveBeenCalledOnce();
    const skipped = events.find((event) => event.name === "tutorial_skipped");
    expect(skipped?.fromStepId).toBe(TUTORIAL_CHAPTERS[0].steps[1].id);
    expect(skipped?.scriptVersion).toBe(TUTORIAL_SCRIPT_VERSION);
  });

  it("runs end to end, reporting each chapter and then completion", () => {
    render();

    // Skipping is the shortest path through every step; each still emits.
    for (let step = 0; step < allTutorialSteps().length; step += 1) {
      click("Skip this step");
    }

    expect(container.textContent).toContain("You know enough to play.");
    expect(names().filter((name) => name === "tutorial_chapter_completed")).toHaveLength(3);
    expect(names()).toContain("tutorial_completed");

    click("Play a hand");
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("can be replayed from the end without a remount", () => {
    render();
    for (let step = 0; step < allTutorialSteps().length; step += 1) {
      click("Skip this step");
    }

    click("Replay the tutorial");

    expect(container.textContent).toContain(TUTORIAL_CHAPTERS[0].steps[0].instruction);
    expect(onExit).not.toHaveBeenCalled();
  });

  it("stamps every event with the script version", () => {
    render();
    click("Continue");

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.scriptVersion).toBe(TUTORIAL_SCRIPT_VERSION);
    }
  });
});
