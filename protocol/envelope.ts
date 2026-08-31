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
export type MatchCommandType =
  | "draw"
  | "discard"
  | "submit_claim"
  | "declare_zimo"
  | "declare_concealed_kong"
  | "declare_added_kong";
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
  // The playing style seated here, present only alongside is_bot. A
  // disconnect takeover leaves these empty: that seat plays the neutral
  // policy because its owner chose no style for it, and naming one would
  // be a lie. Absent entirely on any match predating personas, so the
  // client falls back to a plain "Bot" label.
  bot_persona_id?: string;
  bot_persona_name?: string;
  bot_style_tag?: string;
  bot_glyph?: string;
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

export interface DrawSeatAnalysis {
  seat: MahjongSeat;
  tenpai: boolean;
  waits?: WaitTileView[];
}

export interface HandResult {
  kind: WinKind;
  winners?: HandWinner[];
  payer?: MahjongSeat;
  winning_tile_id?: string;
  draw_analysis?: DrawSeatAnalysis[];
}

// Transfer/Settlement mirror rulesengine's settlement.go — §9.7 item 6.
export interface Transfer {
  from: MahjongSeat;
  to: MahjongSeat;
  effective_tai: number;
  raw_amount: number;
  amount: number;
  capped?: boolean;
  calculation?: PaymentCalculation;
}

export interface PaymentComponent {
  kind: string;
  units: number;
  amount: number;
}

export interface PaymentCalculation {
  method_id: string;
  model: string;
  unit_value: number;
  components: PaymentComponent[];
  multiplier: number;
}

export interface SettlementMethod {
  id: string;
  model: string;
  base_units: number;
  tai_cap: number;
  dealer_multiplier: number;
}

export interface Settlement {
  transfers?: Transfer[];
  net: Partial<Record<MahjongSeat, number>>;
  total_credits: number;
  total_debits: number;
  method?: SettlementMethod;
}

export type JadeWelfareReason =
  | "available"
  | "balance_sufficient"
  | "claimed_today"
  | "practice_hand_required"
  | "reservation_open"
  | string;

export interface JadeAccount {
  currency_code: "JADE" | string;
  balance: number;
  reserved: number;
  available: number;
  eligible: boolean;
  minimum_balance: number;
  stake_per_tai: number;
  debit_cap: number;
  wallet_sync_status?: "pending" | "syncing" | "synced" | "error" | string;
  wallet_sync_error?: "unauthorized" | "forbidden" | "not_found" | "timeout" | "balance_mismatch" | "query_failed" | "credit_failed" | "debit_failed" | "unknown" | string;
  welfare_eligible?: boolean;
  welfare_amount?: number;
  welfare_reason?: JadeWelfareReason;
}

export interface JadeSettlement {
  seat: MahjongSeat;
  delta: number;
  balance_before: number;
  balance_after: number;
  journal_id: string;
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
  // Present only for public human Quick Play. Practice projections never
  // expose or mutate Jade.
  jade_account?: JadeAccount;
  jade_settlement?: JadeSettlement;
  // waits is the §9.4 Ting/wait-list assist: absent whenever this seat
  // isn't currently holding a waiting-shaped hand (e.g. mid-turn holding an
  // undiscarded draw), not just when the wait list is empty.
  waits?: WaitTileView[];
  self_turn_options?: {
    can_win?: boolean;
    win_preview?: ScoreResult;
    concealed_kongs?: { tile_ids: string[] }[];
    added_kong_tile_ids?: string[];
  };
  // §12.1 XP earned by this hand, and §12.2 standing after it. Present once
  // the hand is complete, for Practice and public play alike — Practice earns
  // capped participation XP even though it never touches Jade.
  xp_award?: HandXPAward;
  progression?: PlayerProgression;
  // Newly unlocked §12.3 achievements. These are one-shot award projections:
  // later state polls may omit them, so the App retains them for the result
  // screen until the player leaves this completed hand.
  achievements?: HandXPAward[];
  // §8.4 Full Rotation state. Absent for Quick Play and Practice, which are
  // single hands.
  rotation?: RotationState;
}

// RotationState is the §8.4 Full Rotation around the current hand.
//
// Standings are keyed by player rather than by seat, because a player's seat
// wind turns with the dealership: "South has 40 points" means a different
// person each hand, so a seat does not identify anyone across a rotation.
export interface RotationState {
  // Which hand of the rotation is being played, numbered from 1.
  hand_number?: number;
  hands_played?: number;
  // §5.11 continuations behind the current hand, which set Dealer Tai.
  continuations?: number;
  dealer_user_id?: string;
  // How many of the four table positions have dealt. The rotation ends when
  // all four have, which a continuation can postpone, so this rather than
  // hands_played is the real measure of progress.
  seats_dealt?: number;
  standings?: RotationStanding[];
  // RFC 3339 instant at which §8.4's 60-minute limit expires. The hand in
  // progress then is played out before the match ends.
  time_limit_at?: string;
  complete?: boolean;
  // "rotation_complete" or "time_limit". A match cut short by the limit is
  // structurally different from one that ran its course, so the two endings
  // are reported separately.
  reason?: RotationCompletionReason;
  // RFC 3339 instant at which the next hand opens, set while a completed
  // hand's result is on screen and the rotation continues.
  next_hand_opens_at?: string;
  // Final standings, present once the match is complete.
  placements?: RotationPlacement[];
  // §12.1 XP for the rotation as a whole, paid once on final placement.
  placement_xp_award?: HandXPAward;
}

export type RotationCompletionReason = "rotation_complete" | "time_limit";

export interface RotationStanding {
  user_id: string;
  // The player's fixed table position for the whole rotation.
  position: MahjongSeat;
  // The wind they are playing this hand, which turns with the dealership.
  wind: MahjongSeat;
  // Table points start at zero and may go negative. §8.4 Full Rotation uses
  // no Jade, so these are not an account currency and never settle to one.
  table_points?: number;
  deal_ins?: number;
  zimo_wins?: number;
  raw_tai_won?: number;
  dealing?: boolean;
  has_dealt?: boolean;
}

export interface RotationPlacement {
  user_id: string;
  position: number;
  table_points?: number;
  // Equal table points are a genuine rating tie (§8.4) even though the podium
  // shows an order.
  rating_tie?: boolean;
}

export interface XPComponent {
  // Stable reason code; label is display copy and may change.
  code?: string;
  label: string;
  amount: number;
}

export interface HandXPAward {
  // Stable server event ID used for idempotency.
  award_id?: string;
  source?: string;
  total?: number;
  components?: XPComponent[];
  // True when the §12.1 Practice daily cap reduced the award, including to
  // zero. Distinguishes "today's ceiling" from "this earned nothing".
  capped_by_daily?: boolean;
}

export interface LevelReward {
  level: number;
  kind: "title" | "table_theme" | "tile_skin" | "avatar_frame" | string;
  name: string;
  // Stable identifier for a persisted grant, distinct from the display name.
  code?: string;
}

// One rung of the §12.2 curve, including the levels that grant nothing — the
// progression screen shows the real shape of the climb, not only the sparse
// cosmetic milestones.
export interface LevelStep {
  level: number;
  total_xp_required?: number;
  xp_for_next_level?: number;
  rewards?: LevelReward[];
}

export type OnboardingOutcome =
  | "ONBOARDING_OUTCOME_COMPLETED"
  | "ONBOARDING_OUTCOME_SKIPPED";

export interface OnboardingState {
  outcome?: OnboardingOutcome | string;
  recorded_at?: string;
}

export interface PlayerProgression {
  level?: number;
  lifetime_xp?: number;
  xp_into_level?: number;
  xp_for_next_level?: number;
  at_cap?: boolean;
  earned?: LevelReward[];
  next?: LevelReward;
  onboarding?: OnboardingState;
}

// The authenticated player's §12.3 catalog row. The service merges AGS-owned
// progress with the complete product catalog, including goals whose required
// tracking or mode is not available yet.
export interface PlayerAchievement {
  code: string;
  name: string;
  description: string;
  current: number;
  goal: number;
  xp_reward: number;
  bonus_reward?: string;
  eligible: boolean;
  unlocked: boolean;
  unavailable_reason?: string;
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
  tile_ids?: string[];
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
