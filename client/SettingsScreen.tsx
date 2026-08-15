import { RULES_NAME, RULES_VERSION } from "./rules-version";
import type { PlayerSettings } from "./settings";
import { t } from "./i18n";

export interface SettingsScreenProps {
  settings: PlayerSettings;
  syncStatus: "loading" | "ready" | "saving" | "error";
  onSettingsChange(settings: PlayerSettings): void;
  onClose(): void;
  onRetry(): void;
}

export function SettingsScreen({
  settings,
  syncStatus,
  onSettingsChange,
  onClose,
  onRetry,
}: SettingsScreenProps) {
  return (
    <section className="settings-screen" aria-labelledby="settings-title">
      <header className="settings-header">
        <div>
          <p className="status-label">{t("settings.account")}</p>
          <h2 id="settings-title">{t("settings.title")}</h2>
          <p>{t("settings.description")}</p>
        </div>
        <button type="button" className="secondary-action" onClick={onClose}>
          {t("common.backToLobby")}
        </button>
      </header>

      <div className="settings-list">
        <section className="settings-card" aria-labelledby="settings-learning-title">
          <p className="status-label">{t("settings.learning")}</p>
          <h3 id="settings-learning-title">{t("settings.tutorial")}</h3>
          <label className="settings-toggle">
            <span>
              <strong>{t("settings.showLearn")}</strong>
              <small>{t("settings.showLearnHelp")}</small>
            </span>
            <input
              type="checkbox"
              checked={settings.showTutorial}
              disabled={syncStatus === "loading"}
              onChange={(event) =>
                onSettingsChange({ ...settings, showTutorial: event.target.checked })
              }
            />
          </label>
        </section>

        <section className="settings-card" aria-labelledby="settings-privacy-title">
          <p className="status-label">{t("settings.privacy")}</p>
          <h3 id="settings-privacy-title">{t("settings.analytics")}</h3>
          <label className="settings-toggle">
            <span>
              <strong>{t("settings.shareAnalytics")}</strong>
              <small>{t("settings.shareAnalyticsHelp")}</small>
            </span>
            <input
              type="checkbox"
              checked={settings.optionalAnalyticsConsent}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  optionalAnalyticsConsent: event.target.checked,
                })
              }
            />
          </label>
        </section>

        <section className="settings-card" aria-labelledby="settings-rules-title">
          <p className="status-label">{t("settings.rules")}</p>
          <h3 id="settings-rules-title">{RULES_NAME}</h3>
          <p className="settings-rule-version">{RULES_VERSION}</p>
        </section>
      </div>

      <div className="settings-sync-status" role="status" aria-live="polite">
        {syncStatus === "loading" && t("settings.loading")}
        {syncStatus === "saving" && t("settings.saving")}
        {syncStatus === "ready" && t("settings.saved")}
        {syncStatus === "error" && (
          <>
            {t("settings.syncError")}
            <button type="button" className="text-action" onClick={onRetry}>
              {t("common.retry")}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
