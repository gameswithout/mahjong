import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotPersonaPicker, MAX_PERSONA_PICKS, type BotPersonaPickerState } from "./BotPersonaPicker";
import type { BotPersonaCard } from "./bot-persona-catalog";

function card(id: string, name: string, styleTag: string): BotPersonaCard {
  return {
    id,
    name,
    styleTag,
    tagline: `${name}'s tagline.`,
    glyph: "雀",
    bars: { pace: 3, value: 3, caution: 3, calling: 3, concealment: 3 },
    strength: `${name}'s strength.`,
    weakness: `${name}'s weakness.`,
  };
}

const roster = [
  card("river-scholar", "River Scholar", "Adaptive"),
  card("swift-sparrow", "Swift Sparrow", "Rush"),
  card("stone-lion", "Stone Lion", "Guard"),
  card("jade-dragon", "Jade Dragon", "Big Hand"),
];

function baseState(overrides: Partial<BotPersonaPickerState> = {}): BotPersonaPickerState {
  return {
    personas: roster,
    loading: false,
    error: null,
    selectedIds: [],
    onToggle: vi.fn(),
    onSelectForMe: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  };
}

describe("BotPersonaPicker", () => {
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

  it("collapses by default and reads Select for me until something is picked", () => {
    const state = baseState();
    act(() => root.render(<BotPersonaPicker state={state} />));

    const details = container.querySelector("details.persona-picker");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(container.textContent).toContain("Select for me");
    // Nothing picked yet: no reset button, no need for one.
    expect(container.querySelector(".persona-picker-reset")).toBeNull();
  });

  it("fetches the catalog only the first time it is expanded", () => {
    const state = baseState();
    act(() => root.render(<BotPersonaPicker state={state} />));

    const details = container.querySelector("details.persona-picker") as HTMLDetailsElement;
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(state.onOpen).toHaveBeenCalledTimes(1);

    // Collapsing and re-expanding fires onOpen again — App.tsx's own "idle"
    // guard is what prevents a second network request, not this component.
    act(() => {
      details.open = false;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(state.onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders every persona as a togglable card and calls onToggle by id", () => {
    const state = baseState();
    act(() => root.render(<BotPersonaPicker state={state} />));

    const cards = container.querySelectorAll(".persona-picker-card");
    expect(cards).toHaveLength(roster.length);

    const sparrowCard = Array.from(cards).find((el) => el.textContent?.includes("Swift Sparrow"));
    expect(sparrowCard).toBeTruthy();
    act(() => (sparrowCard as HTMLButtonElement).click());
    expect(state.onToggle).toHaveBeenCalledWith("swift-sparrow");
  });

  it("marks a selected card pressed and shows the picked count", () => {
    const state = baseState({ selectedIds: ["swift-sparrow"] });
    act(() => root.render(<BotPersonaPicker state={state} />));

    const sparrowCard = Array.from(container.querySelectorAll(".persona-picker-card")).find((el) =>
      el.textContent?.includes("Swift Sparrow"),
    ) as HTMLButtonElement;
    expect(sparrowCard.getAttribute("aria-pressed")).toBe("true");
    expect(sparrowCard.disabled).toBe(false);
    expect(container.textContent).toContain(`1/${MAX_PERSONA_PICKS} picked`);
  });

  // The cap is enforcement, not just display: an unselected card past the
  // limit must actually refuse the click, or "up to 3" silently becomes
  // "however many you click".
  it(`disables unselected cards once ${MAX_PERSONA_PICKS} are picked`, () => {
    const state = baseState({ selectedIds: ["river-scholar", "swift-sparrow", "stone-lion"] });
    act(() => root.render(<BotPersonaPicker state={state} />));

    const dragonCard = Array.from(container.querySelectorAll(".persona-picker-card")).find((el) =>
      el.textContent?.includes("Jade Dragon"),
    ) as HTMLButtonElement;
    expect(dragonCard.disabled).toBe(true);
    act(() => dragonCard.click());
    expect(state.onToggle).not.toHaveBeenCalled();

    // A selected card stays clickable even at the cap — deselecting must
    // always work, or a player could get stuck unable to change a pick.
    const sparrowCard = Array.from(container.querySelectorAll(".persona-picker-card")).find((el) =>
      el.textContent?.includes("Swift Sparrow"),
    ) as HTMLButtonElement;
    expect(sparrowCard.disabled).toBe(false);
    act(() => sparrowCard.click());
    expect(state.onToggle).toHaveBeenCalledWith("swift-sparrow");
  });

  it("shows a reset action once something is picked, and it calls onSelectForMe", () => {
    const state = baseState({ selectedIds: ["swift-sparrow"] });
    act(() => root.render(<BotPersonaPicker state={state} />));

    const reset = container.querySelector(".persona-picker-reset") as HTMLButtonElement;
    expect(reset).toBeTruthy();
    act(() => reset.click());
    expect(state.onSelectForMe).toHaveBeenCalledTimes(1);
  });

  it("shows a loading state instead of the grid", () => {
    const state = baseState({ loading: true, personas: [] });
    act(() => root.render(<BotPersonaPicker state={state} />));

    expect(container.textContent).toContain("Loading opponents");
    expect(container.querySelectorAll(".persona-picker-card")).toHaveLength(0);
  });

  it("surfaces a load error without breaking the launch flow around it", () => {
    const state = baseState({ error: "The opponent catalog could not be loaded.", personas: [] });
    act(() => root.render(<BotPersonaPicker state={state} />));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("could not be loaded");
  });
});
