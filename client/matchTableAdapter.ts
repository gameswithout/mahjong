// Converts a live rulesengine.SeatView (protocol/envelope.ts) into the
// MatchTable's display shape (matchTableTypes.ts). The wireframe (E7.F5)
// validated the layout against mock data; this is the E8 bridge that feeds
// it real match state instead.
import type { MahjongTile, MeldView, SeatView } from "../protocol/envelope";
import type { MatchAction, MatchTableState, SeatId, SeatState, WireMeld } from "./matchTableTypes";
import { tile, tileTypeKey } from "./matchTableTypes";

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

// A claim/rob window always carries a deadline field even in an untimed
// match (§5.10 Tutorial/AI Practice) — the engine substitutes a 24-hour
// sentinel so its "resolve once every seat responds OR the deadline
// passes" logic doesn't need a separate no-deadline branch. Any real
// deadline's remaining time is bounded by totalSeconds plus the §5.10
// animation/RTT allowance (at most ~1.1s); comfortably past that, it can
// only be the sentinel, not a countdown that's merely running early.
const SENTINEL_SLACK_SECONDS = 60;

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
  if (seconds > totalSeconds + SENTINEL_SLACK_SECONDS) {
    return null;
  }
  return { seconds: Math.min(seconds, totalSeconds), total: totalSeconds };
}

// claimLegalActions derives the legal-action button set from the server-
// computed ClaimOptionsView (E8.F3: "no legality computed client-side" —
// every id here traces back to a boolean/array the server sent, not
// anything inferred from own_hand). dispatch is called with a stable
// action id the caller switches on to send the matching command.
//
// §9.4/§9.5's "revision-until-deadline": the engine's SubmitClaim already
// accepts a resubmission with an incremented response_revision right up
// to the window's deadline, so this keeps offering every legal action —
// including after an initial response — rather than locking the choice in
// immediately; only the currently-chosen one is marked so the player can
// see what they already picked while still being free to change it.
function claimLegalActions(
  view: SeatView,
  dispatch: (actionId: string, tileIds?: [string, string]) => void,
  pending: boolean,
): MatchAction[] {
  const claim = view.claim;
  if (!claim || !claim.eligible.includes(view.seat)) {
    return [];
  }
  const chosenId = ownResponseActionId(claim);
  const action = (id: string, label: string, onClick: () => void): MatchAction => ({
    id,
    label: id === chosenId ? `${label} ✓` : label,
    onClick,
    disabled: pending,
  });
  const actions: MatchAction[] = [];
  if (claim.options.can_win) {
    const winAction = action("win", "Win", () => dispatch("win"));
    if (claim.options.win_preview) {
      winAction.preview = {
        rawTai: claim.options.win_preview.raw_tai,
        patterns: claim.options.win_preview.patterns.map((p) => ({ name: p.name, tai: p.tai })),
      };
    }
    actions.push(winAction);
  }
  if (claim.options.can_kong) {
    actions.push(action("kong", "Kong", () => dispatch("kong")));
  }
  if (claim.options.can_pong) {
    actions.push(action("pong", "Pong", () => dispatch("pong")));
  }
  (claim.options.chow_sets ?? []).forEach(([first, second], index) => {
    const id = `chow-${index}`;
    const label = claim.options.chow_sets!.length > 1 ? `Chow ${index + 1}` : "Chow";
    const chowAction = action(id, label, () => dispatch("chow", [first, second]));
    chowAction.chowPreview = {
      tiles: [first, second, claim.discard.tile.id]
        .map(tile)
        .sort((left, right) => tileTypeKey(left.id).localeCompare(tileTypeKey(right.id))),
      claimedTileId: claim.discard.tile.id,
    };
    actions.push(chowAction);
  });
  actions.push(action("pass", "Pass", () => dispatch("pass")));
  return actions;
}

function ownResponseActionId(claim: NonNullable<SeatView["claim"]>): string | null {
  const response = claim.own_response;
  if (!response) {
    return null;
  }
  if (response.type === "chow" && response.tile_ids?.length === 2) {
    const index = (claim.options.chow_sets ?? []).findIndex(
      ([first, second]) => first === response.tile_ids![0] && second === response.tile_ids![1],
    );
    return index >= 0 ? `chow-${index}` : "chow-0";
  }
  return response.type;
}

export interface MatchTableAdapterOptions {
  /** Date.now()-compatible; injectable so a ticking countdown is testable. */
  now: number;
  /** Called with a stable claim-action id (and Chow's tile pair, if any). */
  onClaimAction: (actionId: string, tileIds?: [string, string]) => void;
  /**
   * Disables every claim action while a previous one is still in flight —
   * without this, a fast double-click could send two responses before the
   * first's ack updates own_response, submitting a stale response_revision
   * the engine would reject.
   */
  claimActionPending?: boolean;
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
      const isBot = player?.is_bot ?? false;
      const state: SeatState = {
        seat,
        displayName: isLocal ? "You" : isBot ? "Bot" : "Player",
        wind: seat,
        isDealer: seat === HARDCODED_DEALER,
        isActive: seat === view.active_seat,
        handCount: isLocal ? view.own_hand.length : (player?.hand_count ?? 0),
        hand: isLocal ? view.own_hand.map(wireTile) : undefined,
        melds,
        discards: (discardsBySeat.get(seat) ?? []).map(wireTile),
        takenOver: player?.taken_over ?? false,
        isBot,
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
    untimed: countdown === null,
    legalActions: claimLegalActions(view, options.onClaimAction, options.claimActionPending ?? false),
    waits: (view.waits ?? []).map((entry) => ({
      tile: wireTile(entry.tile),
      visibleRemaining: entry.visible_remaining,
    })),
  };
}
