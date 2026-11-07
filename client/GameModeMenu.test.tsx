import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameModeMenu } from "./GameModeMenu";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup = () => {};
afterEach(() => { cleanup(); vi.useRealTimers(); });
function renderMenu(busy = false, unavailable = false, rankedOnly = false) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); const play = vi.fn(); const ranked = vi.fn();
  act(() => root.render(<GameModeMenu onPlayUnranked={play} unrankedBusy={busy && !rankedOnly} onPlayRanked={ranked} rankedBusy={rankedOnly || busy} rankedUnavailable={unavailable} />));
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  return { container, play, ranked };
}
describe("two-mode main menu", () => {
  it("shows elapsed queue time and the Ranked maximum", () => {
    vi.useFakeTimers();
    const { container } = renderMenu(true);
    act(() => vi.advanceTimersByTime(65000));
    const timers = container.querySelectorAll(".game-mode-timer");
    expect(timers[0].textContent).toBe("1:05 elapsed");
    expect(timers[1].textContent).toBe("1:05 elapsed · 2:00 maximum");
  });

  it("blocks Casual while only Ranked is searching and reserves feedback in both cards", () => {
    const { container, play } = renderMenu(false, false, true);
    const casual = container.querySelector<HTMLButtonElement>('[aria-labelledby="unranked-title"] .primary-action')!;
    expect(casual.disabled).toBe(true);
    act(() => casual.click());
    expect(play).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".game-mode-feedback")).toHaveLength(2);
    expect(container.querySelectorAll(".game-mode-cancel-slot")).toHaveLength(2);
  });

  it("starts Unranked directly with one click and no submenu", () => {
    const { container, play } = renderMenu();
    const button = container.querySelector<HTMLButtonElement>(".game-mode-direct button")!;
    expect(button.textContent).toBe("Play Casual");
    act(() => button.click()); expect(play).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("Choose your opponents");
    expect(container.textContent).not.toContain("Solo Practice");
    expect(container.querySelectorAll(".game-mode-card details")).toHaveLength(0);
  });
  it("blocks duplicate starts while finding a table", () => {
    const { container, play } = renderMenu(true);
    const button = container.querySelector<HTMLButtonElement>(".game-mode-direct button")!;
    expect(button.disabled).toBe(true); act(() => button.click()); expect(play).not.toHaveBeenCalled();
  });
  it("starts Ranked directly without a dropdown or nested formats", () => {
    const { container, ranked } = renderMenu();
    const button = container.querySelector<HTMLButtonElement>('[aria-labelledby="ranked-title"] button')!;
    expect(button.textContent).toBe("Play Ranked");
    act(() => button.click()); expect(ranked).toHaveBeenCalledOnce();
    expect(container.querySelector(".game-mode-card details")).toBeNull();
    expect(container.textContent).not.toContain("Bamboo Courtyard");
    expect(container.textContent).not.toContain("Choose Ranked");
  });
  it("blocks a second Ranked start while searching", () => {
    const { container, ranked } = renderMenu(true);
    const button = container.querySelector<HTMLButtonElement>('[aria-labelledby="ranked-title"] button')!;
    expect(button.disabled).toBe(true);
    act(() => button.click()); expect(ranked).not.toHaveBeenCalled();
  });
  it("disables Ranked when it is unavailable", () => {
    const {container,ranked}=renderMenu(false,true);
    const button=container.querySelector<HTMLButtonElement>('[aria-labelledby="ranked-title"] button')!;
    expect(button.disabled).toBe(true); act(()=>button.click()); expect(ranked).not.toHaveBeenCalled();
  });
});
