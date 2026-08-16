import type { PlayerView } from "../protocol/envelope";
import { t } from "./i18n";

/**
 * How a seat is named and labelled.
 *
 * This lives in one place because it had already drifted: the table showed
 * "Swift Sparrow" while the loading screen, holding its own copy of the same
 * two-line rule, still said "Bot" for the same seat in the same match. Any
 * screen that names a seat imports from here.
 */

/** The playing style seated at one position. */
export interface BotPersona {
  id: string;
  name: string;
  /** Plain-language style label — "Rush", "Guard". */
  styleTag: string;
  glyph: string;
}

/**
 * The persona seated here, or null when there is none.
 *
 * Null covers three genuinely different situations that all render the same
 * way: a human seat, a disconnect takeover (whose owner chose no style), and
 * a match played before personas existed. None of them should be given a
 * name the server did not send.
 */
export function seatPersona(player: PlayerView | undefined): BotPersona | null {
  if (!player?.is_bot) {
    return null;
  }
  const name = player.bot_persona_name?.trim() ?? "";
  if (!name) {
    return null;
  }
  return {
    id: player.bot_persona_id?.trim() ?? "",
    name,
    styleTag: player.bot_style_tag?.trim() ?? "",
    glyph: player.bot_glyph?.trim() ?? "",
  };
}

/**
 * What to call this seat.
 *
 * A named bot is shown by name; an unnamed one stays localized "Bot", which
 * is also what §11 requires a bot to remain regardless of how it is styled.
 *
 * The persona's own name/tag/glyph are server-provided proper nouns and
 * deliberately not run through t(): per the persona proposal, "working
 * persona names ... will receive separate cultural review" — they are not
 * yet part of the localization catalog the way the surrounding UI copy is.
 */
export function seatDisplayName(
  player: PlayerView | undefined,
  isLocal: boolean,
): string {
  if (isLocal) {
    return t("common.you");
  }
  if (!player?.is_bot) {
    return t("loading.player");
  }
  return seatPersona(player)?.name || t("table.bot");
}

/**
 * The badge text for a bot seat: "Bot · Rush", or plain "Bot" when no style
 * came through.
 *
 * The style rides alongside the word "Bot" rather than replacing it. §11
 * requires a bot to stay visibly a bot, and a seat labelled only "Rush"
 * would read as a human's chosen nickname. The style tag itself is not
 * translated, for the same reason seatDisplayName's persona name isn't.
 */
export function botBadgeLabel(styleTag: string | undefined): string {
  const tag = styleTag?.trim();
  return tag ? t("table.botStyled", { style: tag }) : t("table.bot");
}
