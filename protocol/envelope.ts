export const PROTOCOL_VERSION = 1 as const;

export type ClientMessageType =
  | "hello"
  | "ping"
  | "match.join"
  | "match.sync"
  | "match.command";
export type ServerMessageType =
  | "server.ready"
  | "pong"
  | "match.joined"
  | "match.command.accepted"
  | "match.state"
  | "error";

export interface ProtocolEnvelope<TPayload = unknown> {
  v: typeof PROTOCOL_VERSION;
  type: string;
  request_id?: string;
  payload?: TPayload;
}

export interface ServerReadyPayload {
  user_id: string;
  server_time: string;
}

export interface ProtocolErrorPayload {
  code: string;
  message: string;
}

export type MahjongSeat = "E" | "S" | "W" | "N";
export type TurnPhase =
  | "initial_replacement"
  | "awaiting_draw"
  | "offer_pending"
  | "awaiting_discard"
  | "claim_window"
  | "replacement_chain"
  | "exhaustive_draw"
  | "hand_complete";
export type MatchCommandType = "draw" | "discard" | "submit_claim";
export type ClaimType = "pass" | "win" | "pong" | "kong" | "chow";

export interface MahjongTile {
  id: string;
  kind: "characters" | "bamboo" | "dots" | "wind" | "dragon" | "flower";
  rank?: number;
  copy?: number;
}

export interface PublicDiscard {
  seat: MahjongSeat;
  tile: MahjongTile;
  sequence: number;
}

export interface ClaimResponse {
  action_id?: string;
  seat?: MahjongSeat;
  type: ClaimType;
  tile_ids?: string[];
  state_version: number;
  response_revision: number;
  deliberate?: boolean;
}

// ClaimOptionsView is the requesting seat's own legal claim responses,
// computed server-side (E8.F3: "no legality computed client-side" — the
// browser is told which actions are legal, never left to infer them from
// its own hand).
export interface ClaimOptionsView {
  can_win?: boolean;
  can_pong?: boolean;
  can_kong?: boolean;
  chow_sets?: [string, string][];
  // win_preview is the §9.4 "score preview before Win" assist: the same
  // ScoreResult SubmitClaim(win) would itself produce, only present when
  // can_win is true.
  win_preview?: ScoreResult;
}

export interface SeatClaimView {
  action_id: string;
  state_version: number;
  discard: PublicDiscard;
  deadline: string;
  eligible: MahjongSeat[];
  own_response?: ClaimResponse;
  options: ClaimOptionsView;
}

export type MeldType = "chow" | "pong" | "kong";

// MeldView mirrors rulesengine.MeldView: Tiles is present for the meld's
// owner and for any exposed (non-concealed) meld, but omitted for another
// seat's concealed Kong — a concealed meld's tile identities stay hidden
// from opponents until revealed, matching real play.
export interface MeldView {
  type: MeldType;
  tiles?: MahjongTile[];
  concealed?: boolean;
}

export interface PlayerView {
  seat: MahjongSeat;
  hand_count: number;
  exposed?: MahjongTile[];
  meld_count?: number;
  melds?: MeldView[];
  // taken_over is public: every seat sees the same value for a given
  // player (the §8.7/§11.1 "Auto-playing" badge), not just that seat's
  // own client. True for both a disclosed AFK takeover and a permanent
  // AI Practice bot seat (is_bot) — is_bot distinguishes the two so the
  // client can show "Bot" instead of the misleading "Auto-playing
  // (disconnected)" for a seat that was never a human to begin with.
  taken_over?: boolean;
  is_bot?: boolean;
}

export type WinKind = "discard" | "zimo" | "rob" | "eight_flowers" | "heavenly" | "exhaustive_draw";

// PatternScore/HandShape/ScoreResult/HandWinner/HandResult mirror
// rulesengine's own types (scoring.go/selfturn.go) — §9.7 items 1-4.
export interface PatternScore {
  name: string;
  tai: number;
}

export interface HandShape {
  pair: MahjongTile[];
  melds: MeldView[];
}

export interface ScoreContext {
  seat?: MahjongSeat;
  prevailing_wind?: MahjongSeat;
  discard_win?: boolean;
  zimo?: boolean;
  replacement?: boolean;
  last_tile?: boolean;
  robbed_added_kong?: boolean;
  eight_flowers?: boolean;
  earthly_hand?: boolean;
  heavenly_hand?: boolean;
  single_wait?: boolean;
}

export interface ScoreResult {
  winning: boolean;
  raw_tai: number;
  patterns: PatternScore[];
  shape: HandShape;
  effective_tiles: number;
}

export interface HandWinner {
  seat: MahjongSeat;
  context: ScoreContext;
  score: ScoreResult;
}

export interface HandResult {
  kind: WinKind;
  winners?: HandWinner[];
  payer?: MahjongSeat;
  winning_tile_id?: string;
}

// Transfer/Settlement mirror rulesengine's settlement.go — §9.7 item 6.
export interface Transfer {
  from: MahjongSeat;
  to: MahjongSeat;
  effective_tai: number;
  raw_amount: number;
  amount: number;
  capped?: boolean;
}

export interface Settlement {
  transfers?: Transfer[];
  net: Partial<Record<MahjongSeat, number>>;
  total_credits: number;
  total_debits: number;
}

// ContinuationOutcome mirrors rulesengine's ContinuationOutcome — §9.7 item 7.
export interface ContinuationOutcome {
  next_dealer: MahjongSeat;
  next_continuations: number;
  dealer_retains?: boolean;
}

export interface SeatView {
  match_id: string;
  seat: MahjongSeat;
  state_version: number;
  phase: TurnPhase;
  active_seat: MahjongSeat;
  own_hand: MahjongTile[];
  own_exposed: MahjongTile[];
  own_melds?: MeldView[];
  players: PlayerView[];
  wall: {
    remaining: number;
    drawable_remaining: number;
    reserve_remaining: number;
  };
  // discards is the full public discard pile for every seat, chronological
  // by sequence — every discard is public information in this ruleset.
  discards?: PublicDiscard[];
  last_discard?: PublicDiscard;
  claim?: SeatClaimView;
  win_locked?: boolean;
  // turn_deadline is only meaningful while phase is awaiting_draw or
  // awaiting_discard.
  turn_deadline?: string;
  // hand_result/settlement/next_dealer are only set once phase reaches
  // hand_complete or exhaustive_draw (§9.7).
  hand_result?: HandResult;
  settlement?: Settlement;
  next_dealer?: ContinuationOutcome;
  // waits is the §9.4 Ting/wait-list assist: absent whenever this seat
  // isn't currently holding a waiting-shaped hand (e.g. mid-turn holding an
  // undiscarded draw), not just when the wait list is empty.
  waits?: WaitTileView[];
}

// WaitTileView is one tile type in the §9.4 wait list — tile is a concrete
// physical tile of that type (for glyph/label rendering); visible_remaining
// is "four copies minus copies in the player's own hand, all discards, all
// exposed melds, and all exposed bonus/replacement information" and may be
// zero for a structurally legal but exhausted wait ("All visible").
export interface WaitTileView {
  tile: MahjongTile;
  visible_remaining: number;
}

export interface MatchJoinRequest {
  match_id: string;
}

export interface MatchJoinedPayload {
  match_id: string;
  seat: MahjongSeat;
  view: SeatView;
}

export interface MatchCommandRequest {
  match_id: string;
  type: MatchCommandType;
  expected_version?: number;
  tile_id?: string;
  claim?: ClaimResponse;
}

export interface MatchCommandAcceptedPayload {
  match_id: string;
  seat: MahjongSeat;
  state_version: number;
  phase: TurnPhase;
}

export interface MatchStatePayload {
  match_id: string;
  seat: MahjongSeat;
  view: SeatView;
}
