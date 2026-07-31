import type { PlayerStatSummary, StatRate } from "./player-stats";
import { MINIMUM_RATE_SAMPLE } from "./player-stats";

// §P2.3 statistics dashboard. Every number here is a counter the match service
// wrote to AGS Statistics; this screen only divides them and says what by.
//
// Two rules shape the whole thing. A rate is never shown without its
// denominator, because "30% deal-in" means nothing until you know it is 30% of
// hands played rather than of hands lost. And a rate is not shown at all until
// the denominator is large enough to describe the player rather than the
// shuffle — below that the player sees the counts and how many hands are left
// to go, which is honest and also gives them a reason to play more.

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function RateRow({
  label,
  rate,
  hint,
}: {
  label: string;
  rate: StatRate;
  hint: string;
}) {
  const remaining = Math.max(0, MINIMUM_RATE_SAMPLE - rate.denominator);
  const provisional = rate.ratio === null;

  return (
    <div className="statistics-row" data-testid={`stat-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <div className="statistics-row-head">
        <span className="statistics-row-label">{label}</span>
        <span className={provisional ? "statistics-row-value is-provisional" : "statistics-row-value"}>
          {provisional ? `${rate.numerator} of ${rate.denominator}` : percent(rate.ratio!)}
        </span>
      </div>
      <p className="statistics-row-detail">
        {provisional ? (
          <>
            {remaining === 0
              ? `No ${rate.denominatorLabel} yet.`
              : `${remaining} more ${remaining === 1 ? "hand" : "hands"} until this becomes a percentage.`}{" "}
            <span className="statistics-row-hint">{hint}</span>
          </>
        ) : (
          <>
            {rate.numerator.toLocaleString()} of {rate.denominator.toLocaleString()} {rate.denominatorLabel}.{" "}
            <span className="statistics-row-hint">{hint}</span>
          </>
        )}
      </p>
    </div>
  );
}

export function StatisticsScreen({
  summary,
  onClose,
  onPlay,
}: {
  summary: PlayerStatSummary;
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
        <button type="button" className="statistics-close" onClick={onClose}>
          Close
        </button>
      </header>

      {!summary.hasPlayed ? (
        <div className="statistics-empty" data-testid="statistics-empty">
          <p>
            Your statistics start after your first public hand. Practice hands are not counted — they
            do not change Jade, rating, or progression, so they do not change these either.
          </p>
          {onPlay ? (
            <button type="button" className="statistics-play" onClick={onPlay}>
              Play a Game
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="statistics-rows">
            <RateRow
              label="Win rate"
              rate={summary.winRate}
              hint="How often you take the hand."
            />
            <RateRow
              label="Zimo share"
              rate={summary.zimoShare}
              hint="Of the hands you win, how many you win on your own draw."
            />
            <RateRow
              label="Deal-in rate"
              rate={summary.dealInRate}
              hint="How often somebody wins on a tile you discarded."
            />
            <RateRow
              label="Ting at hand end"
              rate={summary.tingRate}
              hint="How often you were still one tile from winning when the hand ended."
            />
          </div>

          <div className="statistics-totals">
            <div className="statistics-total">
              <span className="statistics-total-value">{summary.bestHandTai.toLocaleString()}</span>
              <span className="statistics-total-label">Best hand (Tai)</span>
            </div>
            <div className="statistics-total">
              <span className="statistics-total-value">{summary.wins.toLocaleString()}</span>
              <span className="statistics-total-label">Hands won</span>
            </div>
            <div className="statistics-total">
              <span className="statistics-total-value">{summary.kongsDeclared.toLocaleString()}</span>
              <span className="statistics-total-label">Kongs declared</span>
            </div>
          </div>
        </>
      )}

    </section>
  );
}
