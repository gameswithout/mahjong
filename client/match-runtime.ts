import {
  PROTOCOL_VERSION,
  type MatchCommandAcceptedPayload,
  type MatchCommandRequest,
  type MatchCommandType,
  type MatchJoinedPayload,
  type MatchStatePayload,
  type ProtocolEnvelope,
  type SeatView,
  type ServerReadyPayload,
} from "../protocol/envelope";
import {
  normalizeHandXPAward,
  normalizePlayerProgression,
} from "./progression";

export type MatchRuntimeErrorCode =
  | "configuration"
  | "protocol"
  | "not_found"
  | "network"
  | "timeout"
  | "closed";

export class MatchRuntimeError extends Error {
  constructor(
    readonly code: MatchRuntimeErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "MatchRuntimeError";
  }
}

export type MatchRuntimeFetch = typeof fetch;

/**
 * How the connection gets a bearer token, read per request rather than
 * captured once.
 *
 * A hand can outlive the token it started with — more so now that the client
 * survives long cellular blackouts instead of dropping out of the match — and
 * a connection holding a snapshot of the token cannot benefit from a refresh
 * that happened after it opened.
 */
export interface MatchRuntimeCredentials {
  getAccessToken(): string;
  /** Renews the token, resolving to whether a fresh one is now available. */
  refreshAccessToken?(): Promise<boolean>;
}

export interface MatchRuntimeConnectionOptions {
  url: string;
  namespace: string;
  timeoutMs?: number;
  fetchImpl?: MatchRuntimeFetch;
  onEnvelope?: (envelope: ProtocolEnvelope) => void;
  onJoined?: (payload: MatchJoinedPayload) => void;
  onState?: (payload: MatchStatePayload) => void;
  /**
   * A poll that succeeded and found the view unchanged. Distinct from onState
   * because there is nothing new to render — but it is still proof the link is
   * healthy, which is what the caller's failure tracking needs to know.
   */
  onUnchanged?: () => void;
  onCommandAccepted?: (payload: MatchCommandAcceptedPayload) => void;
  onError?: (error: MatchRuntimeError) => void;
}

export interface MatchRuntimeConnection {
  readonly ready: Promise<ServerReadyPayload>;
  join(matchId: string, requestId?: string): string;
  sync(requestId?: string): string;
  command(command: MatchCommandRequest, requestId?: string): string;
  close(code?: number, reason?: string): void;
}

const DEFAULT_TIMEOUT_MS = 8_000;

const COMMAND_TYPE_TO_PROTO: Record<MatchCommandType, string> = {
  draw: "MATCH_COMMAND_TYPE_DRAW",
  discard: "MATCH_COMMAND_TYPE_DISCARD",
  submit_claim: "MATCH_COMMAND_TYPE_SUBMIT_CLAIM",
  declare_zimo: "MATCH_COMMAND_TYPE_DECLARE_ZIMO",
  declare_concealed_kong: "MATCH_COMMAND_TYPE_DECLARE_CONCEALED_KONG",
  declare_added_kong: "MATCH_COMMAND_TYPE_DECLARE_ADDED_KONG",
};

function protocolError(message: string, cause?: unknown): MatchRuntimeError {
  return new MatchRuntimeError("protocol", message, { cause });
}

// "unchanged" is the service answering a conditional poll with 304: the view
// the caller already has is still current, so there is no body to read.
type RequestResult = { status: "ok"; body: unknown; etag: string | null } | { status: "unchanged" };

// connectionNonce distinguishes one connection's request ids from every other
// connection's, including earlier ones for the same match and player.
// randomUUID needs a secure context, which the deployed client always has but
// a plain-HTTP local dev origin does not, so fall back to Math.random — these
// ids only have to be unique, never unguessable.
function connectionNonce(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// The gRPC-gateway JSON marshaler encodes int64/uint64 proto fields as JSON
// strings (per the proto3 JSON spec, to avoid JS float-precision loss), but
// every consumer of SeatView expects real numbers. This walks a raw parsed
// match-state body and converts the known int64/uint64 fields in place, plus
// reshapes ClaimOptionsView.chow_sets from the wire's
// [{tile_ids:["a","b"]}] into the [["a","b"]] tuple shape SeatView expects —
// keeping every downstream consumer (matchTableAdapter, MatchTable,
// HandResultScreen) unchanged.
// protojson omits int64/uint64 fields entirely from the JSON when their
// value is exactly 0 (proto3's default zero-value omission applies to
// singular scalar fields regardless of the JSON string encoding). That zero
// is common and legitimate here — a discard's sequence 0, a fresh claim
// response's revision 0, a settlement transfer of 0 — so a missing field
// must default to 0, not be treated as malformed.
function toNumber(value: unknown, fallback = 0): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  throw protocolError("Match service returned a non-numeric value where a number was expected.");
}

function normalizeDiscard(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const discard = raw as Record<string, unknown>;
  return { ...discard, sequence: toNumber(discard.sequence) };
}

function normalizeChowSets(raw: unknown): unknown {
  if (!Array.isArray(raw)) {
    return raw;
  }
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object" || !Array.isArray((entry as Record<string, unknown>).tile_ids)) {
      return entry;
    }
    const tileIds = (entry as Record<string, unknown>).tile_ids as unknown[];
    return [tileIds[0], tileIds[1]];
  });
}

// ScoreResult (win_preview) has no int64/uint64 fields — raw_tai and
// effective_tiles are int32, which protojson does not stringify — so it
// needs no numeric normalization, only the chow_sets tuple reshape below.
function normalizeClaim(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const claim = raw as Record<string, unknown>;
  const normalized: Record<string, unknown> = {
    ...claim,
    state_version: toNumber(claim.state_version),
    discard: normalizeDiscard(claim.discard),
  };
  if (claim.own_response && typeof claim.own_response === "object") {
    const ownResponse = claim.own_response as Record<string, unknown>;
    normalized.own_response = {
      ...ownResponse,
      state_version: toNumber(ownResponse.state_version),
      response_revision: toNumber(ownResponse.response_revision),
    };
  }
  if (claim.options && typeof claim.options === "object") {
    const options = claim.options as Record<string, unknown>;
    normalized.options = { ...options, chow_sets: normalizeChowSets(options.chow_sets) };
  }
  return normalized;
}

function normalizeSettlement(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const settlement = raw as Record<string, unknown>;
  const net: Record<string, number> = {};
  if (settlement.net && typeof settlement.net === "object") {
    for (const [seat, amount] of Object.entries(settlement.net as Record<string, unknown>)) {
      net[seat] = toNumber(amount);
    }
  }
  const transfers = Array.isArray(settlement.transfers)
    ? settlement.transfers.map((transfer) => {
        const item = transfer as Record<string, unknown>;
        return {
          ...item,
          effective_tai: toNumber(item.effective_tai),
          raw_amount: toNumber(item.raw_amount),
          amount: toNumber(item.amount),
        };
      })
    : undefined;
  return {
    ...settlement,
    net,
    transfers,
    total_credits: toNumber(settlement.total_credits),
    total_debits: toNumber(settlement.total_debits),
  };
}

function normalizeJadeAccount(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const account = raw as Record<string, unknown>;
  return {
    ...account,
    balance: toNumber(account.balance),
    reserved: toNumber(account.reserved),
    available: toNumber(account.available),
    minimum_balance: toNumber(account.minimum_balance),
    stake_per_tai: toNumber(account.stake_per_tai),
    debit_cap: toNumber(account.debit_cap),
    welfare_eligible: account.welfare_eligible === true,
    welfare_amount: toNumber(account.welfare_amount),
  };
}

function normalizeJadeSettlement(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const settlement = raw as Record<string, unknown>;
  return {
    ...settlement,
    delta: toNumber(settlement.delta),
    balance_before: toNumber(settlement.balance_before),
    balance_after: toNumber(settlement.balance_after),
  };
}

// normalizeMatchState converts a raw parsed MatchState JSON body (gateway
// wire format) into the shape SeatView's readers expect: real numbers for
// every int64/uint64 field, and chow_sets reshaped into tuples.
function normalizeMatchState(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const state = raw as Record<string, unknown>;
  const normalized: Record<string, unknown> = {
    ...state,
    state_version: toNumber(state.state_version),
  };
  if (Array.isArray(state.discards)) {
    normalized.discards = state.discards.map(normalizeDiscard);
  }
  if (state.last_discard) {
    normalized.last_discard = normalizeDiscard(state.last_discard);
  }
  if (state.claim) {
    normalized.claim = normalizeClaim(state.claim);
  }
  if (state.settlement) {
    normalized.settlement = normalizeSettlement(state.settlement);
  }
  if (state.jade_account) {
    normalized.jade_account = normalizeJadeAccount(state.jade_account);
  }
  if (state.jade_settlement) {
    normalized.jade_settlement = normalizeJadeSettlement(state.jade_settlement);
  }
  if (state.xp_award) {
    normalized.xp_award = normalizeHandXPAward(state.xp_award);
  }
  if (state.progression) {
    normalized.progression = normalizePlayerProgression(state.progression);
  }
  return normalized;
}

function readSeatView(value: unknown): SeatView {
  if (!value || typeof value !== "object") {
    throw protocolError("Match service sent an invalid seat view.");
  }
  const view = normalizeMatchState(value) as Partial<SeatView>;
  if (
    typeof view.match_id !== "string" ||
    !["E", "S", "W", "N"].includes(view.seat ?? "") ||
    typeof view.state_version !== "number" ||
    typeof view.phase !== "string" ||
    !["E", "S", "W", "N"].includes(view.active_seat ?? "") ||
    !Array.isArray(view.own_hand) ||
    !Array.isArray(view.players) ||
    !view.wall ||
    typeof view.wall !== "object"
  ) {
    throw protocolError("Match service sent an invalid seat view.");
  }
  return view as SeatView;
}

function readMatchStateResponse(body: unknown, matchId: string): SeatView {
  if (!body || typeof body !== "object" || !("state" in (body as Record<string, unknown>))) {
    throw protocolError("Match service sent an invalid response.");
  }
  const view = readSeatView((body as Record<string, unknown>).state);
  if (view.match_id !== matchId) {
    throw protocolError("Match service returned a mismatched match ID.");
  }
  return view;
}

function errorCodeForStatus(status: number): MatchRuntimeErrorCode {
  if (status === 401) {
    return "configuration";
  }
  if (status === 404) {
    // A just-created AGS Session can take a moment to become visible to the
    // authoritative service. Keep this distinct from malformed 4xx requests
    // so the App can retry only the propagation-safe case.
    return "not_found";
  }
  if (status >= 500 || status === 429) {
    return "network";
  }
  return "protocol";
}

async function parseErrorBody(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (typeof body.message === "string" && body.message) {
      return body.message;
    }
  } catch {
    // fall through to the generic message below
  }
  return `Match service request failed with HTTP ${response.status}.`;
}

export function createMatchRuntimeConnection(
  credentials: string | MatchRuntimeCredentials,
  options: MatchRuntimeConnectionOptions,
): MatchRuntimeConnection {
  // A bare string is still accepted: most callers have one token and no way to
  // renew it, and nothing about them needs to change.
  const auth: MatchRuntimeCredentials =
    typeof credentials === "string" ? { getAccessToken: () => credentials } : credentials;
  if (!auth?.getAccessToken()) {
    throw new MatchRuntimeError("configuration", "Guest sign-in is required before connecting the match runtime.");
  }
  if (!options.url) {
    throw new MatchRuntimeError("configuration", "Match runtime URL is not configured.");
  }
  if (!options.namespace) {
    throw new MatchRuntimeError("configuration", "AGS namespace is not configured.");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  // The prefix must be unique per connection, not just per request. The
  // service treats request_id as an idempotency key ("player:<user>:<id>",
  // pkg/match/runtime.go) whose committed results are replayed on a repeat —
  // and rebuilt from the event log, so they outlive both a reconnect and a
  // service restart. A per-connection counter alone restarts at 1 on every
  // reconnect, so the Nth command of a resumed connection would collide with
  // the Nth of the dropped one and be answered with that older command's
  // result while the player's actual move was never applied. Mobile networks
  // reconnect constantly, which is exactly when this fires.
  const requestPrefix = `match-runtime-${connectionNonce()}`;
  let requestSequence = 0;
  let closed = false;
  let currentMatchId: string | null = null;
  let syncInFlight = false;
  // The tag from the most recent seat view, replayed on the next poll so the
  // service can answer "still this one" instead of resending it.
  let stateETag: string | null = null;

  const nextRequestId = (requestId?: string): string => requestId ?? `${requestPrefix}-${++requestSequence}`;

  const matchPath = (matchId: string, suffix = ""): string =>
    `${options.url}/v1/namespaces/${encodeURIComponent(options.namespace)}/sessions/${encodeURIComponent(matchId)}/matches/${encodeURIComponent(matchId)}${suffix}`;

  const send = async (
    method: string,
    url: string,
    body?: unknown,
    ifNoneMatch?: string | null,
  ): Promise<Response> => {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, {
        method,
        headers: {
          // Read per attempt, not captured with the connection, so a token
          // renewed mid-hand is picked up without reconnecting.
          Authorization: `Bearer ${auth.getAccessToken()}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new MatchRuntimeError("timeout", "Match service did not respond in time.", { cause: error });
      }
      throw new MatchRuntimeError("network", "Match service could not be reached.", { cause: error });
    } finally {
      globalThis.clearTimeout(timeout);
    }
  };

  const request = async (
    method: string,
    url: string,
    { body, ifNoneMatch }: { body?: unknown; ifNoneMatch?: string | null } = {},
  ): Promise<RequestResult> => {
    if (closed) {
      throw new MatchRuntimeError("closed", "Match runtime connection is closed.");
    }
    let response = await send(method, url, body, ifNoneMatch);
    // An expired token is the one 401 worth acting on rather than reporting:
    // the player is still who they said they were, the proof just aged out
    // mid-hand. Renew once and replay. Commands carry their idempotency key
    // through the replay, so a command the service already committed before
    // the token lapsed returns its original result rather than applying twice.
    if (response.status === 401 && auth.refreshAccessToken) {
      const renewed = await auth.refreshAccessToken();
      if (renewed && !closed) {
        response = await send(method, url, body, ifNoneMatch);
      }
    }
    // 204 is a successful poll that happens to carry nothing: the view the
    // caller already holds is still current. The service answers an unchanged
    // conditional poll this way rather than with 304 because a browser cannot
    // use a 304 here — it has no stored copy to reconcile one against, and
    // cancels the request instead. It has no body, so it must be recognised
    // before anything tries to parse one.
    if (response.status === 204) {
      // Nothing to release: fetch gives a 204 a null body. The browser still
      // records the request as cancelled once it is dropped, which looks like
      // a failure in devtools and in anything reading Chrome's network events
      // — it is not. The fetch resolved; this is the poll succeeding.
      return { status: "unchanged" };
    }
    if (!response.ok) {
      const message = await parseErrorBody(response);
      throw new MatchRuntimeError(errorCodeForStatus(response.status), message);
    }
    try {
      return { status: "ok", body: await response.json(), etag: response.headers.get("ETag") };
    } catch (error) {
      throw protocolError("Match service sent an invalid JSON response.", error);
    }
  };

  // For the calls that are never conditional, so they do not each have to
  // rule out a response the service cannot give them.
  const requestBody = async (method: string, url: string, body?: unknown): Promise<unknown> => {
    const result = await request(method, url, { body });
    if (result.status !== "ok") {
      throw protocolError("Match service sent an unexpected conditional response.");
    }
    return result.body;
  };

  const emitEnvelope = (type: string, payload: unknown): void => {
    options.onEnvelope?.({ v: PROTOCOL_VERSION, type, payload } as ProtocolEnvelope);
  };

  const reportError = (error: MatchRuntimeError): void => {
    options.onError?.(error);
  };

  return {
    // REST has no handshake to await; config is already validated above, so
    // this resolves immediately. Nothing downstream reads the resolved
    // payload's values today.
    ready: Promise.resolve({ user_id: "", server_time: new Date().toISOString() }),

    join(matchId, requestId) {
      const trimmed = matchId.trim();
      if (!trimmed) {
        throw new MatchRuntimeError("configuration", "A match Session ID is required.");
      }
      currentMatchId = trimmed;
      const id = nextRequestId(requestId);
      void requestBody("POST", matchPath(trimmed, "/join"), {})
        .then((body) => {
          const view = readMatchStateResponse(body, trimmed);
          const payload: MatchJoinedPayload = { match_id: view.match_id, seat: view.seat, view };
          emitEnvelope("match.joined", payload);
          options.onJoined?.(payload);
        })
        .catch((error) => {
          reportError(error instanceof MatchRuntimeError ? error : protocolError("Join request failed.", error));
        });
      return id;
    },

    sync(requestId) {
      const id = nextRequestId(requestId);
      const matchId = currentMatchId;
      if (!matchId) {
        reportError(new MatchRuntimeError("configuration", "sync() called before join() completed."));
        return id;
      }
      // A poll that has not come back yet already covers this one: it will
      // return whatever the caller wanted, only later. Cellular round trips
      // routinely exceed the poll interval, and each request holds an
      // 8-second timeout, so without this guard a slow link accumulates
      // overlapping syncs that compete for the same connection and make the
      // stall they were issued to recover from worse.
      if (syncInFlight) {
        return id;
      }
      syncInFlight = true;
      void request("GET", matchPath(matchId), { ifNoneMatch: stateETag })
        .then((result) => {
          // Nothing has moved since the last poll — which is most polls, since
          // a hand only advances when somebody acts. The view already on
          // screen is still authoritative, so there is nothing to re-render;
          // the caller is told only that the poll succeeded.
          if (result.status === "unchanged") {
            options.onUnchanged?.();
            return;
          }
          stateETag = result.etag;
          const view = readMatchStateResponse(result.body, matchId);
          const payload: MatchStatePayload = { match_id: view.match_id, seat: view.seat, view };
          emitEnvelope("match.state", payload);
          options.onState?.(payload);
        })
        .catch((error) => {
          reportError(error instanceof MatchRuntimeError ? error : protocolError("Sync request failed.", error));
        })
        .finally(() => {
          syncInFlight = false;
        });
      return id;
    },

    command(command, requestId) {
      const trimmed = command.match_id.trim();
      if (!trimmed) {
        throw new MatchRuntimeError("configuration", "A match Session ID is required.");
      }
      const id = nextRequestId(requestId);
      // The claim we hold client-side is a full ClaimResponse (it also
      // carries seat and state_version, which the UI uses), but the
      // service's ClaimCommand proto defines only these five fields and
      // its JSON parser rejects any others as unknown. seat and
      // state_version are authoritative server-side anyway — the runtime
      // sets them from the validated caller and current view — so sending
      // them would be both rejected and pointless.
      const claim = command.claim
        ? {
            action_id: command.claim.action_id,
            type: command.claim.type,
            tile_ids: command.claim.tile_ids,
            response_revision: command.claim.response_revision,
            deliberate: command.claim.deliberate,
          }
        : undefined;
      const body: Record<string, unknown> = {
        request_id: id,
        type: COMMAND_TYPE_TO_PROTO[command.type],
        expected_version: command.expected_version,
        tile_id: command.tile_id,
        tile_ids: command.tile_ids,
        claim,
      };
      void requestBody("POST", matchPath(trimmed, "/commands"), body)
        .then((raw) => {
          if (!raw || typeof raw !== "object") {
            throw protocolError("Match service sent an invalid command response.");
          }
          const response = raw as Record<string, unknown>;
          // A command's own response is the freshest view there is, so the
          // next poll must not present a tag that predates it.
          stateETag = null;
          const view = readMatchStateResponse({ state: response.state }, trimmed);
          const accepted: MatchCommandAcceptedPayload = {
            match_id: view.match_id,
            seat: view.seat,
            state_version: view.state_version,
            phase: view.phase,
          };
          emitEnvelope("match.command.accepted", accepted);
          options.onCommandAccepted?.(accepted);
          const statePayload: MatchStatePayload = { match_id: view.match_id, seat: view.seat, view };
          emitEnvelope("match.state", statePayload);
          options.onState?.(statePayload);
        })
        .catch((error) => {
          reportError(error instanceof MatchRuntimeError ? error : protocolError("Command request failed.", error));
        });
      return id;
    },

    close() {
      closed = true;
    },
  };
}
