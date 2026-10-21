import { resetSimulation, simulateRotation, useProgressionSimulation } from "./progression-simulator";
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
  const simulation = useProgressionSimulation();
  return (
    <section className="game-mode-menu" aria-label={tr("Choose your game mode")}>
      <div className="game-mode-grid">
        <section className="game-mode-card game-mode-direct" aria-labelledby="unranked-title">
          <span className="status-label">{tr("Play your way")}</span>
          <h2 id="unranked-title">{tr("Casual")}</h2>
          <p>{tr("Play solo or with your party. Match with other players, with Bots filling any open seats.")}</p>
          <button className="primary-action" type="button" onClick={() => { resetSimulation(); onPlayUnranked(); }} disabled={unrankedBusy || unrankedUnavailable}>
            {tr(unrankedBusy ? "Finding a table…" : "Play Casual")}
          </button>
          <p className="game-mode-status" role={unrankedStatus ? "status" : undefined} aria-live="polite">{unrankedStatus ? tr(unrankedStatus) : ""}</p>
          {unrankedBusy && onCancelUnranked && <button className="text-action" type="button" onClick={onCancelUnranked}>{tr("Cancel")}</button>}
        </section>
        <section className="game-mode-card game-mode-direct" aria-labelledby="ranked-title">
          <span className="status-label">{tr("Test your skill")}</span>
          <h2 id="ranked-title">{tr("Ranked")}</h2>
          <p>{tr("Test your skills against other challengers. Queue solo against three human opponents for a full rotation.")}</p>
          <button className="primary-action" type="button" onClick={() => { resetSimulation(); onPlayRanked(); }} disabled={rankedBusy || rankedUnavailable}>
            {tr(rankedBusy ? "Finding a table…" : "Play Ranked")}
          </button>
          <p className="game-mode-status" role={rankedStatus ? "status" : undefined}>{rankedStatus ? tr(rankedStatus) : ""}</p>
        </section>
      </div>
      <details className="developer-tools"><summary>Developer Tools · progression simulation</summary>
        <p>Each result completes one full rotation. Local preview only; no account progress, Jade, or rewards are saved. Draft tuning: 100 XP per rotation, Ranked ±25 Elo. Each rotation has a 60% sample Highlight chance; this is for UI testing, not real rarity.</p>
        {(["Unranked", "Ranked"] as const).map((mode) => <fieldset key={mode}><legend>{mode === "Unranked" ? "Casual" : mode}</legend><button className="secondary-action" onClick={() => simulateRotation(mode, true)}>Simulate {mode === "Unranked" ? "Casual" : mode} Win</button>{" "}<button className="secondary-action" onClick={() => simulateRotation(mode, false)}>Simulate {mode === "Unranked" ? "Casual" : mode} Loss</button></fieldset>)}
        {simulation && <p role="status">Simulation: {simulation.rotations} rotations · {simulation.xp} XP · {simulation.elo} Elo · {simulation.highlights.length} sample Highlights <button className="text-action" onClick={resetSimulation}>Exit and reset simulation</button></p>}
      </details>
    </section>
  );
}
