import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameModeMenu } from "./GameModeMenu";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup = () => {};
afterEach(() => cleanup());
function renderMenu(busy = false, unavailable = false) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); const play = vi.fn(); const ranked = vi.fn();
  act(() => root.render(<GameModeMenu onPlayUnranked={play} unrankedBusy={busy} onPlayRanked={ranked} rankedBusy={busy} rankedUnavailable={unavailable} />));
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  return { container, play, ranked };
}
describe("two-mode main menu", () => {
  it("starts Unranked directly with one click and no submenu", () => {
    const { container, play } = renderMenu();
    const button = container.querySelector<HTMLButtonElement>(".game-mode-direct button")!;
    expect(button.textContent).toBe("Play Unranked");
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
