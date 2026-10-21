import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { MainMenuTabs } from "./MainMenu";
import { JourneyScreen } from "./JourneyScreen";
import { journeyFixture } from "./fixtures/journey";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup = () => {};
afterEach(() => cleanup());
function mount() {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const fixture = journeyFixture(12);
  act(() => root.render(<MainMenuTabs
    journey={<JourneyScreen embedded {...fixture} onClose={() => undefined} />}
    inventory={<JourneyScreen embedded view="inventory" {...fixture} onClose={() => undefined} />}
    chronicle={<JourneyScreen embedded view="chronicle" {...fixture} onClose={() => undefined} />}
    social="Social" store="Store" />));
  cleanup = () => { act(() => root.unmount()); host.remove(); };
  const click = (text: string) => { const button = [...host.querySelectorAll("button")].find((item) => item.textContent === text)!; expect(button).toBeTruthy(); act(() => button.click()); };
  return { host, click, fixture };
}
it("switches collections and never renders proposed achievements as unlocked", () => {
  const { host, click } = mount(); click("Skill");
  const panel = host.querySelector<HTMLElement>("#journey-collection-panel-skill")!;
  expect(panel.hidden).toBe(false);
  expect(host.querySelector<HTMLElement>("#journey-collection-panel-legacy")!.hidden).toBe(true);
  expect(panel.querySelectorAll('[data-definition-status="proposed"]')).toHaveLength(7);
  expect(panel.querySelector(".is-earned")).toBeNull();
  click("Highlights");
  expect(host.querySelector("#journey-collection-panel-highlights")!.textContent).toContain("No verified Highlight records");
});
it("shows only owned cosmetics in a private preview without changing equipment", () => {
  const { host, click, fixture } = mount();
  const equipment = [...fixture.profile.tileSlotIds];
  click("Inventory");
  expect(host.querySelector("#menu-panel-inventory")?.textContent).toContain("OG Founder profile tile");
  expect(host.querySelector("#menu-panel-inventory")?.textContent).not.toContain("Showcase in preview");
  click("Chronicle"); click("Showcase in preview");
  click("Inventory"); click("Chronicle");
  expect(host.querySelector("#menu-panel-chronicle")?.textContent).toContain("Remove from preview");
  click("Preview showcase");
  const dialog = host.querySelector("dialog")!;
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(dialog.textContent).toContain("OG Founder profile tile");
  expect(dialog.textContent).toContain("not published");
  expect(dialog.textContent).not.toContain("Jade balance");
  expect(fixture.profile.tileSlotIds).toEqual(equipment);
  click("Close preview"); expect(host.querySelector("dialog")).toBeNull();
  click("Remove from preview"); click("Preview showcase");
  expect(host.querySelectorAll("dialog .journey-showcase-slots li")).toHaveLength(3);
  expect(host.querySelector("dialog")?.textContent).toContain("Empty slot 1");
  expect(host.querySelector("dialog")?.textContent).not.toContain("OG Founder profile tile");
});
it("viewing an older earned chapter never downgrades the player's public preview", () => {
  const { host, click } = mount();
  click("Chronicle");
  act(() => host.querySelector<HTMLButtonElement>(".journey-chapters button")!.click());
  expect(host.querySelector(".journey-chronicle-copy h3")?.textContent).toBe("First Seat");
  expect(host.querySelector(".journey-score-legacy .journey-score-highlight")?.textContent).toBe("Table Regular");
  click("Preview public profile");
  expect(host.querySelector('dialog [role="img"]')?.getAttribute("aria-label")).toBe("Living Chronicle: Familiar Table");
});

it("routes dimension actions to their collections and omits XP-based Legacy levels", () => {
  const { host, click } = mount();
  expect(host.querySelector(".journey-scoreboard")?.textContent).not.toContain("XP");
  expect(host.querySelector(".journey-score-prestige")).toBeNull();
  click("Explore Highlight achievements");
  expect(host.querySelector<HTMLElement>("#journey-collection-panel-highlights")!.hidden).toBe(false);
  expect(host.querySelector(".journey-score-highlights .journey-score-kpi strong")?.textContent).toBe("—");
  click("Next: First Ranked Victory");
  expect(host.querySelector<HTMLElement>("#journey-collection-panel-skill")!.hidden).toBe(false);
  click("Next: Familiar Face · 38 rotations to go");
  expect(host.querySelector<HTMLElement>("#journey-collection-panel-legacy")!.hidden).toBe(false);
});
