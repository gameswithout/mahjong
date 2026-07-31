import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  OnboardingEvidence,
  type OnboardingEvidenceScenario,
} from "./OnboardingEvidence";

describe("P1 onboarding evidence surfaces", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(scenario: OnboardingEvidenceScenario) {
    act(() => root.render(<OnboardingEvidence scenario={scenario} />));
  }

  function expectAccessiblePageStructure() {
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelectorAll("h1")).toHaveLength(1);

    const ids = Array.from(container.querySelectorAll("[id]"), (element) =>
      element.getAttribute("id"),
    ).filter((id): id is string => Boolean(id));
    expect(new Set(ids).size).toBe(ids.length);

    const unnamedControls = Array.from(
      container.querySelectorAll(
        "button, a[href], input, select, textarea",
      ),
    ).filter((control) => {
      const labelledBy = control.getAttribute("aria-labelledby");
      const label = control.getAttribute("aria-label");
      const wrappingLabel = control.closest("label")?.textContent?.trim();
      const explicitLabel = control.id
        ? container.querySelector(`label[for="${control.id}"]`)?.textContent?.trim()
        : null;
      return (
        !labelledBy &&
        !label &&
        !wrappingLabel &&
        !explicitLabel &&
        !control.textContent?.trim()
      );
    });
    expect(unnamedControls).toHaveLength(0);
  }

  it.each<OnboardingEvidenceScenario>([
    "lobby",
    "queue-normal",
    "queue-slow",
    "tutorial",
  ])("keeps %s page semantics accessible", (scenario) => {
    render(scenario);
    expectAccessiblePageStructure();
  });

  it("renders the complete player-facing lobby hierarchy", () => {
    render("lobby");

    expect(container.querySelector("h1")?.textContent).toContain(
      "Play a hand with friends",
    );
    expect(container.textContent).toContain("12,480");
    expect(container.textContent).toContain("Level 4");
    expect(container.textContent).toContain("Start the tutorial");
    expect(container.textContent).toContain("Practice vs Bots");
    expect(container.textContent).toContain("Find a table");
    expect(container.textContent).toContain("Coming soon");
  });

  it("renders the p50 queue state without inventing an estimate", () => {
    render("queue-normal");

    const queue = container.querySelector('[data-testid="queue-state"]');
    expect(queue?.getAttribute("role")).toBe("status");
    expect(queue?.textContent).toContain(
      "Still searching. A table needs four players.",
    );
    expect(queue?.textContent).toContain("45s in queue");
    expect(queue?.textContent).not.toContain("Practice instead");
  });

  it("renders the patience escape hatch after 90 seconds", () => {
    render("queue-slow");

    const queue = container.querySelector('[data-testid="queue-state"]');
    expect(queue?.textContent).toContain("This is taking longer than usual");
    expect(queue?.textContent).toContain("1m 35s in queue");
    expect(queue?.textContent).toContain("Practice instead");
    expect(queue?.textContent).toContain("Cancel");
  });

  it("preserves the page heading after the tutorial starts", () => {
    render("tutorial");

    const start = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Start with the basics",
    );
    expect(start).toBeDefined();
    act(() => start?.click());

    expect(container.querySelector("h1")?.textContent).toContain(
      "Your first turn",
    );
    expectAccessiblePageStructure();
  });
});
