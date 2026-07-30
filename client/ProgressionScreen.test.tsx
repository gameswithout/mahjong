import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type {
  LevelStep,
  PlayerAchievement,
  PlayerProgression,
} from "../protocol/envelope";
import { AchievementScreen, ProgressionScreen } from "./ProgressionScreen";

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

const achievements: PlayerAchievement[] = Array.from({ length: 32 }, (_, index) => {
  const eligible = index < 23;
  return {
    code: `achievement-${index + 1}`,
    name:
      index === 0
        ? "First Hand"
        : index === 1
          ? "First Win"
          : index === 23
            ? "Claim Student"
            : `Achievement ${index + 1}`,
    description:
      index === 23
        ? "Complete 50 Chow or Pong claims."
        : `Complete goal ${index + 1}.`,
    current: index === 0 ? 1 : index === 1 ? 4 : 0,
    goal: index === 1 ? 10 : index === 23 ? 50 : 1,
    xp_reward: index === 1 ? 200 : 100,
    bonus_reward: index === 1 ? "First Victory title" : undefined,
    eligible,
    unlocked: index === 0,
    unavailable_reason: eligible
      ? undefined
      : index < 27
        ? "Progress tracking for this achievement is not available yet."
        : "Full Rotation is not available yet.",
  };
});

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

  it("offers the authenticated achievement catalog from progression", () => {
    const markup = renderToStaticMarkup(
      <ProgressionScreen
        progression={progression}
        curve={curve}
        onClose={vi.fn()}
        onOpenAchievements={vi.fn()}
      />,
    );

    expect(markup).toContain("Achievements");
    expect(markup).toContain("View all 32");
  });
});

describe("AchievementScreen", () => {
  it("shows all 32 launch goals while separating 23 available from 9 unavailable", () => {
    const markup = renderToStaticMarkup(
      <AchievementScreen achievements={achievements} onClose={vi.fn()} />,
    );

    expect(markup).toContain("Achievements");
    expect(markup).toContain("23 goals");
    expect(markup).toContain("9 goals");
    expect(markup).toContain("Claim Student");
    expect(markup).toContain("Progress tracking for this achievement is not available yet.");
    expect(markup).toContain("Full Rotation is not available yet.");
  });

  it("uses explicit states, exact progress, rewards, and the Practice exclusion", () => {
    const markup = renderToStaticMarkup(
      <AchievementScreen achievements={achievements} onClose={vi.fn()} />,
    );

    expect(markup).toContain("Unlocked");
    expect(markup).toContain("In progress");
    expect(markup).toContain("<strong>4</strong> / 10");
    expect(markup).toContain("+200 XP");
    expect(markup).toContain("Bonus: First Victory title");
    expect(markup).toContain("Practice does not");
    expect(markup).toContain('aria-label="First Win progress"');
    expect(markup).toContain("Back to Progress");
  });
});
