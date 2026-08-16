import { RULES_NAME, RULES_VERSION } from "./rules-version";
import type { PlayerSettings } from "./settings";
import { t } from "./i18n";
import { LanguageSelector } from "./i18n/LanguageSelector";

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
        <section className="settings-card" aria-labelledby="settings-language-title">
          <p className="status-label">{t("language.label")}</p>
          <h3 id="settings-language-title">{t("settings.displayLanguage")}</h3>
          <p className="settings-language-help">{t("settings.languageHelp")}</p>
          <LanguageSelector inline />
        </section>

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

        <section className="settings-card" aria-labelledby="settings-table-title">
          <p className="status-label">{t("settings.gameplay")}</p>
          <h3 id="settings-table-title">{t("settings.tablePreferences")}</h3>
          <label className="settings-toggle">
            <span>
              <strong>{t("settings.expertHud")}</strong>
              <small>{t("settings.expertHudHelp")}</small>
            </span>
            <input
              type="checkbox"
              checked={settings.expertHud}
              onChange={(event) =>
                onSettingsChange({ ...settings, expertHud: event.target.checked })
              }
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>{t("settings.autoPass")}</strong>
              <small>{t("settings.autoPassHelp")}</small>
            </span>
            <input
              type="checkbox"
              checked={settings.autoPassClaims}
              onChange={(event) =>
                onSettingsChange({ ...settings, autoPassClaims: event.target.checked })
              }
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>{t("settings.compactClaims")}</strong>
              <small>{t("settings.compactClaimsHelp")}</small>
            </span>
            <input
              type="checkbox"
              checked={settings.compactClaimPrompts}
              onChange={(event) =>
                onSettingsChange({ ...settings, compactClaimPrompts: event.target.checked })
              }
            />
          </label>
          <label className="settings-select-label" htmlFor="practice-bot-speed">
            <span>
              <strong>{t("settings.botSpeed")}</strong>
              <small>{t("settings.botSpeedHelp")}</small>
            </span>
            <select
              id="practice-bot-speed"
              value={settings.practiceBotSpeed}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  practiceBotSpeed:
                    event.target.value === "fast" || event.target.value === "normal"
                      ? event.target.value
                      : "learning",
                })
              }
            >
              <option value="learning">{t("settings.botSpeedLearning")}</option>
              <option value="normal">{t("settings.botSpeedNormal")}</option>
              <option value="fast">{t("settings.botSpeedFast")}</option>
            </select>
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
