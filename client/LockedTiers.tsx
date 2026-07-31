import { lockedTiers, tierSummary } from "./lobby-tiers";

// A compact preview of the planned table ladder. These are roadmap context,
// not disabled choices in the current build.
export function LockedTiers() {
  return (
    <section className="locked-tiers" aria-labelledby="locked-tiers-title">
      <p className="status-label">Coming soon</p>
      <h2 id="locked-tiers-title">
        Higher stakes, rewarding progression, and more personalization features to be introduced
        in the future.
      </h2>
      <p className="locked-tier-intro">
        Preview the higher-stakes tables planned for future releases.
      </p>
      <ul className="locked-tier-list">
        {lockedTiers().map((tier) => (
          <li className="locked-tier" key={tier.id}>
            <div className="locked-tier-heading">
              <span className="locked-tier-name">{tier.name}</span>
            </div>
            <p className="locked-tier-summary">{tierSummary(tier)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
