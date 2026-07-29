import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TutorialEvent } from "./analytics";
import { TutorialScreen } from "./TutorialScreen";
import {
  TUTORIAL_CHAPTERS,
  TUTORIAL_SCRIPT_VERSION,
  allTutorialSteps,
} from "./script";

describe("TutorialScreen", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let events: TutorialEvent[];
  let onExit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
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
      root.render(
        <TutorialScreen
          onExit={onExit}
          analytics={(event) => events.push(event)}
        />,
      ),
    );
  }

  function button(label: string) {
    return Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
  }

  function click(label: string) {
    const target = button(label);
    if (!target) {
      throw new Error(`Button not found: ${label}`);
    }
    act(() => target.click());
  }

  function begin() {
    click("Start with the basics");
  }

  function skipTo(stepId: string) {
    const targetIndex = allTutorialSteps().findIndex((step) => step.id === stepId);
    if (targetIndex < 0) {
      throw new Error(`Step not found: ${stepId}`);
    }
    begin();
    for (let index = 0; index < targetIndex; index += 1) {
      click("Skip step");
    }
  }

  function names(): string[] {
    return events.map((event) => event.name);
  }

  it("welcomes a total beginner before showing the busy table", () => {
    render();

    expect(container.textContent).toContain("Never played Mahjong? Start here.");
    expect(container.textContent).toContain("No terminology or scoring knowledge is assumed");
    expect(container.textContent).toContain("Draw one, discard one");
    expect(container.querySelector('[data-testid="match-table"]')).toBeNull();
    expect(button("Start with the basics")).toBeTruthy();
    expect(button("Skip the tutorial")).toBeTruthy();
  });

  it("starts on the first lesson using the same table as live play", () => {
    render();
    begin();

    expect(container.textContent).toContain(TUTORIAL_CHAPTERS[0].title);
    expect(container.textContent).toContain(
      TUTORIAL_CHAPTERS[0].steps[0].instruction,
    );
    expect(container.textContent).toContain("Hand");
    expect(container.textContent).toContain("The tiles you are building");
    expect(container.querySelector('[data-testid="match-table"]')).not.toBeNull();
    expect(names()).toEqual(["tutorial_started", "tutorial_step_shown"]);
  });

  it("teaches the draw before asking for a discard", () => {
    render();
    begin();
    click("Continue");

    expect(container.textContent).toContain(
      TUTORIAL_CHAPTERS[0].steps[1].instruction,
    );
    expect(button("Draw now")).toBeTruthy();

    click("Draw now");

    expect(container.textContent).toContain(
      TUTORIAL_CHAPTERS[0].steps[2].instruction,
    );
    expect(container.querySelector('[data-tile-id="dragon-red-1"]')).not.toBeNull();
    expect(names()).toContain("tutorial_step_completed");
  });

  it("refuses the wrong discard, hints, and accepts the drawn tile", () => {
    render();
    begin();
    click("Continue");
    click("Draw now");

    const step = TUTORIAL_CHAPTERS[0].steps[2];
    const wrongTile = container.querySelector<HTMLElement>(
      '[data-tile-id="characters-1-1"]',
    );
    expect(wrongTile).not.toBeNull();
    act(() => wrongTile?.click());
    act(() => wrongTile?.click());

    expect(container.textContent).toContain(step.hint);
    expect(names()).toContain("tutorial_step_retried");
    expect(container.textContent).toContain(step.instruction);

    const rightTile = container.querySelector<HTMLElement>(
      '[data-tile-id="dragon-red-1"]',
    );
    act(() => rightTile?.click());
    act(() => rightTile?.click());

    expect(container.textContent).toContain(step.confirmation);
    click("Continue");
    expect(container.textContent).toContain(TUTORIAL_CHAPTERS[1].steps[0].instruction);
  });

  it("resets the current step without advancing it", () => {
    render();
    begin();
    click("Continue");
    click("Draw now");
    const step = TUTORIAL_CHAPTERS[0].steps[2];

    const wrongTile = container.querySelector<HTMLElement>(
      '[data-tile-id="characters-1-1"]',
    );
    act(() => wrongTile?.click());
    act(() => wrongTile?.click());
    expect(container.textContent).toContain(step.hint);

    click("Reset step");

    expect(container.textContent).toContain(step.instruction);
    expect(container.textContent).not.toContain(step.hint);
    expect(names()).toContain("tutorial_step_replayed");
  });

  it("makes the player add a small Tai example", () => {
    render();
    skipTo("c4-s2-count-tai");

    expect(container.textContent).toContain("Tai is the score for a winning hand");
    expect(container.textContent).toContain("Base Win — every legal win");
    expect(container.textContent).toContain("3 Tai");

    click("2 Tai");
    expect(container.textContent).toContain("Add the three lines: 1 + 1 + 1.");

    click("3 Tai");
    expect(container.textContent).toContain(
      "1 Base Win + 1 Concealed + 1 Single Wait = 3 Tai",
    );
    expect(button("Continue")).toBeTruthy();
  });

  it("finishes the legal ready hand through the Win action", () => {
    render();
    skipTo("c4-s3-win");

    expect(container.textContent).toContain("five groups plus one pair");
    expect(container.textContent).toContain("Self-Draw (Zimo)");

    const win = container.querySelector<HTMLButtonElement>(".action-win");
    expect(win).not.toBeNull();
    expect(win?.textContent).toContain("3");
    act(() => win?.click());

    expect(container.textContent).toContain(
      "You won: five groups plus one pair, worth 3 Tai",
    );
  });

  it("skips one step without leaving the tutorial", () => {
    render();
    begin();
    click("Skip step");

    expect(onExit).not.toHaveBeenCalled();
    expect(container.textContent).toContain(TUTORIAL_CHAPTERS[0].steps[1].instruction);
    expect(
      events.find((event) => event.name === "tutorial_skipped")?.fromStepId,
    ).toBe(TUTORIAL_CHAPTERS[0].steps[0].id);
  });

  it("allows an intentional exit from the welcome screen", () => {
    render();
    click("Skip the tutorial");

    expect(onExit).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledWith("skipped");
    const skipped = events.find((event) => event.name === "tutorial_skipped");
    expect(skipped?.fromStepId).toBe(TUTORIAL_CHAPTERS[0].steps[0].id);
    expect(skipped?.scriptVersion).toBe(TUTORIAL_SCRIPT_VERSION);
  });

  it("runs end to end, reporting every chapter and completion", () => {
    render();
    begin();

    // Skipping is the shortest test path through every step; each still emits.
    for (let index = 0; index < allTutorialSteps().length; index += 1) {
      click("Skip step");
    }

    expect(container.textContent).toContain(
      "You are ready for your first hand.",
    );
    expect(
      names().filter((name) => name === "tutorial_chapter_completed"),
    ).toHaveLength(4);
    expect(names()).toContain("tutorial_completed");

    click("Finish and return to lobby");
    expect(onExit).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledWith("completed");
  });

  it("can be replayed from the end without a remount", () => {
    render();
    begin();
    for (let index = 0; index < allTutorialSteps().length; index += 1) {
      click("Skip step");
    }

    click("Replay the tutorial");

    expect(container.textContent).toContain("Never played Mahjong? Start here.");
    expect(onExit).not.toHaveBeenCalled();
  });

  it("stamps every event with the new script version", () => {
    render();
    begin();
    click("Continue");

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.scriptVersion).toBe(TUTORIAL_SCRIPT_VERSION);
    }
  });
});
