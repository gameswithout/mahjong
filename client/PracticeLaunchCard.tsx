import { BotPersonaPicker, type BotPersonaPickerState } from "./BotPersonaPicker";
import { t } from "./i18n";

export interface PracticeLaunchCardProps {
  busy: boolean;
  hasSelectedSession: boolean;
  cleanupRequired?: boolean;
  matchServiceAvailable: boolean;
  onStart: () => void;
  onLeaveSelectedSession?: () => void;
  // Optional: a caller that hasn't wired the picker (an older test fixture,
  // or a build without it configured) still gets a plain launch button —
  // choosing opponents is additive, not a new requirement to start Practice.
  personaPicker?: BotPersonaPickerState;
}

export function PracticeLaunchCard({
  busy,
  hasSelectedSession,
  cleanupRequired = false,
  matchServiceAvailable,
  onStart,
  onLeaveSelectedSession,
  personaPicker,
}: PracticeLaunchCardProps) {
  return (
    <section className="practice-card" aria-labelledby="practice-title">
      <p className="status-label">{t("practice.eyebrow")}</p>
      <h2 id="practice-title">{t("practice.title")}</h2>
      <p className="practice-description">{t("practice.description")}</p>
      {personaPicker && <BotPersonaPicker state={personaPicker} />}
      <div className="practice-actions">
        <button
          className="primary-action practice-action"
          type="button"
          onClick={onStart}
          disabled={busy || hasSelectedSession || !matchServiceAvailable}
        >
          {t("practice.action")}
        </button>
      </div>
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
