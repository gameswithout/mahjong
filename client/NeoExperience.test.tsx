import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NeoExperience, neoStorageKey, readNeo } from "./NeoExperience";
import { GameModeMenu } from "./GameModeMenu";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup = () => {};
beforeEach(() => localStorage.clear());
afterEach(() => cleanup());
function mount(id = "guest-neo", nextCta?: ReactNode) {
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node); const play = vi.fn();
  act(() => root.render(<NeoExperience userId={id} onPlayUnranked={play} nextCta={nextCta}>{({openRanked,playUnranked}) => <><h1>Main menu</h1><GameModeMenu onPlayUnranked={playUnranked} onPlayRanked={openRanked} /></>}</NeoExperience>));
  cleanup = () => { act(() => root.unmount()); node.remove(); };
  const click = (label: string) => {
    const button = [...node.querySelectorAll("button")].find((button) => button.textContent === label);
    if (!button) throw new Error(`Missing button: ${label}`);
    act(() => button.click());
  };
  return { node, play, click };
}
describe("simple main-menu NEO widget", () => {
  it("shows the familiarity question alongside both game modes", () => {
    const {node} = mount();
    expect(node.querySelectorAll(".neo-path-actions button")).toHaveLength(3);
    expect(node.textContent).toContain("What is your familiarity with Mahjong?");
    expect(node.textContent).toContain("Main menu");
    expect(node.textContent).toContain("Play Casual");
    expect(node.textContent).toContain("Play Ranked");
  });
  it("opens only a blank tutorial placeholder and completes on return", () => {
    const {node,click,play}=mount(); click("New Player");
    expect(node.querySelector(".neo-blank")).not.toBeNull();
    expect(node.textContent).toBe("Back to main menu");
    click("Back to main menu");
    expect(node.textContent).toContain("Main menu");
    expect(node.querySelector(".neo-familiarity")).toBeNull();
    expect(readNeo("guest-neo")).toMatchObject({path:"new",step:"home"});
    expect(play).not.toHaveBeenCalled();
  });
  it("describes Casual and highlights Unranked without launching a game", () => {
    const {node,click,play}=mount(); click("Casual Player");
    expect(node.textContent).toContain("Casual is the best place to start");
    expect(node.querySelector(".neo-menu")?.getAttribute("data-neo-highlight")).toBe("unranked");
    expect(play).not.toHaveBeenCalled();
    click("Got it"); expect(node.querySelector(".neo-familiarity")).toBeNull();
  });
  it("describes Experienced and highlights Ranked without opening its preview", () => {
    const {node,click}=mount(); click("Experienced Player");
    expect(node.textContent).toContain("Start with Ranked for a full dealer rotation");
    expect(node.querySelector(".neo-menu")?.getAttribute("data-neo-highlight")).toBe("ranked");
    expect(node.textContent).not.toContain("Before your first Ranked game");
    click("Got it"); expect(readNeo("guest-neo")).toMatchObject({path:"experienced",step:"home"});
  });
  it("completes the chosen path when the recommended game is started", () => {
    const {node,click,play}=mount(); click("Casual Player"); click("Play Casual");
    expect(play).toHaveBeenCalledOnce(); expect(node.querySelector(".neo-familiarity")).toBeNull();
    expect(readNeo("guest-neo").step).toBe("home");
  });
  it("keeps completed onboarding hidden on the next visit", () => {
    localStorage.setItem(neoStorageKey("guest-neo"), JSON.stringify({path:"casual",step:"home"}));
    const {node}=mount(); expect(node.querySelector(".neo-familiarity")).toBeNull();
    expect(node.querySelector(".neo-menu")?.getAttribute("data-neo-highlight")).toBeNull();
  });
  it("dismisses the flexible banner without choosing a path and remembers it", () => {
    const { node, click, play } = mount(); click("Not now");
    expect(node.querySelector(".neo-familiarity")).toBeNull();
    expect(readNeo("guest-neo")).toEqual({ step: "home" });
    expect(play).not.toHaveBeenCalled();
    cleanup();
    expect(mount().node.querySelector(".neo-familiarity")).toBeNull();
  });
  it("uses one temporary CTA slot, showing privacy only after NEO", () => {
    const { node, click } = mount("guest-neo", <p>Privacy prompt</p>);
    expect(node.textContent).not.toContain("Privacy prompt");
    expect(node.querySelectorAll(".temporary-cta")).toHaveLength(1);
    click("Not now");
    expect(node.querySelector(".neo-familiarity")).toBeNull();
    expect(node.textContent).toContain("Privacy prompt");
  });
  it("safely migrates old prototype state and isolates accounts", () => {
    localStorage.setItem(neoStorageKey("a"), JSON.stringify({path:"new",step:"guided"}));
    expect(readNeo("a")).toMatchObject({step:"question",path:undefined});
    localStorage.setItem(neoStorageKey("a"), JSON.stringify({path:"new",step:"home"}));
    expect(readNeo("a").step).toBe("home"); expect(readNeo("b").step).toBe("question");
    localStorage.setItem(neoStorageKey("a"), "invalid"); expect(readNeo("a").step).toBe("question");
  });
});
