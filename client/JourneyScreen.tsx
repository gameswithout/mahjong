import { useState } from "react";
import type { PlayerJourney } from "../protocol/envelope";
import { formatNumber, t, translateSource as tr } from "./i18n";

export function JourneyScreen({ journey, onClose }: {
  journey?: PlayerJourney;
  onClose: () => void;
}) {
  const [chapter, setChapter] = useState<number | null>(null);
  const games = journey?.completed_rotations ?? 0;
  const steps = journey?.prestige ?? [];
  const earned = steps.filter((step) => games >= step.games);
  const current = earned.at(-1);
  const next = steps.find((step) => games < step.games);
  const selected = earned.find((step) => step.games === chapter) ?? current;
  const stage = selected ? earned.indexOf(selected) + 1 : 0;
  const percent = next ? Math.min(100, games / next.games * 100) : 100;
  return (
    <main className="journey-screen" aria-labelledby="journey-title">
      <header className="journey-header">
        <div><p className="status-label">{tr("Your place at the table")}</p><h1 id="journey-title">{tr("My Mahjong Journey")}</h1></div>
        <button className="secondary-action" onClick={onClose}>{t("progression.back")}</button>
      </header>
      <div className="journey-dimensions" aria-label={tr("Journey dimensions")}>
        <span><strong>{tr("Legacy")}</strong> · {tr("Dedication & belonging")}</span>
        <span><strong>{tr("Skill")}</strong> · {tr("Competitive performance")}</span>
        <span><strong>{tr("Highlights")}</strong> · {tr("Extraordinary moments")}</span>
      </div>
      {!journey ? <p role="status">{tr("Your Journey is unavailable. Return to the lobby and try again.")}</p> : <>
        <section className="journey-hero" aria-label={tr("Legacy progress")}>
          <div><p className="status-label">{tr("Progressive Prestige")}</p><h2>{tr(current?.title ?? "Your first seat awaits")}</h2>
            <p>{tr("Every completed rotation becomes part of your story.")}</p>
            <p className="journey-total"><strong>{formatNumber(games)}</strong> {tr("completed games")}</p>
            {next ? <><p>{tr("Next")}: {tr(next.title)} · {formatNumber(next.games - games)} {tr("rotations to go")}</p>
              <div className="journey-progress" role="progressbar" aria-label={tr("Completed rotations toward next Prestige")} aria-valuemin={0} aria-valuemax={next.games} aria-valuenow={games}><span style={{ width: `${percent}%` }} /></div></> : current ? <p>{tr("Your highest Prestige chapter is unlocked. Your story keeps growing.")}</p> : null}
          </div>
          <div className="journey-chronicle" data-chapter={stage} data-artwork-id={`chronicle-${String(stage).padStart(2, "0")}`}>
            <div className="chronicle-room" role="img" aria-label={tr(selected ? `Living Chronicle: ${selected.chapter}` : "An empty Mahjong room awaiting your first completed rotation")}>
              <span className="chronicle-window" /><span className="chronicle-table">中</span>
              {stage >= 1 && <span className="chronicle-chair" aria-hidden="true" />}
              {stage >= 2 && <span className="chronicle-tea" aria-hidden="true">茶</span>}
              {stage >= 3 && <span className="chronicle-shelf" aria-hidden="true">一 二 三</span>}
              {stage >= 4 && <span className="chronicle-scroll" aria-hidden="true">和</span>}
              {stage >= 5 && <span className="chronicle-plant" aria-hidden="true">竹</span>}
              {stage >= 6 && <span className="chronicle-lantern" aria-hidden="true">福</span>}
              {stage >= 7 && <span className="chronicle-keepsake" aria-hidden="true">發</span>}
            </div>
            <p className="artwork-placeholder-note">{tr("Illustration placeholder")}</p>
            <p className="status-label">{tr("Living Mahjong Chronicle")}</p><h3>{tr(selected?.chapter ?? "A story waiting to begin")}</h3>
            <p>{tr("A Mahjong home that grows with every milestone.")}</p>
          </div>
        </section>
        <section aria-labelledby="journey-chapters"><h2 id="journey-chapters">{tr("Chapters of your Mahjong life")}</h2>
          <ol className="journey-chapters">{steps.map((step) => {
            const unlocked = games >= step.games;
            return <li key={step.games} className={unlocked ? "is-earned" : ""}>
              <button disabled={!unlocked} aria-pressed={selected?.games === step.games} onClick={() => setChapter(step.games)}>
                <span>{formatNumber(step.games)} {tr("games")}</span><strong>{tr(step.title)}</strong><span>{tr(step.chapter)}</span><small>{tr(unlocked ? "Unlocked · view chapter" : "Chapter ahead")}</small>
              </button>
            </li>;
          })}</ol>
          <p className="journey-note">{tr("One game is a completed full dealer rotation. Ranked, Unranked, and bot-supported games count equally. Wins and losses both count; incomplete rotations and individual hands do not.")}</p>
        </section>
        <section className="journey-anniversaries" aria-labelledby="journey-anniversaries"><h2 id="journey-anniversaries">{tr("Years at the table")}</h2>
          <p>{tr("An anniversary badge every year. Exclusive material-themed gifts at major milestones. No login streaks or activity requirements.")}</p>
          {journey.first_completed_at ? <p>{tr("Your journey began")}: <time dateTime={journey.first_completed_at}>{journey.first_completed_at.slice(0, 10)}</time></p> : <p>{tr("Your first completed rotation starts your anniversary clock.")}</p>}
          {journey.anniversaries.length > 0 && <ul>{journey.anniversaries.map((anniversary) => <li key={anniversary.year}><strong>{tr("Year")} {anniversary.year}</strong> · {tr("Anniversary badge")}{anniversary.material ? ` · ${tr(anniversary.material)}` : ""}<time dateTime={anniversary.earned_at}>{anniversary.earned_at}</time></li>)}</ul>}
        </section>
      </>}
    </main>
  );
}
