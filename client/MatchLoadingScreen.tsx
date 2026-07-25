import type { MahjongSeat, SeatView } from "../protocol/envelope";
import { windName } from "./matchTableTypes";

const PROFILE_ORDER: MahjongSeat[] = ["E", "S", "W", "N"];

export const MATCH_LOADING_SCREEN_MS = 2400;

export function MatchLoadingScreen({ view }: { view: SeatView }) {
  const playersBySeat = new Map(view.players.map((player) => [player.seat, player]));

  return (
    <section className="match-loading-screen" role="status" aria-label="Players joining the table">
      <header className="match-loading-heading">
        <p>Players ready</p>
        <h1>Entering the Mahjong table</h1>
      </header>

      <div className="match-loading-profile-grid" aria-label="Player profiles">
        {PROFILE_ORDER.map((seat) => {
          const player = playersBySeat.get(seat);
          const isLocal = seat === view.seat;
          const isBot = player?.is_bot ?? false;
          const name = isLocal ? "You" : isBot ? "Bot" : "Player";

          return (
            <article
              className={`match-loading-profile${isLocal ? " match-loading-profile-local" : ""}`}
              data-seat={seat}
              key={seat}
            >
              <div className="match-loading-avatar" aria-hidden="true">
                {isBot ? "🤖" : isLocal ? "🀄" : "●"}
              </div>
              <div className="match-loading-profile-copy">
                <p className="match-loading-player-name">{name}</p>
                <p className="match-loading-seat-name">
                  {windName(seat)} seat
                  {seat === "E" ? <span className="match-loading-dealer">Dealer</span> : null}
                </p>
              </div>
              <span className="match-loading-wind" aria-label={`${windName(seat)} wind`}>
                {seat}
              </span>
            </article>
          );
        })}
      </div>

      <div className="match-loading-progress" aria-hidden="true">
        <span />
      </div>
      <p className="match-loading-status">Setting the table…</p>
    </section>
  );
}
