import { translateSource as tr } from "./i18n";

export function GameModeMenu({ onPlayRanked, rankedBusy = false, rankedUnavailable = false, rankedStatus, onPlayUnranked, unrankedBusy = false, unrankedUnavailable = false, unrankedStatus, onCancelUnranked }: {
  onPlayRanked: () => void;
  rankedBusy?: boolean;
  rankedUnavailable?: boolean;
  rankedStatus?: string;
  onPlayUnranked: () => void;
  unrankedBusy?: boolean;
  unrankedUnavailable?: boolean;
  unrankedStatus?: string;
  onCancelUnranked?: () => void;
}) {
  return (
    <section className="game-mode-menu" aria-label={tr("Choose your game mode")}>
      <div className="game-mode-grid">
        <section className="game-mode-card game-mode-direct" aria-labelledby="unranked-title">
          <span className="status-label">{tr("Play your way")}</span>
          <h2 id="unranked-title">{tr("Unranked")}</h2>
          <p>{tr("Play with others. Bots fill in when no players are available.")}</p>
          <button className="primary-action" type="button" onClick={onPlayUnranked} disabled={unrankedBusy || unrankedUnavailable}>
            {tr(unrankedBusy ? "Finding a table…" : "Play Unranked")}
          </button>
          <p className="game-mode-status" role={unrankedStatus ? "status" : undefined} aria-live="polite">{unrankedStatus ? tr(unrankedStatus) : ""}</p>
          {unrankedBusy && onCancelUnranked && <button className="text-action" type="button" onClick={onCancelUnranked}>{tr("Cancel")}</button>}
        </section>
        <section className="game-mode-card game-mode-direct" aria-labelledby="ranked-title">
          <span className="status-label">{tr("Test your skill")}</span>
          <h2 id="ranked-title">{tr("Ranked")}</h2>
          <p>{tr("Play a full rotation against three human opponents.")}</p>
          <button className="primary-action" type="button" onClick={onPlayRanked} disabled={rankedBusy || rankedUnavailable}>
            {tr(rankedBusy ? "Finding a table…" : "Play Ranked")}
          </button>
          <p className="game-mode-status" role={rankedStatus ? "status" : undefined}>{rankedStatus ? tr(rankedStatus) : ""}</p>
        </section>
      </div>
    </section>
  );
}
