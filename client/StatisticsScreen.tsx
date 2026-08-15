import type { MatchHistoryEntry } from "./match-history";
import type { PlayerStatSummary } from "./player-stats";
import { formatDateTime, formatNumber, t, translateSource } from "./i18n";

function resultDetail(entry: MatchHistoryEntry): string {
  if (entry.result === "Draw") return t("statistics.draw");
  if (entry.result === "Neutral") return t("statistics.neutral");
  if (entry.result === "Win") {
    const kind = entry.winKind === "zimo"
      ? t("statistics.zimoWin")
      : entry.winKind
        ? t("statistics.huWin")
        : t("statistics.win");
    return entry.rawTai > 0 ? t("statistics.winTai", { kind, tai: entry.rawTai }) : kind;
  }
  return entry.winKind === "zimo" ? t("statistics.opponentZimo") : t("statistics.opponentWon");
}

function resultLabel(result: MatchHistoryEntry["result"]): string {
  if (result === "Draw") return t("statistics.resultDraw");
  if (result === "Neutral") return t("statistics.resultNeutral");
  if (result === "Win") return t("statistics.resultWin");
  return t("statistics.resultLoss");
}

export function StatisticsScreen({
  summary,
  history = [],
  onClose,
  onPlay,
}: {
  summary: PlayerStatSummary;
  history?: MatchHistoryEntry[];
  onClose: () => void;
  onPlay?: () => void;
}) {
  return (
    <section className="statistics-screen" aria-labelledby="statistics-title">
      <header className="statistics-header">
        <div>
          <p className="status-label">{t("statistics.playerRecord")}</p>
          <h2 id="statistics-title">{t("statistics.title")}</h2>
          <p className="statistics-subtitle">
            {summary.hasPlayed
              ? t("header.winsGames", {
                  wins: formatNumber(summary.wins),
                  games: formatNumber(summary.handsPlayed),
                })
              : t("header.playGame")}
          </p>
        </div>
        <button type="button" className="statistics-close" onClick={onClose}>{t("common.close")}</button>
      </header>

      {history.length === 0 ? (
        <div className="statistics-empty">
          <p>{t("statistics.empty")}</p>
          {onPlay ? <button type="button" className="statistics-play" onClick={onPlay}>{t("header.playGame")}</button> : null}
        </div>
      ) : (
        <ol className="match-history-list">
          {history.map((entry) => (
            <li className="match-history-entry" key={`${entry.matchId}:${entry.completedAt}`}>
              <div>
                <span className={`match-history-result is-${entry.result.toLowerCase()}`}>{resultLabel(entry.result)}</span>
                <strong>{translateSource(entry.mode)}</strong>
                <p>{resultDetail(entry)}</p>
              </div>
              <div className="match-history-meta">
                <time dateTime={entry.completedAt}>
                  {entry.completedAt ? formatDateTime(entry.completedAt) : t("statistics.completed")}
                </time>
                <span>{formatNumber(entry.xpAwarded)} XP</span>
                <code>{entry.matchId}</code>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
