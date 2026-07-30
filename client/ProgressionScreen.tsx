import type {
  LevelStep,
  PlayerAchievement,
  PlayerProgression,
} from "../protocol/envelope";

// §12.2 progression screen: the whole curve, what has been earned, and what is
// next. The curve comes from the server rather than a local copy, so the
// client cannot quote a reward table the server has since changed.

const KIND_LABELS: Record<string, string> = {
  title: "Title",
  table_theme: "Table theme",
  tile_skin: "Tile skin",
  avatar_frame: "Avatar frame",
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
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
          <p className="status-label">Progression</p>
          <h2 id="progression-title">Level {level}</h2>
          <p className="progression-lifetime">
            {lifetime.toLocaleString()} XP earned
            {atCap ? " · maximum level" : ` · ${into.toLocaleString()} / ${needed.toLocaleString()} to level ${level + 1}`}
          </p>
        </div>
        <button type="button" className="secondary-action" onClick={onClose}>
          Back
        </button>
      </header>

      <p className="progression-note">
        XP comes from playing hands. It never changes matchmaking or which
        tables you can enter — every mode is open from the start.
      </p>

      {onOpenAchievements && (
        <button
          type="button"
          className="achievement-entry"
          onClick={onOpenAchievements}
        >
          <span>
            <small>Goals and rewards</small>
            <strong>Achievements</strong>
          </span>
          <span>View all 32 <span aria-hidden="true">→</span></span>
        </button>
      )}

      {!atCap && (
        <div
          className="progression-hero-bar"
          role="progressbar"
          aria-label={`Level ${level} progress`}
          aria-valuemin={0}
          aria-valuemax={needed}
          aria-valuenow={into}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      )}

      {onboardingOutcome && (
        <p className="progression-onboarding">
          Tutorial:{" "}
          <strong>
            {onboardingOutcome === "ONBOARDING_OUTCOME_COMPLETED"
              ? "Completed"
              : "Skipped — replay it any time"}
          </strong>
        </p>
      )}

      <section className="progression-earned" aria-labelledby="progression-earned-title">
        <h3 id="progression-earned-title">Earned rewards</h3>
        {earned.length === 0 ? (
          <p>Your first cosmetic reward arrives at level 2.</p>
        ) : (
          <ul>
            {earned.map((reward) => (
              <li key={reward.code ?? `${reward.level}-${reward.kind}-${reward.name}`}>
                <strong>{reward.name}</strong>
                <span>{kindLabel(reward.kind)} · Level {reward.level}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="progression-curve-heading">
        <h3>Level curve</h3>
        <span>Lifetime XP required</span>
      </div>

      {curve.length === 0 ? (
        <p className="progression-empty" role="status">
          The reward curve is unavailable right now.
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
                <span className="progression-step-level">Level {step.level}</span>
                <span className="progression-step-xp">
                  {(step.total_xp_required ?? 0).toLocaleString()} XP
                </span>
                {/* Most levels grant nothing. Saying so is more honest than
                    hiding them and implying every level carries a reward. */}
                {rewards.length === 0 ? (
                  <span className="progression-step-rewards progression-step-none">—</span>
                ) : (
                  <span className="progression-step-rewards">
                    {rewards.map((reward) => (
                      <span key={reward.code ?? reward.name} className="progression-reward">
                        <span className="progression-reward-name">{reward.name}</span>
                        <span className="progression-reward-kind">{kindLabel(reward.kind)}</span>
                      </span>
                    ))}
                  </span>
                )}
                {/* Reached state is text, never colour alone. */}
                <span className="progression-step-state">
                  {step.level === level ? "Current" : reached ? "Reached" : "Locked"}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <p className="progression-accessibility">
        High Contrast tiles are accessibility content, not a reward — they are
        available from level 1.
      </p>
    </section>
  );
}

function progressLabel(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function AvailableAchievement({ achievement }: { achievement: PlayerAchievement }) {
  const current = Math.max(0, achievement.current);
  const goal = Math.max(0, achievement.goal);
  const progress = goal > 0 ? Math.min(current, goal) : 0;
  const percent = goal > 0 ? Math.min(100, Math.round((progress / goal) * 100)) : 0;
  const status = achievement.unlocked
    ? "Unlocked"
    : current >= goal && goal > 0
      ? "Unlock processing"
      : "In progress";

  return (
    <li className={`achievement-card${achievement.unlocked ? " achievement-card-unlocked" : ""}`}>
      <div className="achievement-card-heading">
        <div>
          <p className="achievement-state">{status}</p>
          <h4>{achievement.name}</h4>
        </div>
        <strong className="achievement-xp">+{achievement.xp_reward.toLocaleString()} XP</strong>
      </div>
      <p>{achievement.description}</p>
      <div
        className="achievement-progress"
        role="progressbar"
        aria-label={`${achievement.name} progress`}
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
        <p className="achievement-bonus">Bonus: {achievement.bonus_reward}</p>
      )}
    </li>
  );
}

function UnavailableAchievement({ achievement }: { achievement: PlayerAchievement }) {
  return (
    <li className="achievement-card achievement-card-unavailable">
      <div className="achievement-card-heading">
        <div>
          <p className="achievement-state">Unavailable</p>
          <h4>{achievement.name}</h4>
        </div>
        <strong className="achievement-xp">+{achievement.xp_reward.toLocaleString()} XP</strong>
      </div>
      <p>{achievement.description}</p>
      <p className="achievement-goal">Goal: {progressLabel(achievement.goal)}</p>
      {achievement.bonus_reward && (
        <p className="achievement-bonus">Bonus: {achievement.bonus_reward}</p>
      )}
      <p className="achievement-unavailable-reason">
        {achievement.unavailable_reason ?? "This achievement is not available yet."}
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
  const available = achievements.filter((achievement) => achievement.eligible);
  const unavailable = achievements.filter((achievement) => !achievement.eligible);
  const unlocked = available.filter((achievement) => achievement.unlocked).length;

  return (
    <section className="achievement-screen" aria-labelledby="achievement-title">
      <header className="achievement-header">
        <div>
          <p className="status-label">Progression</p>
          <h2 id="achievement-title">Achievements</h2>
          <p>Public-table goals, tracked by your account.</p>
        </div>
        <button type="button" className="secondary-action" onClick={onClose}>
          Back to Progress
        </button>
      </header>

      <div className="achievement-summary" aria-label="Achievement summary">
        <p><strong>{unlocked}</strong><span>Unlocked</span></p>
        <p><strong>{available.length}</strong><span>Available</span></p>
        <p><strong>{achievements.length}</strong><span>Launch goals</span></p>
      </div>

      <p className="achievement-note">
        Only completed public human hands advance achievements. Practice does not.
      </p>

      <section className="achievement-section" aria-labelledby="available-achievements-title">
        <div className="achievement-section-heading">
          <h3 id="available-achievements-title">Available now</h3>
          <span>{available.length} goals</span>
        </div>
        {available.length === 0 ? (
          <p className="progression-empty" role="status">
            Achievement progress is unavailable right now.
          </p>
        ) : (
          <ol className="achievement-grid">
            {available.map((achievement) => (
              <AvailableAchievement key={achievement.code} achievement={achievement} />
            ))}
          </ol>
        )}
      </section>

      {unavailable.length > 0 && (
        <section
          className="achievement-section achievement-section-unavailable"
          aria-labelledby="unavailable-achievements-title"
        >
          <div className="achievement-section-heading">
            <div>
              <h3 id="unavailable-achievements-title">Coming later</h3>
              <p>Visible now so the full launch set stays clear.</p>
            </div>
            <span>{unavailable.length} goals</span>
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
