import type { MahjongSeat, SeatView } from "../protocol/envelope";
import { seatDisplayName, seatPersona } from "./bot-persona";
import { windName } from "./matchTableTypes";
import { PlayerProfileBadge } from "./PlayerProfile";
import {
  defaultPlayerProfile,
  type PlayerProfileConfig,
} from "./player-profile";

const PROFILE_ORDER: MahjongSeat[] = ["E", "S", "W", "N"];

export const MATCH_LOADING_SCREEN_MS = 2400;

export function MatchLoadingScreen({
  view,
  playerProfile,
}: {
  view: SeatView;
  playerProfile?: PlayerProfileConfig;
}) {
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
          // The table names these seats too. Both read the same rule so the
          // loading screen cannot introduce an opponent as "Bot" and then
          // have the table call it Swift Sparrow a moment later.
          const name = seatDisplayName(player, isLocal);
          const persona = seatPersona(player);
          const seatProfile: PlayerProfileConfig = isLocal && playerProfile
            ? playerProfile
            : {
                ...defaultPlayerProfile(false),
                nickname: name,
                tileSlotIds: [
                  isBot ? "dragon-green-1" : "dragon-red-1",
                  "wind-east-1",
                  "dots-1-1",
                ],
              };

          return (
            <article
              className={`match-loading-profile${isLocal ? " match-loading-profile-local" : ""}`}
              data-seat={seat}
              key={seat}
            >
              <PlayerProfileBadge
                profile={seatProfile}
                className="match-loading-shared-profile"
              />
              <div className="match-loading-profile-copy">
                <p className="match-loading-seat-name">
                  {windName(seat)} seat
                  {seat === "E" ? <span className="match-loading-dealer">Dealer</span> : null}
                </p>
                {persona ? (
                  <p className="match-loading-persona">
                    <span className="match-loading-persona-glyph" aria-hidden="true">
                      {persona.glyph}
                    </span>
                    <span className="match-loading-persona-tag">
                      {persona.styleTag ? `Bot · ${persona.styleTag}` : "Bot"}
                    </span>
                  </p>
                ) : null}
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
