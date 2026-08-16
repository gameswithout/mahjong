import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { HandXPAward, PlayerProgression } from "../protocol/envelope";
import { XPAward } from "./XPAward";

const progression: PlayerProgression = {
  level: 3,
  lifetime_xp: 1_400,
  xp_into_level: 300,
  xp_for_next_level: 700,
  next: { level: 5, kind: "table_theme", name: "Tea House" },
};

describe("XPAward", () => {
  it("renders nothing without a server award", () => {
    // The client never invents XP. No award, no panel.
    expect(renderToStaticMarkup(<XPAward />)).toBe("");
    expect(renderToStaticMarkup(<XPAward award={{ total: 100 }} />)).toBe("");
    expect(renderToStaticMarkup(<XPAward progression={progression} />)).toBe("");
  });

  it("shows the total and the breakdown that adds up to it", () => {
    const award: HandXPAward = {
      source: "public_hand",
      total: 200,
      components: [
        { label: "Hand completed", amount: 100 },
        { label: "Won the hand", amount: 75 },
        { label: "Tai scored", amount: 25 },
      ],
    };
    const markup = renderToStaticMarkup(<XPAward award={award} progression={progression} />);

    expect(markup).toContain("+200 XP");
    expect(markup).toContain("Hand completed");
    expect(markup).toContain("Won the hand");
    expect(markup).toContain("Tai scored");
  });

  it("names the next reward rather than only the distance to it", () => {
    const markup = renderToStaticMarkup(
      <XPAward award={{ total: 100 }} progression={progression} />,
    );

    // "12% to level 5" means nothing on its own; the reward name does.
    expect(markup).toContain("Tea House");
    expect(markup).toContain("table theme");
    expect(markup).toContain("level 5");
    expect(markup).toContain("300 / 700 XP to level 4");
  });

  it("explains when the daily Practice mastery cap is reached", () => {
    const capped = renderToStaticMarkup(
      <XPAward
        award={{ source: "practice_hand", total: 0, capped_by_daily: true }}
        progression={progression}
      />,
    );

    expect(capped).toContain("No XP from this hand");
    expect(capped).toContain("Today&#x27;s 100 XP Practice mastery limit has been reached");
    expect(capped).toContain("Online Play remains uncapped");
  });

  it("does not show a progress bar or next reward at the level cap", () => {
    const markup = renderToStaticMarkup(
      <XPAward
        award={{ total: 175 }}
        progression={{ level: 50, lifetime_xp: 500_000, at_cap: true }}
      />,
    );

    expect(markup).toContain("Level 50");
    expect(markup).toContain("Maximum level reached");
    expect(markup).not.toContain("progressbar");
    expect(markup).not.toContain("Next reward");
  });

  it("exposes the bar to assistive technology with real bounds", () => {
    const markup = renderToStaticMarkup(
      <XPAward award={{ total: 100 }} progression={progression} />,
    );

    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="300"');
    expect(markup).toContain('aria-valuemax="700"');
  });

  it("survives a zero denominator without rendering an impossible bar", () => {
    // A malformed or absent next-level cost must not produce an Infinity width.
    const markup = renderToStaticMarkup(
      <XPAward
        award={{ total: 25 }}
        progression={{ level: 2, xp_into_level: 40, xp_for_next_level: 0 }}
      />,
    );

    expect(markup).toContain("width:0%");
    expect(markup).not.toContain("Infinity");
    expect(markup).not.toContain("NaN");
  });
});
