import type { JadeAccount } from "../protocol/envelope";
import { RULES_NAME, RULES_VERSION } from "./rules-version";

export interface LobbyHeaderProps {
  guest: boolean;
  account?: JadeAccount;
  jadeStatus: "idle" | "loading" | "ready" | "error";
  connection: "connecting" | "connected" | "reconnecting";
}

// The first thing a player sees when signed in. It answers "who am I, what can
// I spend, and which rules am I about to play" — and nothing else. Account
// level and progression belong here eventually (P2.1) but are not invented
// before the server can award them.
export function LobbyHeader({ guest, account, jadeStatus, connection }: LobbyHeaderProps) {
  return (
    <header className="lobby-header">
      <div className="lobby-identity">
        <span className="lobby-identity-name">{guest ? "Guest player" : "Player"}</span>
        {guest && (
          <span className="lobby-identity-note">
            Progress is tied to this device until you create an account.
          </span>
        )}
      </div>

      <dl className="lobby-facts">
        <div className="lobby-fact">
          <dt>Jade</dt>
          <dd>
            {jadeStatus === "ready" && account ? (
              <>
                <strong>{account.available.toLocaleString()}</strong>
                {account.reserved > 0 && (
                  <span className="lobby-fact-note">
                    {account.reserved.toLocaleString()} reserved
                  </span>
                )}
              </>
            ) : jadeStatus === "loading" ? (
              <span className="lobby-fact-note">Loading…</span>
            ) : jadeStatus === "error" ? (
              <span className="lobby-fact-note">Unavailable</span>
            ) : (
              <span className="lobby-fact-note">—</span>
            )}
          </dd>
        </div>

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
