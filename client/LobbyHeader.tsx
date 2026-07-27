import type { JadeAccount } from "../protocol/envelope";
import { PlayerProfileBadge, PlayerProfileEditor } from "./PlayerProfile";
import { defaultPlayerProfile, type PlayerProfileConfig } from "./player-profile";
import { RULES_NAME, RULES_VERSION } from "./rules-version";

export interface LobbyHeaderProps {
  guest: boolean;
  account?: JadeAccount;
  jadeStatus: "idle" | "loading" | "ready" | "error";
  connection: "connecting" | "connected" | "reconnecting";
  profile?: PlayerProfileConfig;
  onProfileChange?: (profile: PlayerProfileConfig) => void;
}

// The first thing a player sees when signed in. It answers "who am I, what can
// I spend, and which rules am I about to play" — and nothing else. Account
// level and progression belong here eventually (P2.1) but are not invented
// before the server can award them.
export function LobbyHeader({
  guest,
  account,
  jadeStatus,
  connection,
  profile = defaultPlayerProfile(guest),
  onProfileChange = () => undefined,
}: LobbyHeaderProps) {
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
