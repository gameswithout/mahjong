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

export type MatchRuntimeErrorCode = "configuration" | "protocol" | "network" | "timeout" | "closed";

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

export interface MatchRuntimeConnectionOptions {
  url: string;
  namespace: string;
  timeoutMs?: number;
  fetchImpl?: MatchRuntimeFetch;
  onEnvelope?: (envelope: ProtocolEnvelope) => void;
  onJoined?: (payload: MatchJoinedPayload) => void;
  onState?: (payload: MatchStatePayload) => void;
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
};

function protocolError(message: string, cause?: unknown): MatchRuntimeError {
  return new MatchRuntimeError("protocol", message, { cause });
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
  accessToken: string,
  options: MatchRuntimeConnectionOptions,
): MatchRuntimeConnection {
  if (!accessToken) {
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
  const requestPrefix = "match-runtime";
  let requestSequence = 0;
  let closed = false;
  let currentMatchId: string | null = null;

  const nextRequestId = (requestId?: string): string => requestId ?? `${requestPrefix}-${++requestSequence}`;

  const matchPath = (matchId: string, suffix = ""): string =>
    `${options.url}/v1/namespaces/${encodeURIComponent(options.namespace)}/sessions/${encodeURIComponent(matchId)}/matches/${encodeURIComponent(matchId)}${suffix}`;

  const request = async (method: string, url: string, body?: unknown): Promise<unknown> => {
    if (closed) {
      throw new MatchRuntimeError("closed", "Match runtime connection is closed.");
    }
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
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
    if (!response.ok) {
      const message = await parseErrorBody(response);
      throw new MatchRuntimeError(errorCodeForStatus(response.status), message);
    }
    try {
      return await response.json();
    } catch (error) {
      throw protocolError("Match service sent an invalid JSON response.", error);
    }
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
      void request("POST", matchPath(trimmed, "/join"), {})
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
      void request("GET", matchPath(matchId))
        .then((body) => {
          const view = readMatchStateResponse(body, matchId);
          const payload: MatchStatePayload = { match_id: view.match_id, seat: view.seat, view };
          emitEnvelope("match.state", payload);
          options.onState?.(payload);
        })
        .catch((error) => {
          reportError(error instanceof MatchRuntimeError ? error : protocolError("Sync request failed.", error));
        });
      return id;
    },

    command(command, requestId) {
      const trimmed = command.match_id.trim();
      if (!trimmed) {
        throw new MatchRuntimeError("configuration", "A match Session ID is required.");
      }
      const id = nextRequestId(requestId);
      const body: Record<string, unknown> = {
        request_id: id,
        type: COMMAND_TYPE_TO_PROTO[command.type],
        expected_version: command.expected_version,
        tile_id: command.tile_id,
        claim: command.claim,
      };
      void request("POST", matchPath(trimmed, "/commands"), body)
        .then((raw) => {
          if (!raw || typeof raw !== "object") {
            throw protocolError("Match service sent an invalid command response.");
          }
          const response = raw as Record<string, unknown>;
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
