import { RULES_NAME, RULES_VERSION } from "./rules-version";
import type { PlayerSettings } from "./settings";

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
          <p className="status-label">Account</p>
          <h2 id="settings-title">Settings</h2>
          <p>
            Preferences are saved to your Mahjong account and follow registered
            players to other devices.
          </p>
        </div>
        <button type="button" className="secondary-action" onClick={onClose}>
          Back to lobby
        </button>
      </header>

      <div className="settings-list">
        <section className="settings-card" aria-labelledby="settings-learning-title">
          <p className="status-label">Learning</p>
          <h3 id="settings-learning-title">Tutorial</h3>
          <label className="settings-toggle">
            <span>
              <strong>Show Learn section</strong>
              <small>
                Hide the tutorial card from the lobby. You can always turn it back on here.
              </small>
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
          <p className="status-label">Privacy</p>
          <h3 id="settings-privacy-title">Analytics</h3>
          <label className="settings-toggle">
            <span>
              <strong>Share optional gameplay analytics</strong>
              <small>
                Helps improve tutorial and queue journeys. Email, birth date, chat, and
                concealed tiles are never included.
              </small>
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
          <p className="status-label">Rules</p>
          <h3 id="settings-rules-title">{RULES_NAME}</h3>
          <p className="settings-rule-version">{RULES_VERSION}</p>
        </section>
      </div>

      <div className="settings-sync-status" role="status" aria-live="polite">
        {syncStatus === "loading" && "Loading account settings…"}
        {syncStatus === "saving" && "Saving to your account…"}
        {syncStatus === "ready" && "Settings saved to your account."}
        {syncStatus === "error" && (
          <>
            Settings could not sync with AccelByte Cloud Save.
            <button type="button" className="text-action" onClick={onRetry}>
              Retry
            </button>
          </>
        )}
      </div>
    </section>
  );
}
