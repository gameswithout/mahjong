import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import type {
  LevelReward,
  LevelStep,
  PlayerProgression,
} from "../protocol/envelope";
import { ProgressionScreen } from "./ProgressionScreen";
import "./styles.css";

// P2.1 visual-evidence harness. Production always receives this curve from
// the service; this fixed snapshot exists only so the real component can be
// inspected at desktop and compact widths without an authenticated account.
const rewards: LevelReward[] = [
  { code: "level-2-student-title", level: 2, kind: "title", name: "Student" },
  { code: "level-5-tea-house-theme", level: 5, kind: "table_theme", name: "Tea House" },
  { code: "level-10-jade-tile-skin", level: 10, kind: "tile_skin", name: "Jade" },
  { code: "level-15-bamboo-frame", level: 15, kind: "avatar_frame", name: "Bamboo" },
  { code: "level-20-night-market-theme", level: 20, kind: "table_theme", name: "Night Market" },
  { code: "level-25-steady-hand-title", level: 25, kind: "title", name: "Steady Hand" },
  { code: "level-30-jade-ring-frame", level: 30, kind: "avatar_frame", name: "Jade Ring" },
  { code: "level-35-wall-reader-title", level: 35, kind: "title", name: "Wall Reader" },
  { code: "level-40-tea-blossom-frame", level: 40, kind: "avatar_frame", name: "Tea Blossom" },
  { code: "level-45-table-veteran-title", level: 45, kind: "title", name: "Table Veteran" },
  { code: "level-50-mahjong-master-title", level: 50, kind: "title", name: "Mahjong Master" },
  { code: "level-50-master-frame", level: 50, kind: "avatar_frame", name: "Master" },
];

function levelCurve(): LevelStep[] {
  let total = 0;
  return Array.from({ length: 50 }, (_, index) => {
    const level = index + 1;
    const step = {
      level,
      total_xp_required: total,
      xp_for_next_level: level < 50 ? 500 + (level - 1) * 100 : 0,
      rewards: rewards.filter((reward) => reward.level === level),
    };
    total += step.xp_for_next_level;
    return step;
  });
}

const progression: PlayerProgression = {
  level: 12,
  lifetime_xp: 11_720,
  xp_into_level: 720,
  xp_for_next_level: 1_600,
  earned: rewards.filter((reward) => reward.level <= 12),
  next: rewards.find((reward) => reward.level > 12),
  onboarding: {
    outcome: "ONBOARDING_OUTCOME_COMPLETED",
    recorded_at: "2026-07-27T12:00:00Z",
  },
};

const container = document.querySelector("#root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <div className="game-screen">
        <ProgressionScreen
          progression={progression}
          curve={levelCurve()}
          onClose={() => undefined}
        />
      </div>
    </StrictMode>,
  );
}
