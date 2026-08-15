import { t } from "./i18n";

export interface PracticeLaunchCardProps {
  busy: boolean;
  hasSelectedSession: boolean;
  cleanupRequired?: boolean;
  matchServiceAvailable: boolean;
  onStart: () => void;
  onLeaveSelectedSession?: () => void;
}

export function PracticeLaunchCard({
  busy,
  hasSelectedSession,
  cleanupRequired = false,
  matchServiceAvailable,
  onStart,
  onLeaveSelectedSession,
}: PracticeLaunchCardProps) {
  return (
    <section className="practice-card" aria-labelledby="practice-title">
      <p className="status-label">{t("practice.eyebrow")}</p>
      <h2 id="practice-title">{t("practice.title")}</h2>
      <p className="practice-description">{t("practice.description")}</p>
      <button
        className="primary-action practice-action"
        type="button"
        onClick={onStart}
        disabled={busy || hasSelectedSession || !matchServiceAvailable}
      >
        {t("practice.action")}
      </button>
      {!matchServiceAvailable && (
        <p className="practice-unavailable" role="alert">
          {t("practice.unconfigured")}
        </p>
      )}
      {hasSelectedSession && (
        <div className="practice-existing-session" role={cleanupRequired ? "alert" : undefined}>
          <p className="practice-unavailable">
            {cleanupRequired
              ? t("practice.leaveFailed")
              : t("practice.tableActive")}
          </p>
          {onLeaveSelectedSession && (
            <button
              className="secondary-action practice-leave-action"
              type="button"
              onClick={onLeaveSelectedSession}
            >
              {cleanupRequired ? t("practice.retryLeave") : t("practice.leaveCurrent")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
