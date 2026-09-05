import type { JadeAccount, PlayerProgression } from "../protocol/envelope";
import { PlayerProfileBadge, PlayerProfileEditor } from "./PlayerProfile";
import { defaultPlayerProfile, type PlayerProfileConfig } from "./player-profile";
import type { PlayerStatSummary } from "./player-stats";
import { formatNumber, t } from "./i18n";

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
  founderTileUnlocked?: boolean;
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
  founderTileUnlocked = false,
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
          <div className="lobby-wallet" aria-label={t("header.walletLabel")}>
            <span className="currency-balance currency-jade">
              <span className="currency-icon" aria-hidden="true">◆</span>
              <strong>
                {jadeStatus === "ready" && account
                  ? formatNumber(account.available)
                  : jadeStatus === "loading"
                    ? "…"
                    : t("common.unavailable")}
              </strong>
              <span className="sr-only">{t("common.jade")}</span>
            </span>
          </div>
        </div>
        <button type="button" className="lobby-inline-link" onClick={onOpenStore}>
          {t("header.store")}
        </button>
        <details className="profile-editor-disclosure">
          <summary>{t("header.edit")}</summary>
          <PlayerProfileEditor
            profile={profile}
            guest={guest}
            onChange={onProfileChange}
            founderTileUnlocked={founderTileUnlocked}
          />
        </details>
        {guest && (
          <span className="lobby-identity-note">
            {t("header.guestPrefix")}{" "}
            <button type="button" className="lobby-text-link" onClick={onCreateAccount}>
              {t("header.createAccount")}
            </button>
            .
          </span>
        )}
        {account && account.reserved > 0 ? (
          <span className="lobby-identity-note">
            {t("header.reserved", { count: formatNumber(account.reserved) })}
          </span>
        ) : null}
      </div>

      <dl className="lobby-facts">
        {onOpenStatistics ? (
          <div className="lobby-fact lobby-statistics-fact">
            <dt>{t("header.matchHistory")}</dt>
            <dd>
              <button
                type="button"
                className="lobby-progress-trigger"
                onClick={onOpenStatistics}
                aria-label={t("header.openMatchHistory")}
                disabled={!statistics?.hasPlayed}
              >
                <strong>
                  {statistics?.hasPlayed
                    ? t("header.winsGames", {
                        wins: formatNumber(statistics.wins),
                        games: formatNumber(statistics.handsPlayed),
                      })
                    : t("header.playGame")}{" "}
                  {statistics?.hasPlayed && <span aria-hidden="true">›</span>}
                </strong>
              </button>
            </dd>
          </div>
        ) : null}
        <div className="lobby-fact lobby-progress-fact">
          <dt>{t("header.progress")}</dt>
          <dd>
            <button
              type="button"
              className="lobby-progress-trigger"
              onClick={onOpenProgress}
              disabled={(progression?.lifetime_xp ?? 0) <= 0}
              aria-label={
                progressionStatus === "ready"
                  ? t("header.openProgressLevel", { level })
                  : t("header.openProgress")
              }
            >
              <strong>
                {progressionStatus === "ready"
                  ? (progression?.lifetime_xp ?? 0) > 0
                    ? t("header.level", { level })
                    : t("header.noProgress")
                  : progressionStatus === "loading"
                    ? t("common.loading")
                    : t("header.viewProgress")}{" "}
                {progressionStatus !== "loading" &&
                  (progression?.lifetime_xp ?? 0) > 0 &&
                  <span aria-hidden="true">›</span>}
              </strong>
              {progressionStatus !== "loading" && (
                <span className="lobby-fact-note">
                  {progressionStatus === "ready" && progression?.at_cap
                    ? t("header.maximumLevel")
                    : `${formatNumber(xpIntoLevel)} / ${formatNumber(xpForNextLevel)} XP`}
                </span>
              )}
              {progressionStatus !== "loading" && !progression?.at_cap && (
                <span
                  className="lobby-progress-bar"
                  role="progressbar"
                  aria-label={t("header.levelProgress", { level })}
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
            ? t("header.connecting")
            : t("header.reconnecting")}
        </p>
      )}

    </header>
  );
}
