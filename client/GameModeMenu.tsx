import { useEffect, useState, type ReactNode } from "react";
import { resetSimulation, simulateRotation, useProgressionSimulation } from "./progression-simulator";
import { translateSource as tr } from "./i18n";

function QueueTimer({ active, ranked = false }: { active: boolean; ranked?: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    if (!active) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  const duration = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  return <p className="game-mode-timer" aria-label={active ? "Matchmaking duration" : undefined}>{active ? `${duration} elapsed${ranked ? " · 2:00 maximum" : ""}` : "\u00a0"}</p>;
}

export function GameModeMenu({ onPlayRanked, rankedBusy = false, rankedUnavailable = false, rankedStatus, rankedBalance, onCancelRanked, onPlayUnranked, unrankedBusy = false, unrankedUnavailable = false, unrankedStatus, onCancelUnranked }: {
  onPlayRanked: () => void;
  rankedBusy?: boolean;
  rankedUnavailable?: boolean;
  rankedStatus?: string;
  rankedBalance?: ReactNode;
  onCancelRanked?: () => void;
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
          <button className="primary-action" type="button" onClick={() => { resetSimulation(); onPlayUnranked(); }} disabled={unrankedBusy || rankedBusy || unrankedUnavailable}>
            {tr(unrankedBusy ? "Finding a table…" : "Play Casual")}
          </button>
          <div className="game-mode-feedback">
          <QueueTimer active={unrankedBusy} />
          <p className="game-mode-status" role={unrankedStatus ? "status" : undefined} aria-live="polite">{unrankedStatus ? tr(unrankedStatus) : ""}</p>
          <div className="game-mode-cancel-slot">{unrankedBusy && onCancelUnranked && <button className="text-action game-mode-cancel" type="button" onClick={onCancelUnranked}>{tr("Cancel")}</button>}</div>
          </div>
        </section>
        <section className="game-mode-card game-mode-direct" aria-labelledby="ranked-title">
          <div className="ranked-card-heading"><span className="status-label">{tr("Test your skill")}</span>{rankedBalance}</div>
          <h2 id="ranked-title">{tr("Ranked")}</h2>
          <p>{tr("Test your skills against other challengers. Queue solo against three human opponents for a full rotation.")}</p>
          <button className="primary-action" type="button" onClick={() => { resetSimulation(); onPlayRanked(); }} disabled={rankedBusy || unrankedBusy || rankedUnavailable}>
            {tr(rankedBusy ? "Finding a table…" : "Play Ranked")}
          </button>
          <div className="game-mode-feedback">
          <QueueTimer active={rankedBusy} ranked />
          <p className="game-mode-status" role={rankedStatus ? "status" : undefined}>{rankedStatus ? tr(rankedStatus) : ""}</p>
          <div className="game-mode-cancel-slot">{rankedBusy && onCancelRanked && <button className="text-action game-mode-cancel" type="button" onClick={onCancelRanked}>{tr("Cancel")}</button>}</div>
          </div>
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
