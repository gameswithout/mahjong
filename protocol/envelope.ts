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

export interface SeatClaimView {
  action_id: string;
  state_version: number;
  discard: PublicDiscard;
  deadline: string;
  eligible: MahjongSeat[];
  own_response?: ClaimResponse;
}

export interface PlayerView {
  seat: MahjongSeat;
  hand_count: number;
  exposed?: MahjongTile[];
  meld_count?: number;
}

export interface SeatView {
  match_id: string;
  seat: MahjongSeat;
  state_version: number;
  phase: TurnPhase;
  active_seat: MahjongSeat;
  own_hand: MahjongTile[];
  own_exposed: MahjongTile[];
  players: PlayerView[];
  wall: {
    remaining: number;
    drawable_remaining: number;
    reserve_remaining: number;
  };
  last_discard?: PublicDiscard;
  claim?: SeatClaimView;
  win_locked?: boolean;
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
