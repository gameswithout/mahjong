import type { JadeAccount, PlayerProgression } from "../protocol/envelope";
import { PlayerProfileBadge, PlayerProfileEditor } from "./PlayerProfile";
import { defaultPlayerProfile, type PlayerProfileConfig } from "./player-profile";
import type { PlayerStatSummary } from "./player-stats";

export interface LobbyHeaderProps {
  guest: boolean;
  account?: JadeAccount;
  jadeStatus: "idle" | "loading" | "ready" | "error";
  connection: "connecting" | "connected" | "reconnecting";
  progression?: PlayerProgression;
  progressionStatus?: "idle" | "loading" | "ready" | "error";
  statistics?: PlayerStatSummary;
  profile?: PlayerProfileConfig;
  onProfileChange?: (profile: PlayerProfileConfig) => void;
  onOpenProgress?: () => void;
  onOpenStatistics?: () => void;
  onOpenStore?: () => void;
  onCreateAccount?: () => void;
}

// The first thing a player sees when signed in. It answers "who am I, what can
// I spend and how far have I progressed. Rules live in Settings so the header
// stays compact on narrow screens.
// The server owns every number; the header never derives a level from XP.
export function LobbyHeader({
  guest,
  account,
  jadeStatus,
  connection,
  progression,
  progressionStatus = "idle",
  statistics,
  profile = defaultPlayerProfile(guest),
  onProfileChange = () => undefined,
  onOpenProgress = () => undefined,
  onOpenStatistics,
  onOpenStore = () => undefined,
  onCreateAccount = () => undefined,
}: LobbyHeaderProps) {
  const level = progression?.level ?? 1;
  const xpIntoLevel = progression?.xp_into_level ?? 0;
  const xpForNextLevel = progression?.xp_for_next_level ?? 500;
  const levelPercent =
    xpForNextLevel > 0
      ? Math.min(100, Math.round((xpIntoLevel / xpForNextLevel) * 100))
      : 0;

  return (
    <header className="lobby-header">
      <div className="lobby-profile-wallet">
        <div className="lobby-profile-column">
          <PlayerProfileBadge profile={profile} className="lobby-player-profile" />
        </div>
        <div className="lobby-wallet-column">
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
          </div>
        </div>
        <button type="button" className="lobby-inline-link" onClick={onOpenStore}>
          Store
        </button>
        <details className="profile-editor-disclosure">
          <summary>Edit</summary>
          <PlayerProfileEditor
            profile={profile}
            guest={guest}
            onChange={onProfileChange}
          />
        </details>
        {guest && (
          <span className="lobby-identity-note">
            Progress is tied to this device until you{" "}
            <button type="button" className="lobby-text-link" onClick={onCreateAccount}>
              create an account
            </button>
            .
          </span>
        )}
        {account && account.reserved > 0 ? (
          <span className="lobby-identity-note">
            {account.reserved.toLocaleString()} Jade reserved for your current table.
          </span>
        ) : null}
      </div>

      <dl className="lobby-facts">
        {onOpenStatistics ? (
          <div className="lobby-fact lobby-statistics-fact">
            <dt>Match History</dt>
            <dd>
              <button
                type="button"
                className="lobby-progress-trigger"
                onClick={onOpenStatistics}
                aria-label="Open match history"
                disabled={!statistics?.hasPlayed}
              >
                <strong>
                  {statistics?.hasPlayed
                    ? `${statistics.wins.toLocaleString()} Wins / ${statistics.handsPlayed.toLocaleString()} Games Played`
                    : "Play a Game"}{" "}
                  {statistics?.hasPlayed && <span aria-hidden="true">›</span>}
                </strong>
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
              disabled={(progression?.lifetime_xp ?? 0) <= 0}
              aria-label={
                progressionStatus === "ready"
                  ? `Open progression, level ${level}`
                  : "Open progression"
              }
            >
              <strong>
                {progressionStatus === "ready"
                  ? (progression?.lifetime_xp ?? 0) > 0
                    ? `Level ${level}`
                    : "No progress yet"
                  : progressionStatus === "loading"
                    ? "Loading…"
                    : "View Progress"}{" "}
                {progressionStatus !== "loading" &&
                  (progression?.lifetime_xp ?? 0) > 0 &&
                  <span aria-hidden="true">›</span>}
              </strong>
              {progressionStatus !== "loading" && (
                <span className="lobby-fact-note">
                  {progressionStatus === "ready" && progression?.at_cap
                    ? "Maximum level"
                    : `${xpIntoLevel.toLocaleString()} / ${xpForNextLevel.toLocaleString()} XP`}
                </span>
              )}
              {progressionStatus !== "loading" && !progression?.at_cap && (
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
