import type { MahjongSeat, SeatView } from "../protocol/envelope";
import { botBadgeLabel, seatDisplayName, seatPersona } from "./bot-persona";
import { windName } from "./matchTableTypes";
import { PlayerProfileBadge } from "./PlayerProfile";
import {
  defaultPlayerProfile,
  type PlayerProfileConfig,
} from "./player-profile";
import { t, translateSource } from "./i18n";

const PROFILE_ORDER: MahjongSeat[] = ["E", "S", "W", "N"];
const TABLE_POSITIONS = ["bottom", "right", "top", "left"] as const;

export const MATCH_LOADING_SCREEN_MS = 2400;

export function MatchLoadingScreen({
  view,
  playerProfile,
}: {
  view: SeatView;
  playerProfile?: PlayerProfileConfig;
}) {
  const playersBySeat = new Map(view.players.map((player) => [player.seat, player]));
  const localSeatIndex = PROFILE_ORDER.indexOf(view.seat);

  return (
    <section className="match-loading-screen" role="status" aria-label={t("loading.joiningLabel")}>
      <header className="match-loading-heading">
        <h1>{t("loading.entering")}</h1>
      </header>

      <div className="match-loading-profile-grid" aria-label={t("loading.profiles")}>
        {PROFILE_ORDER.map((seat) => {
          const player = playersBySeat.get(seat);
          const isLocal = seat === view.seat;
          const isBot = player?.is_bot ?? false;
          // The table names these seats too. Both read the same rule so the
          // loading screen cannot introduce an opponent as "Bot" and then
          // have the table call it Swift Sparrow a moment later. The shared
          // helper is itself localized (t()), so this merges cleanly with
          // the surrounding i18n copy rather than reverting it to English.
          const name = seatDisplayName(player, isLocal);
          const persona = seatPersona(player);
          const tablePosition = TABLE_POSITIONS[
            (PROFILE_ORDER.indexOf(seat) - localSeatIndex + PROFILE_ORDER.length) % PROFILE_ORDER.length
          ];
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
              className={`match-loading-profile match-loading-profile-${tablePosition}${
                isLocal ? " match-loading-profile-local" : ""
              }`}
              data-seat={seat}
              data-position={tablePosition}
              key={seat}
            >
              <div className="essential-profile-row match-loading-profile-row">
                <div
                  className="essential-seat-status match-loading-wind"
                  aria-label={t("loading.wind", { wind: translateSource(windName(seat)) })}
                >
                  <strong>{seat}</strong>
                  {seat === "E" ? <span>{t("table.dealer")}</span> : null}
                </div>
                <div className="essential-profile match-loading-profile-main">
                  <PlayerProfileBadge
                    profile={seatProfile}
                    className="match-loading-shared-profile"
                  />
                </div>
              </div>
              <div className="match-loading-profile-copy">
                <p className="match-loading-seat-name">
                  {t("loading.seat", { wind: translateSource(windName(seat)) })}
                </p>
                {persona ? (
                  <p className="match-loading-persona">
                    <span className="match-loading-persona-glyph" aria-hidden="true">
                      {persona.glyph}
                    </span>
                    <span className="match-loading-persona-tag">
                      {botBadgeLabel(persona.styleTag)}
                    </span>
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <div className="match-loading-progress" aria-hidden="true">
        <span />
      </div>
    </section>
  );
}
