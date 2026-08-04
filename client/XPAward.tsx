import type { HandXPAward, PlayerProgression } from "../protocol/envelope";

// §12.1/§12.2 post-match progress: what this hand earned, where it left the
// player on the curve, and what the next level is actually worth.
//
// Deliberately compact and visually secondary to the scoring and settlement
// chapters above it (P0.3 kept the result's first scan for the explanation).
// It is one row, not a chapter.

function rewardLabel(kind: string): string {
  switch (kind) {
    case "title":
      return "title";
    case "table_theme":
      return "table theme";
    case "tile_skin":
      return "tile skin";
    case "avatar_frame":
      return "avatar frame";
    default:
      return kind.replace(/_/g, " ");
  }
}

export function XPAward({
  award,
  progression,
}: {
  award?: HandXPAward;
  progression?: PlayerProgression;
}) {
  // Nothing to say without a server award. The client never invents XP.
  if (!award || !progression) {
    return null;
  }

  const total = award.total ?? 0;
  const level = progression.level ?? 1;
  const atCap = progression.at_cap === true;
  const into = progression.xp_into_level ?? 0;
  const needed = progression.xp_for_next_level ?? 0;
  // Guard the denominator rather than trusting it: a zero would otherwise
  // render an Infinity-wide bar.
  const percent = needed > 0 ? Math.min(100, Math.round((into / needed) * 100)) : 0;

  return (
    <section className="xp-award" aria-labelledby="xp-award-title">
      <div className="xp-award-header">
        <h3 id="xp-award-title" className="status-label">
          Progress
        </h3>
        <p className="xp-award-total">
          {total > 0 ? `+${total.toLocaleString()} XP` : "No XP from this hand"}
        </p>
      </div>

      {award.components && award.components.length > 0 && (
        <ul className="xp-award-components">
          {award.components.map((component) => (
            <li key={component.code ?? component.label}>
              <span>{component.label}</span>
              <strong>+{component.amount.toLocaleString()}</strong>
            </li>
          ))}
        </ul>
      )}

      {award.capped_by_daily && (
        <p className="xp-award-capped">
          Solo Practice is progression-neutral. Levels and achievements are earned
          through Online Play.
        </p>
      )}

      <div className="xp-award-level">
        <p className="xp-award-level-line">
          <strong>Level {level}</strong>
          {atCap ? (
            <span>Maximum level reached</span>
          ) : (
            <span>
              {into.toLocaleString()} / {needed.toLocaleString()} XP to level {level + 1}
            </span>
          )}
        </p>

        {!atCap && (
          <div
            className="xp-award-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={needed}
            aria-valuenow={into}
            aria-label={`Level ${level} progress`}
          >
            <span className="xp-award-bar-fill" style={{ width: `${percent}%` }} />
          </div>
        )}

        {/* Naming the next reward is the point: "12% to level 8" means
            nothing on its own, but "the Jade tile skin at level 10" does. */}
        {progression.next && (
          <p className="xp-award-next">
            Next reward: {progression.next.name} {rewardLabel(progression.next.kind)} at level{" "}
            {progression.next.level}
          </p>
        )}
      </div>
    </section>
  );
}
