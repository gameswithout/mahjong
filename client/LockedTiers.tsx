import { lockedTiers, tierName, tierSummary } from "./lobby-tiers";
import { t } from "./i18n";

// A compact preview of the planned table ladder. These are roadmap context,
// not disabled choices in the current build.
export function LockedTiers() {
  return (
    <section className="locked-tiers" aria-labelledby="locked-tiers-title">
      <p className="status-label">{t("locked.comingSoon")}</p>
      <h2 id="locked-tiers-title">{t("locked.title")}</h2>
      <p className="locked-tier-intro">{t("locked.description")}</p>
      <ul className="locked-tier-list">
        {lockedTiers().map((tier) => (
          <li className="locked-tier" key={tier.id}>
            <div className="locked-tier-heading">
              <span className="locked-tier-name">{tierName(tier)}</span>
            </div>
            <p className="locked-tier-summary">{tierSummary(tier)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
