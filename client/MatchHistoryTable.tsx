import { useState, type ReactNode } from "react";
import { useProgressionSimulation } from "./progression-simulator";
import type { MatchHistoryEntry } from "./match-history";
import { translateSource as tr } from "./i18n";

export function displayMatchMode(mode = "Mahjong") {
  return /unranked|casual/i.test(mode) ? "Casual" : /ranked/i.test(mode) ? "Ranked" : mode;
}
export function recentMatches(matches: readonly MatchHistoryEntry[], page = 0) {
  return [...matches].sort((a, b) => (Date.parse(b.completedAt) || 0) - (Date.parse(a.completedAt) || 0)).slice(page * 10, page * 10 + 10);
}
export function MatchHistoryTable({ matches, onSelect }: { matches: readonly MatchHistoryEntry[]; onSelect: (id: string) => void }) {
  const [requestedPage, setPage] = useState(0);
  const [latestId, setLatestId] = useState(recentMatches(matches)[0]?.matchId);
  if (latestId !== recentMatches(matches)[0]?.matchId) { setLatestId(recentMatches(matches)[0]?.matchId); setPage(0); }
  const pageCount = Math.max(1, Math.ceil(matches.length / 10));
  const page = Math.min(requestedPage, pageCount - 1);
  const rows = recentMatches(matches, page);
  return rows.length ? <><div className="journey-history-scroll"><table className="journey-history-table"><caption>{page === 0 ? tr("Most recent 10 recorded games") : tr("Earlier recorded games")}</caption>
    <thead><tr>{["Match", "Completed", "Mode", "Result", "Tai"].map((label) => <th key={label} scope="col">{tr(label)}</th>)}</tr></thead>
    <tbody>{rows.map((match) => <tr key={match.matchId}><th scope="row"><button className="text-action" onClick={() => onSelect(match.matchId)}>{match.matchId}</button></th><td><time dateTime={match.completedAt}>{Number.isFinite(Date.parse(match.completedAt)) ? new Date(match.completedAt).toLocaleString() : "—"}</time></td><td>{tr(displayMatchMode(match.mode))}</td><td>{tr(match.result ?? "—")}</td><td>{match.rawTai ?? "—"}</td></tr>)}</tbody>
  </table></div><nav className="journey-history-pagination" aria-label="Match history pages">
    <button className="secondary-action" aria-label="Newer games" disabled={page === 0} onClick={() => setPage(page - 1)}>←</button>
    <span role="status">{page * 10 + 1}–{Math.min((page + 1) * 10, matches.length)} of {matches.length} loaded games · Page {page + 1} of {pageCount}</span>
    <button className="secondary-action" aria-label="Older games" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>→</button>
  </nav></> : <p>{tr("Your completed games will appear here.")}</p>;
}

export function MatchHistorySummaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  const simulation = useProgressionSimulation();
  return <button className="secondary-action" onClick={() => { if (simulation) document.getElementById("journey-history-title")?.scrollIntoView?.({ behavior: "smooth" }); else onClick(); }}>{simulation ? `${simulation.matches.filter((match) => match.result === "Win").length} Wins / ${simulation.matches.length} Games Played · Simulation` : children}</button>;
}
