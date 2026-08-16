// The optional-analytics ask, moved out of Settings and onto the lobby.
//
// Why it exists: consent for the behavioural events lived only behind a
// Settings checkbox, and over the beta's first three weeks the namespace
// recorded 1,466 essential events against 6 optional ones. That is not a
// signal about what players want — it is a signal that nobody was ever asked.
//
// It is a genuine ask, not a nudge. Both answers are one click, neither is
// preselected or visually favoured, declining is not made to look like a
// mistake, and the card is shown once and then never again whichever way it
// is answered. The default without an answer stays "no".
import { t } from "./i18n";

export interface AnalyticsConsentCardProps {
  onAnswer(enabled: boolean): void;
}

export function AnalyticsConsentCard({ onAnswer }: AnalyticsConsentCardProps) {
  return (
    <section className="analytics-consent-card" aria-labelledby="analytics-consent-title">
      <p className="status-label">{t("settings.privacy")}</p>
      <h3 id="analytics-consent-title">{t("consent.title")}</h3>
      <p className="analytics-consent-body">{t("consent.body")}</p>
      <p className="analytics-consent-detail">{t("consent.detail")}</p>
      <div className="analytics-consent-actions">
        <button
          type="button"
          className="secondary-action"
          onClick={() => onAnswer(true)}
        >
          {t("consent.accept")}
        </button>
        <button
          type="button"
          className="secondary-action"
          onClick={() => onAnswer(false)}
        >
          {t("consent.decline")}
        </button>
      </div>
      <p className="analytics-consent-detail">{t("consent.change")}</p>
    </section>
  );
}
