import type { LevelStep, PlayerProgression } from "../protocol/envelope";

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
}: {
  progression: PlayerProgression;
  curve: LevelStep[];
  onClose: () => void;
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
