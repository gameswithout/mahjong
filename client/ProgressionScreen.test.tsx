import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { LevelStep, PlayerProgression } from "../protocol/envelope";
import { ProgressionScreen } from "./ProgressionScreen";

const curve: LevelStep[] = [
  { level: 1, total_xp_required: 0, xp_for_next_level: 500 },
  {
    level: 2,
    total_xp_required: 500,
    xp_for_next_level: 600,
    rewards: [{ level: 2, kind: "title", name: "Student", code: "level-2-student-title" }],
  },
  { level: 3, total_xp_required: 1_100, xp_for_next_level: 700 },
  {
    level: 5,
    total_xp_required: 2_600,
    rewards: [{ level: 5, kind: "table_theme", name: "Tea House", code: "level-5-tea-house" }],
  },
];

const progression: PlayerProgression = {
  level: 2,
  lifetime_xp: 800,
  xp_into_level: 300,
  xp_for_next_level: 600,
  earned: [
    { level: 2, kind: "title", name: "Student", code: "level-2-student-title" },
  ],
  onboarding: {
    outcome: "ONBOARDING_OUTCOME_COMPLETED",
    recorded_at: "2026-07-27T12:00:00Z",
  },
};

describe("ProgressionScreen", () => {
  it("shows the whole curve, including levels that grant nothing", () => {
    const markup = renderToStaticMarkup(
      <ProgressionScreen progression={progression} curve={curve} onClose={vi.fn()} />,
    );

    // Hiding rewardless levels would imply every level carries a reward.
    expect(markup).toContain("Level 1");
    expect(markup).toContain("Level 3");
    expect(markup).toContain("Student");
    expect(markup).toContain("Tea House");
  });

  it("marks reached and locked levels in text, not colour alone", () => {
    const markup = renderToStaticMarkup(
      <ProgressionScreen progression={progression} curve={curve} onClose={vi.fn()} />,
    );

    expect(markup).toContain("Reached");
    expect(markup).toContain("Locked");
    // Level 2 is the current level and must read as reached, not locked.
    expect(markup.indexOf("Reached")).toBeLessThan(markup.lastIndexOf("Locked"));
  });

  it("says XP does not gate anything", () => {
    const markup = renderToStaticMarkup(
      <ProgressionScreen progression={progression} curve={curve} onClose={vi.fn()} />,
    );

    // A level beside a lobby invites exactly the assumption §12.1 forbids.
    expect(markup).toContain("never changes matchmaking");
    expect(markup).toContain("High Contrast tiles are accessibility content");
  });

  it("shows persisted earned rewards and tutorial status", () => {
    const markup = renderToStaticMarkup(
      <ProgressionScreen progression={progression} curve={curve} onClose={vi.fn()} />,
    );

    expect(markup).toContain("Earned rewards");
    expect(markup).toContain("Student");
    expect(markup).toContain("Tutorial:");
    expect(markup).toContain("Completed");
    expect(markup).toContain('aria-label="Level 2 progress"');
  });

  it("degrades to a stated absence rather than an empty screen", () => {
    const markup = renderToStaticMarkup(
      <ProgressionScreen progression={progression} curve={[]} onClose={vi.fn()} />,
    );

    expect(markup).toContain("reward curve is unavailable");
  });

  it("reports the cap instead of a next level that does not exist", () => {
    const markup = renderToStaticMarkup(
      <ProgressionScreen
        progression={{ level: 50, lifetime_xp: 500_000, at_cap: true }}
        curve={curve}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("maximum level");
    expect(markup).not.toContain("to level 51");
  });
});
