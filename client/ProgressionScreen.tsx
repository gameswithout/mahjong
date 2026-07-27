import type { LevelReward, PlayerProgression } from "../protocol/envelope";

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
  curve: LevelReward[];
  onClose: () => void;
}) {
  const level = progression.level ?? 1;
  const atCap = progression.at_cap === true;
  const into = progression.xp_into_level ?? 0;
  const needed = progression.xp_for_next_level ?? 0;
  const lifetime = progression.lifetime_xp ?? 0;

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

      {curve.length === 0 ? (
        <p className="progression-empty" role="status">
          The reward curve is unavailable right now.
        </p>
      ) : (
        <ol className="progression-curve">
          {curve.map((reward) => {
            const earned = reward.level <= level;
            return (
              <li
                key={`${reward.level}-${reward.kind}-${reward.name}`}
                className={`progression-reward${earned ? " progression-reward-earned" : ""}`}
              >
                <span className="progression-reward-level">Level {reward.level}</span>
                <span className="progression-reward-name">{reward.name}</span>
                <span className="progression-reward-kind">{kindLabel(reward.kind)}</span>
                {/* Earned state is text, never colour alone. */}
                <span className="progression-reward-state">
                  {earned ? "Earned" : "Locked"}
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
