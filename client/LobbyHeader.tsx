import type { JadeAccount, PlayerProgression } from "../protocol/envelope";
import { PlayerProfileBadge, PlayerProfileEditor } from "./PlayerProfile";
import { defaultPlayerProfile, type PlayerProfileConfig } from "./player-profile";
import type { PlayerStatSummary } from "./player-stats";
import { formatNumber, t, translateSource as tr } from "./i18n";

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
  const journey = progression?.journey;
  const games = journey?.completed_rotations ?? 0;
  const prestige = journey?.prestige.filter((step) => step.games <= games).at(-1);
  const next = journey?.prestige.find((step) => step.games > games);

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
          <dt>{tr("My Mahjong Journey")}</dt>
          <dd>
            <button type="button" className="lobby-progress-trigger" onClick={onOpenProgress}
              disabled={progressionStatus === "loading"} aria-label={tr("Open My Mahjong Journey")}>
              <strong>{progressionStatus === "loading" ? t("common.loading") : tr(prestige?.title ?? "Your first seat awaits")} <span aria-hidden="true">›</span></strong>
              <span className="lobby-fact-note">{journey ? `${formatNumber(games)} ${tr("completed games")}` : tr("View your Journey")}</span>
              {journey && next && <span className="lobby-progress-bar" role="progressbar" aria-label={tr("Completed rotations toward next Prestige")} aria-valuemin={0} aria-valuemax={next.games} aria-valuenow={games}>
                <span style={{ width: `${Math.min(100, games / next.games * 100)}%` }} />
              </span>}
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
