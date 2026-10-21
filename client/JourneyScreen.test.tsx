import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { JourneyScreen } from "./JourneyScreen";
import { journeyFixture } from "./fixtures/journey";

const fixture = journeyFixture(12);
function render(view: "journey" | "chronicle" | "inventory" = "journey") {
  const node = document.createElement("div");
  node.innerHTML = renderToStaticMarkup(<JourneyScreen {...fixture} view={view} onClose={vi.fn()} />);
  return node;
}
describe("focused Journey sections", () => {
  it("gives Legacy, Skill, and Highlights the same four information slots and no name badge", () => {
    const node = render();
    const cards = [...node.querySelectorAll(".journey-score-card")];
    expect(cards.map((card) => card.querySelector("h2")?.textContent)).toEqual(["Legacy", "Skill", "Highlights"]);
    for (const card of cards) {
      expect(card.querySelector(".journey-score-kpi strong")).not.toBeNull();
      expect(card.querySelector(".journey-score-highlight")).not.toBeNull();
      expect(card.querySelector(".journey-score-explanation")).not.toBeNull();
    }
    expect(node.querySelector(".player-profile-badge")).toBeNull();
    expect(node.textContent).toContain("12 completed rotations");
    expect(node.textContent).toContain("Table Regular");
    expect(node.textContent).toContain("38 rotations to go");
    expect(node.querySelector(".journey-score-skill .journey-score-kpi strong")?.textContent).toBe("—");
    expect(node.querySelector("#journey-chronicle-title")).toBeNull();
    expect(node.querySelector("#journey-cosmetics-title")).toBeNull();
  });
  it("keeps earned stage selection in Chronicle and locks future chapters", () => {
    const node = render("chronicle");
    expect(node.querySelector("h1")?.textContent).toBe("Chronicle");
    expect(node.querySelectorAll(".journey-chapters button:disabled")).toHaveLength(5);
    expect(node.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Living Chronicle: Familiar Table");
    expect(node.querySelector(".journey-scoreboard")).toBeNull();
    expect(node.textContent).toContain("Customize your showcase");
  });
  it("moves owned collection management into Inventory without public customization controls", () => {
    const node = render("inventory");
    expect(node.querySelector("h1")?.textContent).toBe("Inventory");
    expect(node.querySelector("#journey-cosmetics-title")).not.toBeNull();
    expect(node.textContent).toContain("OG Founder profile tile");
    expect(node.textContent).not.toContain("Showcase in preview");
    expect(node.querySelector(".journey-scoreboard")).toBeNull();
  });
  it("welcomes first-time and unconnected players without inventing saved progress", () => {
    const html = renderToStaticMarkup(<JourneyScreen onClose={vi.fn()} />);
    expect(html).not.toContain("Your Journey is just beginning");
    expect(html).toContain("Next: First Ranked Victory");
    expect(html).not.toContain("Your Journey is unavailable");
    const node = document.createElement("div"); node.innerHTML = html;
    expect(node.querySelector(".journey-score-legacy .journey-score-kpi strong")?.textContent).toBe("—");
    const empty = renderToStaticMarkup(<JourneyScreen {...journeyFixture(0)} onClose={vi.fn()} />);
    expect(empty).not.toContain("Your Journey is just beginning");
    expect(empty).toContain("Your first seat awaits");
  });
  it("uses a compact earned lifetime tag, not a sixty-year milestone ladder", () => {
    const node = render();
    expect(node.querySelector(".journey-membership-tag")).toBeNull();
    expect(node.textContent).not.toContain("Years at the table");
    expect(node.querySelector(".journey-materials")).toBeNull();
    expect(node.textContent).not.toContain("Year 60");
    expect(node.textContent).not.toContain("Lifetime Gold");

  });
  it("keeps loading and retrieval errors distinct from a new player's zero progress", () => {
    const loading = renderToStaticMarkup(<JourneyScreen loadState="loading" onClose={vi.fn()} />);
    expect(loading).toContain("Loading your Journey");
    expect(loading).not.toContain("Your first seat awaits");
    const error = renderToStaticMarkup(<JourneyScreen loadState="error" onRetry={vi.fn()} onClose={vi.fn()} />);
    expect(error).toContain('role="alert"'); expect(error).toContain("Retry Journey");
    expect(error).toContain("Saved progress could not be loaded");
  });
});
