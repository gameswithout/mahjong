// Converts a live rulesengine.SeatView (protocol/envelope.ts) into the
// MatchTable's display shape (matchTableTypes.ts). The wireframe (E7.F5)
// validated the layout against mock data; this is the E8 bridge that feeds
// it real match state instead.
import type { MahjongTile, MeldView, SeatView } from "../protocol/envelope";
import type { MatchAction, MatchTableState, SeatId, SeatState, WireMeld } from "./matchTableTypes";
import { tile } from "./matchTableTypes";

const SEAT_ORDER: SeatId[] = ["E", "S", "W", "N"];

// The match runtime does not yet track dealer/prevailing-wind/continuation
// (E2.F6/E2.F7 multi-hand rotation is unbuilt) — every current match is a
// single freshly-dealt hand with East as dealer, matching the same
// assumption both match runtimes' driveLocked already hardcodes for
// takeover-bot purposes. Revisit once real rotation exists.
const HARDCODED_DEALER: SeatId = "E";
const HARDCODED_PREVAILING_WIND: SeatId = "E";
const HARDCODED_CONTINUATION = 0;

// §5.10's Public Quick Play preset (turn 15s / intercept 7s) — the engine's
// own default when a runtime never calls SetDeadlineConfig, which neither
// runtime does yet (no lobby-tier/mode selection exists client-side). The
// server does not yet send the total duration a deadline was opened with,
// only the deadline instant itself, so the countdown ring's "total" is
// this fixed assumption rather than a value read off the wire.
const TURN_TOTAL_SECONDS = 15;
const CLAIM_TOTAL_SECONDS = 7;

function wireTile(item: MahjongTile) {
  return tile(item.id);
}

function wireMeld(meld: MeldView, ownerSeat: SeatId, index: number): WireMeld {
  const tiles = meld.tiles ?? [];
  const concealedAndRedacted = Boolean(meld.concealed) && tiles.length === 0;
  return {
    id: `${ownerSeat}-meld-${index}`,
    type: meld.type,
    concealed: meld.concealed,
    tiles: tiles.map(wireTile),
    // A concealed Kong is the only meld shape the engine ever marks
    // concealed (§5.7); it is always 4 tiles.
    tileCount: concealedAndRedacted ? 4 : undefined,
  };
}

function deadlineCountdown(
  deadlineIso: string | undefined,
  totalSeconds: number,
  nowMs: number,
): { seconds: number; total: number } | null {
  if (!deadlineIso) {
    return null;
  }
  const deadlineMs = Date.parse(deadlineIso);
  if (Number.isNaN(deadlineMs)) {
    return null;
  }
  const remainingMs = deadlineMs - nowMs;
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return { seconds: Math.min(seconds, totalSeconds), total: totalSeconds };
}

// claimLegalActions derives the legal-action button set from the server-
// computed ClaimOptionsView (E8.F3: "no legality computed client-side" —
// every id here traces back to a boolean/array the server sent, not
// anything inferred from own_hand). dispatch is called with a stable
// action id the caller switches on to send the matching command.
function claimLegalActions(view: SeatView, dispatch: (actionId: string, tileIds?: [string, string]) => void): MatchAction[] {
  const claim = view.claim;
  if (!claim || claim.own_response || !claim.eligible.includes(view.seat)) {
    return [];
  }
  const actions: MatchAction[] = [];
  if (claim.options.can_win) {
    actions.push({ id: "win", label: "Win", onClick: () => dispatch("win") });
  }
  if (claim.options.can_kong) {
    actions.push({ id: "kong", label: "Kong", onClick: () => dispatch("kong") });
  }
  if (claim.options.can_pong) {
    actions.push({ id: "pong", label: "Pong", onClick: () => dispatch("pong") });
  }
  (claim.options.chow_sets ?? []).forEach(([first, second], index) => {
    actions.push({
      id: `chow-${index}`,
      label: claim.options.chow_sets!.length > 1 ? `Chow ${index + 1}` : "Chow",
      onClick: () => dispatch("chow", [first, second]),
    });
  });
  actions.push({ id: "pass", label: "Pass", onClick: () => dispatch("pass") });
  return actions;
}

export interface MatchTableAdapterOptions {
  /** Date.now()-compatible; injectable so a ticking countdown is testable. */
  now: number;
  /** Called with a stable claim-action id (and Chow's tile pair, if any). */
  onClaimAction: (actionId: string, tileIds?: [string, string]) => void;
}

export function seatViewToMatchTableState(view: SeatView, options: MatchTableAdapterOptions): MatchTableState {
  const localSeat = view.seat as SeatId;
  const playersBySeat = new Map(view.players.map((player) => [player.seat as SeatId, player]));
  const discardsBySeat = new Map<SeatId, MahjongTile[]>(SEAT_ORDER.map((seat) => [seat, []]));
  for (const discard of view.discards ?? []) {
    discardsBySeat.get(discard.seat as SeatId)?.push(discard.tile);
  }

  const seats = Object.fromEntries(
    SEAT_ORDER.map((seat) => {
      const isLocal = seat === localSeat;
      const player = playersBySeat.get(seat);
      const melds = isLocal
        ? (view.own_melds ?? []).map((meld, index) => wireMeld(meld, seat, index))
        : (player?.melds ?? []).map((meld, index) => wireMeld(meld, seat, index));
      const state: SeatState = {
        seat,
        displayName: isLocal ? "You" : `Seat ${seat}`,
        wind: seat,
        isDealer: seat === HARDCODED_DEALER,
        isActive: seat === view.active_seat,
        handCount: isLocal ? view.own_hand.length : (player?.hand_count ?? 0),
        hand: isLocal ? view.own_hand.map(wireTile) : undefined,
        melds,
        discards: (discardsBySeat.get(seat) ?? []).map(wireTile),
      };
      return [seat, state];
    }),
  ) as MatchTableState["seats"];

  const claimant = view.claim?.discard.seat as SeatId | undefined;
  const claimCountdown = deadlineCountdown(view.claim?.deadline, CLAIM_TOTAL_SECONDS, options.now);
  const turnCountdown =
    view.phase === "awaiting_draw" || view.phase === "awaiting_discard"
      ? deadlineCountdown(view.turn_deadline, TURN_TOTAL_SECONDS, options.now)
      : null;
  const countdown = claimCountdown ?? turnCountdown;

  return {
    localSeat,
    prevailingWind: HARDCODED_PREVAILING_WIND,
    continuation: HARDCODED_CONTINUATION,
    wall: {
      drawableRemaining: view.wall.drawable_remaining,
      reserveRemaining: view.wall.reserve_remaining,
    },
    seats,
    lastDiscard: view.last_discard
      ? { seat: view.last_discard.seat as SeatId, tile: wireTile(view.last_discard.tile) }
      : null,
    claimSource: claimant ?? null,
    countdownSeconds: countdown?.seconds ?? 0,
    countdownTotalSeconds: countdown?.total ?? TURN_TOTAL_SECONDS,
    legalActions: claimLegalActions(view, options.onClaimAction),
  };
}
