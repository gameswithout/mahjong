import type { MatchHistoryEntry } from "./match-history";
import type { PlayerStatSummary } from "./player-stats";

function resultDetail(entry: MatchHistoryEntry): string {
  if (entry.result === "Draw") return "Round ended in a draw";
  if (entry.result === "Neutral") return "Another player won from someone else's discard";
  if (entry.result === "Win") {
    const kind = entry.winKind === "zimo" ? "Zimo" : entry.winKind ? "Hu" : "Win";
    return `${kind}${entry.rawTai > 0 ? ` · ${entry.rawTai} Tai` : ""}`;
  }
  return entry.winKind === "zimo" ? "Opponent won by Zimo" : "Opponent won";
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
          <p className="status-label">Player record</p>
          <h2 id="statistics-title">Match History</h2>
          <p className="statistics-subtitle">
            {summary.hasPlayed
              ? `${summary.wins.toLocaleString()} Wins / ${summary.handsPlayed.toLocaleString()} Games Played`
              : "Play a Game"}
          </p>
        </div>
        <button type="button" className="statistics-close" onClick={onClose}>Close</button>
      </header>

      {history.length === 0 ? (
        <div className="statistics-empty">
          <p>No completed session records are available yet.</p>
          {onPlay ? <button type="button" className="statistics-play" onClick={onPlay}>Play a Game</button> : null}
        </div>
      ) : (
        <ol className="match-history-list">
          {history.map((entry) => (
            <li className="match-history-entry" key={`${entry.matchId}:${entry.completedAt}`}>
              <div>
                <span className={`match-history-result is-${entry.result.toLowerCase()}`}>{entry.result}</span>
                <strong>{entry.mode}</strong>
                <p>{resultDetail(entry)}</p>
              </div>
              <div className="match-history-meta">
                <time dateTime={entry.completedAt}>
                  {entry.completedAt ? new Date(entry.completedAt).toLocaleString() : "Completed"}
                </time>
                <span>{entry.xpAwarded.toLocaleString()} XP</span>
                <code>{entry.matchId}</code>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
