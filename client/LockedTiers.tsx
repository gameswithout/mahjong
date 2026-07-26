import { lockedTiers, tierSummary } from "./lobby-tiers";

// The tiers above the one a player can enter. Shown, not hidden: the ladder is
// the shape of the economy, and a first session that only ever mentions Bamboo
// makes the game look smaller than it is. Each card says why it is closed, so
// none of them reads as a broken button.
export function LockedTiers() {
  return (
    <section className="locked-tiers" aria-labelledby="locked-tiers-title">
      <h2 id="locked-tiers-title" className="status-label">
        Higher tables
      </h2>
      <ul className="locked-tier-list">
        {lockedTiers().map((tier) => (
          <li className="locked-tier" key={tier.id}>
            <div className="locked-tier-heading">
              <span className="locked-tier-name">{tier.name}</span>
              {/* "Locked" as text, not as a padlock glyph alone: the state has
                  to survive a screen reader and a monochrome display. */}
              <span className="locked-tier-state">Locked</span>
            </div>
            <p className="locked-tier-summary">{tierSummary(tier)}</p>
            <p className="locked-tier-reason">{tier.lockedReason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
