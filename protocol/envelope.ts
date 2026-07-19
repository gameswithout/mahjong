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
