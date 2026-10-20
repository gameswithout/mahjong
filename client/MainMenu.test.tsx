import { act } from "react";
import { createRoot } from "react-dom/client";
import { PlayerProfileBadge } from "./PlayerProfile";
import { defaultPlayerProfile } from "./player-profile";
import { afterEach, expect, it, vi } from "vitest";
import { MainMenuTabs, MainMenuHeader, MainMenuProfile } from "./MainMenu";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup = () => {};
afterEach(() => cleanup());
it("defaults to Journey and switches a single shared panel by pointer and keyboard", () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const select = vi.fn();
  act(() => root.render(<MainMenuTabs journey="Your progress" social="Your party" store="Your store" onSelect={select} />));
  cleanup = () => { act(() => root.unmount()); host.remove(); };
  const tab = (id: string) => host.querySelector<HTMLButtonElement>(`#menu-tab-${id}`)!;
  const panel = (id: string) => host.querySelector<HTMLElement>(`#menu-panel-${id}`)!;
  expect(tab("journey").getAttribute("aria-selected")).toBe("true");
  expect(panel("journey").hidden).toBe(false); expect(panel("social").hidden).toBe(true);
  act(() => tab("social").click());
  expect(panel("social").hidden).toBe(false); expect(panel("journey").hidden).toBe(true);
  act(() => tab("social").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(document.activeElement).toBe(tab("store")); expect(panel("store").hidden).toBe(false);
  expect(select).toHaveBeenLastCalledWith("store");
  act(() => tab("store").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
  expect(panel("journey").hidden).toBe(false);
});

it("shows all profile tiles and nickname, icon utilities, unread count, and an edit overlay", () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const settings = vi.fn();
  act(() => root.render(<MainMenuHeader unreadCount={3} onSettings={settings}
    profile={<MainMenuProfile badge={<PlayerProfileBadge profile={defaultPlayerProfile(true)} />} editor={<p>Editor content</p>} />} />));
  cleanup = () => { act(() => root.unmount()); host.remove(); };
  expect(host.querySelector(".main-menu-brand strong")?.textContent).toBe("Mahjong");
  expect(host.querySelectorAll(".profile-tile-icon")).toHaveLength(3);
  expect(host.querySelector(".profile-nickname")?.textContent).toBeTruthy();
  expect(host.querySelector(".menu-unread-count")?.textContent).toBe("3");
  expect(host.querySelector("summary")?.getAttribute("aria-label")).toBe("Notifications: 3 unread");
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')!.click());
  expect(settings).toHaveBeenCalledOnce();
  expect(host.querySelector("dialog")).toBeNull();
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Edit player profile"]')!.click());
  expect(host.querySelector("dialog")?.hasAttribute("open")).toBe(true);
  expect(host.querySelector("dialog")?.textContent).toContain("Editor content");
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Close profile editor"]')!.click());
  expect(host.querySelector("dialog")).toBeNull();
});
