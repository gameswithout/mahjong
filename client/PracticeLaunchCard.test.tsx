import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PracticeLaunchCard } from "./PracticeLaunchCard";

describe("PracticeLaunchCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("starts Practice from the primary player-facing action", () => {
    const onStart = vi.fn();
    act(() => {
      root.render(
        <PracticeLaunchCard
          busy={false}
          hasSelectedSession={false}
          matchServiceAvailable
          onStart={onStart}
        />,
      );
    });

    expect(container.textContent).toContain("Play a full hand against three bots");
    expect(container.textContent).toContain("do not change Jade");
    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Practice vs Bots");
    act(() => button?.click());
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("blocks a second launch while a Session is already selected", () => {
    const onLeaveSelectedSession = vi.fn();
    act(() => {
      root.render(
        <PracticeLaunchCard
          busy={false}
          hasSelectedSession
          matchServiceAvailable
          onStart={vi.fn()}
          onLeaveSelectedSession={onLeaveSelectedSession}
        />,
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons[0]?.disabled).toBe(true);
    expect(container.textContent).toContain("A table is already active");
    act(() => buttons.find((button) => button.textContent === "Leave current table")?.click());
    expect(onLeaveSelectedSession).toHaveBeenCalledOnce();
  });

  it("explains when Practice is not configured", () => {
    act(() => {
      root.render(
        <PracticeLaunchCard
          busy={false}
          hasSelectedSession={false}
          matchServiceAvailable={false}
          onStart={vi.fn()}
        />,
      );
    });

    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "match service is not configured",
    );
  });

  it("surfaces stranded Session cleanup as a retryable player error", () => {
    const onLeaveSelectedSession = vi.fn();
    act(() => {
      root.render(
        <PracticeLaunchCard
          busy={false}
          hasSelectedSession
          cleanupRequired
          matchServiceAvailable
          onStart={vi.fn()}
          onLeaveSelectedSession={onLeaveSelectedSession}
        />,
      );
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "couldn't leave your previous table",
    );
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry leaving table",
    );
    act(() => retry?.click());
    expect(onLeaveSelectedSession).toHaveBeenCalledOnce();
  });
});
