import { useState } from "react";
import type {
  LevelStep,
  PlayerAchievement,
  PlayerProgression,
} from "../protocol/envelope";
import { formatNumber, t, translateSource } from "./i18n";

// §12.2 progression screen: the whole curve, what has been earned, and what is
// next. The curve comes from the server rather than a local copy, so the
// client cannot quote a reward table the server has since changed.

function kindLabel(kind: string): string {
  if (kind === "title") return t("progression.kindTitle");
  if (kind === "table_theme") return t("progression.kindTableTheme");
  if (kind === "tile_skin") return t("progression.kindTileSkin");
  if (kind === "avatar_frame") return t("progression.kindAvatarFrame");
  return kind.replace(/_/g, " ");
}

export function ProgressionScreen({
  progression,
  curve,
  onClose,
  onOpenAchievements,
}: {
  progression: PlayerProgression;
  curve: LevelStep[];
  onClose: () => void;
  onOpenAchievements?: () => void;
}) {
  const level = progression.level ?? 1;
  const atCap = progression.at_cap === true;
  const into = progression.xp_into_level ?? 0;
  const needed = progression.xp_for_next_level ?? 0;
  const lifetime = progression.lifetime_xp ?? 0;
  const percent = needed > 0 ? Math.min(100, Math.round((into / needed) * 100)) : 0;
  const earned = progression.earned ?? [];
  const onboardingOutcome = progression.onboarding?.outcome;

  return (
    <section className="progression-screen" aria-labelledby="progression-title">
      <header className="progression-header">
        <div>
          <p className="status-label">{t("progression.label")}</p>
          <h2 id="progression-title">{t("progression.level", { level })}</h2>
          <p className="progression-lifetime">
            {t("progression.xpEarned", { xp: formatNumber(lifetime) })}
            {atCap
              ? ` · ${t("progression.maximumLevel")}`
              : ` · ${t("progression.toNextLevel", {
                  current: formatNumber(into),
                  needed: formatNumber(needed),
                  level: level + 1,
                })}`}
          </p>
        </div>
        <button type="button" className="secondary-action" onClick={onClose}>
          {t("progression.back")}
        </button>
      </header>

      <p className="progression-note">{t("progression.note")}</p>

      {onOpenAchievements && (
        <button
          type="button"
          className="achievement-entry"
          onClick={onOpenAchievements}
        >
          <span>
            <small>{t("progression.goalsRewards")}</small>
            <strong>{t("progression.achievements")}</strong>
          </span>
          <span>{t("progression.viewAll")} <span aria-hidden="true">→</span></span>
        </button>
      )}

      {!atCap && (
        <div
          className="progression-hero-bar"
          role="progressbar"
          aria-label={t("progression.levelProgress", { level })}
          aria-valuemin={0}
          aria-valuemax={needed}
          aria-valuenow={into}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      )}

      {onboardingOutcome && (
        <p className="progression-onboarding">
          <strong>
            {onboardingOutcome === "ONBOARDING_OUTCOME_COMPLETED"
              ? t("progression.tutorialCompleted")
              : t("progression.tutorialSkipped")}
          </strong>
        </p>
      )}

      <section className="progression-earned" aria-labelledby="progression-earned-title">
        <h3 id="progression-earned-title">{t("progression.earnedRewards")}</h3>
        {earned.length === 0 ? (
          <p>{t("progression.firstReward")}</p>
        ) : (
          <ul>
            {earned.map((reward) => (
              <li key={reward.code ?? `${reward.level}-${reward.kind}-${reward.name}`}>
                <strong>{translateSource(reward.name)}</strong>
                <span>{t("progression.rewardLevel", { kind: kindLabel(reward.kind), level: reward.level })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="progression-curve-heading">
        <h3>{t("progression.levelCurve")}</h3>
        <span>{t("progression.lifetimeRequired")}</span>
      </div>

      {curve.length === 0 ? (
        <p className="progression-empty" role="status">
          {t("progression.curveUnavailable")}
        </p>
      ) : (
        <ol className="progression-curve">
          {curve.map((step) => {
            const reached = step.level <= level;
            const rewards = step.rewards ?? [];
            return (
              <li
                key={step.level}
                className={`progression-step${reached ? " progression-step-reached" : ""}${
                  step.level === level ? " progression-step-current" : ""
                }`}
              >
                <span className="progression-step-level">{t("progression.level", { level: step.level })}</span>
                <span className="progression-step-xp">
                  {formatNumber(step.total_xp_required ?? 0)} XP
                </span>
                {/* Most levels grant nothing. Saying so is more honest than
                    hiding them and implying every level carries a reward. */}
                {rewards.length === 0 ? (
                  <span className="progression-step-rewards progression-step-none">—</span>
                ) : (
                  <span className="progression-step-rewards">
                    {rewards.map((reward) => (
                      <span key={reward.code ?? reward.name} className="progression-reward">
                        <span className="progression-reward-name">{translateSource(reward.name)}</span>
                        <span className="progression-reward-kind">{kindLabel(reward.kind)}</span>
                      </span>
                    ))}
                  </span>
                )}
                {/* Reached state is text, never colour alone. */}
                <span className="progression-step-state">
                  {step.level === level
                    ? t("progression.current")
                    : reached
                      ? t("progression.reached")
                      : t("progression.locked")}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <p className="progression-accessibility">{t("progression.accessibility")}</p>
    </section>
  );
}

function progressLabel(value: number): string {
  return Number.isInteger(value)
    ? formatNumber(value)
    : formatNumber(value, { maximumFractionDigits: 2 });
}

function AvailableAchievement({ achievement }: { achievement: PlayerAchievement }) {
  const current = Math.max(0, achievement.current);
  const goal = Math.max(0, achievement.goal);
  const progress = goal > 0 ? Math.min(current, goal) : 0;
  const percent = goal > 0 ? Math.min(100, Math.round((progress / goal) * 100)) : 0;
  const status = achievement.unlocked
    ? t("achievement.unlocked")
    : current >= goal && goal > 0
      ? t("achievement.processing")
      : t("achievement.inProgress");
  const name = translateSource(achievement.name);

  return (
    <li className={`achievement-card${achievement.unlocked ? " achievement-card-unlocked" : ""}`}>
      <div className="achievement-card-heading">
        <div>
          <p className="achievement-state">{status}</p>
          <h4>{name}</h4>
        </div>
        <strong className="achievement-xp">+{formatNumber(achievement.xp_reward)} XP</strong>
      </div>
      <p>{translateSource(achievement.description)}</p>
      <div
        className="achievement-progress"
        role="progressbar"
        aria-label={t("achievement.progressLabel", { name })}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={progress}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="achievement-count">
        <strong>{progressLabel(current)}</strong> / {progressLabel(goal)}
      </p>
      {achievement.bonus_reward && (
        <p className="achievement-bonus">{t("achievement.bonus", { reward: translateSource(achievement.bonus_reward) })}</p>
      )}
    </li>
  );
}

function UnavailableAchievement({ achievement }: { achievement: PlayerAchievement }) {
  return (
    <li className="achievement-card achievement-card-unavailable">
      <div className="achievement-card-heading">
        <div>
          <p className="achievement-state">{t("achievement.unavailable")}</p>
          <h4>{translateSource(achievement.name)}</h4>
        </div>
        <strong className="achievement-xp">+{formatNumber(achievement.xp_reward)} XP</strong>
      </div>
      <p>{translateSource(achievement.description)}</p>
      <p className="achievement-goal">{t("achievement.goal", { goal: progressLabel(achievement.goal) })}</p>
      {achievement.bonus_reward && (
        <p className="achievement-bonus">{t("achievement.bonus", { reward: translateSource(achievement.bonus_reward) })}</p>
      )}
      <p className="achievement-unavailable-reason">
        {achievement.unavailable_reason
          ? translateSource(achievement.unavailable_reason)
          : t("achievement.defaultUnavailable")}
      </p>
    </li>
  );
}

export function AchievementScreen({
  achievements,
  onClose,
}: {
  achievements: PlayerAchievement[];
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "unlocked" | "progress" | "locked">("all");
  const alphaCodes = new Set(["alpha-player", "max-alpha-player"]);
  const alphaAchievements = achievements.filter((achievement) => alphaCodes.has(achievement.code));
  const releaseAchievements = achievements.filter((achievement) => !alphaCodes.has(achievement.code));
  const allAvailable = achievements.filter((achievement) => achievement.eligible);
  const available = releaseAchievements.filter((achievement) => achievement.eligible);
  const unavailable = releaseAchievements.filter((achievement) => !achievement.eligible);
  const unlocked = achievements.filter((achievement) => achievement.eligible && achievement.unlocked).length;
  const filteredAvailable = available.filter((achievement) => {
    if (filter === "unlocked") return achievement.unlocked;
    if (filter === "progress") return !achievement.unlocked;
    return filter !== "locked";
  });
  const showUnavailable = filter === "all" || filter === "locked";

  return (
    <section className="achievement-screen" aria-labelledby="achievement-title">
      <header className="achievement-header">
        <div>
          <p className="status-label">{t("progression.label")}</p>
          <h2 id="achievement-title">{t("progression.achievements")}</h2>
          <p>{t("achievement.description")}</p>
        </div>
        <button type="button" className="secondary-action" onClick={onClose}>
          {t("achievement.back")}
        </button>
      </header>

      <div className="achievement-summary" aria-label={t("achievement.summaryLabel")}>
        <p><strong>{unlocked}</strong><span>{t("achievement.unlocked")}</span></p>
        <p><strong>{allAvailable.length}</strong><span>{t("achievement.available")}</span></p>
        <p><strong>{achievements.length}</strong><span>{t("achievement.launchGoals")}</span></p>
      </div>

      <p className="achievement-note">{t("achievement.note")}</p>

      <section className="achievement-section achievement-alpha" aria-labelledby="alpha-achievements-title">
        <div className="achievement-section-heading">
          <div>
            <p className="status-label">{t("achievement.alphaRecognition")}</p>
            <h3 id="alpha-achievements-title">{t("achievement.alphaMilestones")}</h3>
            <p>{t("achievement.alphaRetention")}</p>
          </div>
          <span>{t("achievement.milestonesCount", { count: alphaAchievements.length })}</span>
        </div>
        <ol className="achievement-grid">
          {alphaAchievements.map((achievement) =>
            achievement.eligible ? (
              <AvailableAchievement key={achievement.code} achievement={achievement} />
            ) : (
              <UnavailableAchievement key={achievement.code} achievement={achievement} />
            ),
          )}
        </ol>
      </section>

      <p className="achievement-reset-note">{t("achievement.resetNote")}</p>

      <div className="achievement-filters" role="group" aria-label={t("achievement.filterLabel")}>
        {([
          ["all", "achievement.filterAll"],
          ["unlocked", "achievement.unlocked"],
          ["progress", "achievement.inProgressTitle"],
          ["locked", "achievement.lockedTitle"],
        ] as const).map(([value, labelKey]) => (
          <button
            key={value}
            type="button"
            className={filter === value ? "is-active" : ""}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {filter !== "locked" && <section className="achievement-section" aria-labelledby="available-achievements-title">
        <div className="achievement-section-heading">
          <h3 id="available-achievements-title">
            {filter === "unlocked"
              ? t("achievement.unlocked")
              : filter === "progress"
                ? t("achievement.inProgressTitle")
                : t("achievement.availableNow")}
          </h3>
          <span>{t("achievement.goalsCount", { count: filteredAvailable.length })}</span>
        </div>
        {filteredAvailable.length === 0 ? (
          <p className="progression-empty" role="status">
            {t("achievement.noFilterMatches")}
          </p>
        ) : (
          <ol className="achievement-grid">
            {filteredAvailable.map((achievement) => (
              <AvailableAchievement key={achievement.code} achievement={achievement} />
            ))}
          </ol>
        )}
      </section>}

      {showUnavailable && unavailable.length > 0 && (
        <section
          className="achievement-section achievement-section-unavailable"
          aria-labelledby="unavailable-achievements-title"
        >
          <div className="achievement-section-heading">
            <div>
              <h3 id="unavailable-achievements-title">{t("achievement.comingLater")}</h3>
              <p>{t("achievement.fullSetNote")}</p>
            </div>
            <span>{t("achievement.goalsCount", { count: unavailable.length })}</span>
          </div>
          <ol className="achievement-grid">
            {unavailable.map((achievement) => (
              <UnavailableAchievement key={achievement.code} achievement={achievement} />
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
