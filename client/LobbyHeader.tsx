import type { JadeAccount, PlayerProgression } from "../protocol/envelope";
import { PlayerProfileBadge, PlayerProfileEditor } from "./PlayerProfile";
import { defaultPlayerProfile, type PlayerProfileConfig } from "./player-profile";
import { RULES_NAME, RULES_VERSION } from "./rules-version";

export interface LobbyHeaderProps {
  guest: boolean;
  account?: JadeAccount;
  jadeStatus: "idle" | "loading" | "ready" | "error";
  connection: "connecting" | "connected" | "reconnecting";
  progression?: PlayerProgression;
  progressionStatus?: "idle" | "loading" | "ready" | "error";
  profile?: PlayerProfileConfig;
  onProfileChange?: (profile: PlayerProfileConfig) => void;
  onOpenProgress?: () => void;
  onOpenStatistics?: () => void;
}

// The first thing a player sees when signed in. It answers "who am I, what can
// I spend, how far have I progressed, and which rules am I about to play."
// The server owns every number; the header never derives a level from XP.
export function LobbyHeader({
  guest,
  account,
  jadeStatus,
  connection,
  progression,
  progressionStatus = "idle",
  profile = defaultPlayerProfile(guest),
  onProfileChange = () => undefined,
  onOpenProgress = () => undefined,
  onOpenStatistics,
}: LobbyHeaderProps) {
  const level = progression?.level ?? 1;
  const xpIntoLevel = progression?.xp_into_level ?? 0;
  const xpForNextLevel = progression?.xp_for_next_level ?? 0;
  const levelPercent =
    xpForNextLevel > 0
      ? Math.min(100, Math.round((xpIntoLevel / xpForNextLevel) * 100))
      : 0;

  return (
    <header className="lobby-header">
      <div className="lobby-profile-wallet">
        <PlayerProfileBadge profile={profile} className="lobby-player-profile" />
        <div className="lobby-wallet" aria-label="Virtual currency balances">
          <span className="currency-balance currency-jade">
            <span className="currency-icon" aria-hidden="true">◆</span>
            <strong>
              {jadeStatus === "ready" && account
                ? account.available.toLocaleString()
                : jadeStatus === "loading"
                  ? "…"
                  : "Unavailable"}
            </strong>
            <span className="sr-only">Jade</span>
          </span>
          <span className="currency-balance currency-tael">
            <span className="currency-icon" aria-hidden="true">◉</span>
            <strong>0</strong>
            <span className="sr-only">Tael</span>
          </span>
        </div>
        {guest && (
          <span className="lobby-identity-note">
            Progress is tied to this device until you create an account.
          </span>
        )}
        {account && account.reserved > 0 ? (
          <span className="lobby-identity-note">
            {account.reserved.toLocaleString()} Jade reserved for your current table.
          </span>
        ) : null}
        <details className="profile-editor-disclosure">
          <summary>Edit profile</summary>
          <PlayerProfileEditor
            profile={profile}
            guest={guest}
            onChange={onProfileChange}
          />
        </details>
      </div>

      <dl className="lobby-facts">
        <div className="lobby-fact">
          <dt>Rules</dt>
          <dd>
            <strong>{RULES_NAME}</strong>
            <span className="lobby-fact-note">{RULES_VERSION}</span>
          </dd>
        </div>
        {onOpenStatistics ? (
          <div className="lobby-fact lobby-statistics-fact">
            <dt>Statistics</dt>
            <dd>
              <button
                type="button"
                className="lobby-progress-trigger"
                onClick={onOpenStatistics}
                aria-label="Open your Quick Play statistics"
              >
                <strong>Your record</strong>
                <span className="lobby-fact-note">Win rate, deal-in, Ting</span>
              </button>
            </dd>
          </div>
        ) : null}
        <div className="lobby-fact lobby-progress-fact">
          <dt>Progress</dt>
          <dd>
            <button
              type="button"
              className="lobby-progress-trigger"
              onClick={onOpenProgress}
              aria-label={
                progressionStatus === "ready"
                  ? `Open progression, level ${level}`
                  : "Open progression"
              }
            >
              <strong>
                {progressionStatus === "ready"
                  ? `Level ${level}`
                  : progressionStatus === "loading"
                    ? "Loading…"
                    : "Unavailable"}
              </strong>
              {progressionStatus === "ready" && (
                <span className="lobby-fact-note">
                  {progression?.at_cap
                    ? "Maximum level"
                    : `${xpIntoLevel.toLocaleString()} / ${xpForNextLevel.toLocaleString()} XP`}
                </span>
              )}
              {progressionStatus === "ready" && !progression?.at_cap && (
                <span
                  className="lobby-progress-bar"
                  role="progressbar"
                  aria-label={`Level ${level} progress`}
                  aria-valuemin={0}
                  aria-valuemax={xpForNextLevel}
                  aria-valuenow={xpIntoLevel}
                >
                  <span style={{ width: `${levelPercent}%` }} />
                </span>
              )}
            </button>
          </dd>
        </div>
      </dl>

      {/* Connection state earns a line only when it is not fine. A permanent
          "Lobby connected" badge is status for its own sake. */}
      {connection !== "connected" && (
        <p className="lobby-connection" role="status" aria-live="polite">
          {connection === "connecting"
            ? "Connecting…"
            : "Connection lost. Reconnecting…"}
        </p>
      )}

    </header>
  );
}
