import {
  PROTOCOL_VERSION,
  type ClientMessageType,
  type MatchCommandAcceptedPayload,
  type MatchCommandRequest,
  type MatchJoinedPayload,
  type MatchStatePayload,
  type ProtocolEnvelope,
  type ProtocolErrorPayload,
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

export interface MatchRuntimeSocket {
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type MatchRuntimeSocketFactory = (
  url: string,
  protocols: string[],
) => MatchRuntimeSocket;

export interface MatchRuntimeConnectionOptions {
  url: string;
  timeoutMs?: number;
  socketFactory?: MatchRuntimeSocketFactory;
  onEnvelope?: (envelope: ProtocolEnvelope) => void;
  onJoined?: (payload: MatchJoinedPayload) => void;
  onState?: (payload: MatchStatePayload) => void;
  onCommandAccepted?: (payload: MatchCommandAcceptedPayload) => void;
  onError?: (error: MatchRuntimeError) => void;
}

export interface MatchRuntimeConnection {
  readonly ready: Promise<ServerReadyPayload>;
  send(type: ClientMessageType, payload?: unknown, requestId?: string): string;
  join(matchId: string, requestId?: string): string;
  sync(requestId?: string): string;
  command(command: MatchCommandRequest, requestId?: string): string;
  close(code?: number, reason?: string): void;
}

const DEFAULT_READY_TIMEOUT_MS = 8_000;

function defaultSocketFactory(url: string, protocols: string[]): MatchRuntimeSocket {
  return new WebSocket(url, protocols) as unknown as MatchRuntimeSocket;
}

function protocolError(message: string, cause?: unknown): MatchRuntimeError {
  return new MatchRuntimeError("protocol", message, { cause });
}

function encodeBearerToken(accessToken: string): string {
  // OAuth bearer tokens are ASCII. Base64url keeps every byte inside the
  // WebSocket subprotocol token grammar without putting the raw credential in
  // the selected/echoed protocol.
  return btoa(accessToken)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function parseEnvelope(raw: unknown): ProtocolEnvelope {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw protocolError("Match runtime sent invalid JSON.", error);
    }
  }

  if (!value || typeof value !== "object") {
    throw protocolError("Match runtime sent an invalid envelope.");
  }
  const envelope = value as Partial<ProtocolEnvelope>;
  if (envelope.v !== PROTOCOL_VERSION || typeof envelope.type !== "string") {
    throw protocolError("Match runtime sent an unsupported protocol envelope.");
  }
  return envelope as ProtocolEnvelope;
}

function readReadyPayload(envelope: ProtocolEnvelope): ServerReadyPayload {
  if (envelope.type !== "server.ready" || !envelope.payload || typeof envelope.payload !== "object") {
    throw protocolError("Match runtime did not send a server.ready envelope.");
  }
  const payload = envelope.payload as Partial<ServerReadyPayload>;
  if (typeof payload.user_id !== "string" || typeof payload.server_time !== "string") {
    throw protocolError("Match runtime sent an invalid server.ready payload.");
  }
  return { user_id: payload.user_id, server_time: payload.server_time };
}

function readServerError(envelope: ProtocolEnvelope): MatchRuntimeError {
  if (!envelope.payload || typeof envelope.payload !== "object") {
    return protocolError("Match runtime sent an invalid error payload.");
  }
  const payload = envelope.payload as Partial<ProtocolErrorPayload>;
  const code = typeof payload.code === "string" ? payload.code : "protocol.error";
  const message = typeof payload.message === "string" ? payload.message : "Match runtime rejected the request.";
  return new MatchRuntimeError("protocol", `${code}: ${message}`);
}

function readSeatView(value: unknown): SeatView {
  if (!value || typeof value !== "object") {
    throw protocolError("Match runtime sent an invalid seat view.");
  }
  const view = value as Partial<SeatView>;
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
    throw protocolError("Match runtime sent an invalid seat view.");
  }
  return view as SeatView;
}

function readJoinedPayload(envelope: ProtocolEnvelope): MatchJoinedPayload {
  if (!envelope.payload || typeof envelope.payload !== "object") {
    throw protocolError("Match runtime sent an invalid match.joined payload.");
  }
  const payload = envelope.payload as Partial<MatchJoinedPayload>;
  const view = readSeatView(payload.view);
  if (
    typeof payload.match_id !== "string" ||
    !["E", "S", "W", "N"].includes(payload.seat ?? "") ||
    payload.match_id !== view.match_id ||
    payload.seat !== view.seat
  ) {
    throw protocolError("Match runtime sent an inconsistent match.joined payload.");
  }
  return { match_id: payload.match_id, seat: payload.seat, view } as MatchJoinedPayload;
}

function readStatePayload(envelope: ProtocolEnvelope): MatchStatePayload {
  if (!envelope.payload || typeof envelope.payload !== "object") {
    throw protocolError("Match runtime sent an invalid match.state payload.");
  }
  const payload = envelope.payload as Partial<MatchStatePayload>;
  const view = readSeatView(payload.view);
  if (
    typeof payload.match_id !== "string" ||
    !["E", "S", "W", "N"].includes(payload.seat ?? "") ||
    payload.match_id !== view.match_id ||
    payload.seat !== view.seat
  ) {
    throw protocolError("Match runtime sent an inconsistent match.state payload.");
  }
  return { match_id: payload.match_id, seat: payload.seat, view } as MatchStatePayload;
}

function readCommandAcceptedPayload(envelope: ProtocolEnvelope): MatchCommandAcceptedPayload {
  if (!envelope.payload || typeof envelope.payload !== "object") {
    throw protocolError("Match runtime sent an invalid command acknowledgement.");
  }
  const payload = envelope.payload as Partial<MatchCommandAcceptedPayload>;
  if (
    typeof payload.match_id !== "string" ||
    !["E", "S", "W", "N"].includes(payload.seat ?? "") ||
    typeof payload.state_version !== "number" ||
    typeof payload.phase !== "string"
  ) {
    throw protocolError("Match runtime sent an invalid command acknowledgement.");
  }
  return payload as MatchCommandAcceptedPayload;
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

  const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const socketFactory = options.socketFactory ?? defaultSocketFactory;
  const requestPrefix = "match-runtime";
  let requestSequence = 0;
  let closed = false;
  let readyResolve: (payload: ServerReadyPayload) => void;
  let readyReject: (error: MatchRuntimeError) => void;
  let readySettled = false;
  const ready = new Promise<ServerReadyPayload>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const settleReadyError = (error: MatchRuntimeError): void => {
    if (readySettled) {
      options.onError?.(error);
      return;
    }
    readySettled = true;
    readyReject(error);
    options.onError?.(error);
  };

  let socket: MatchRuntimeSocket;
  try {
    // Browser WebSocket constructors cannot set Authorization headers. The
    // token is sent only as the handshake subprotocol and is never logged.
    socket = socketFactory(options.url, ["ags.bearer", `ags.token.${encodeBearerToken(accessToken)}`]);
  } catch (error) {
    const safeError = new MatchRuntimeError("network", "Match runtime could not be reached.", { cause: error });
    settleReadyError(safeError);
    throw safeError;
  }

  const timeout = globalThis.setTimeout(() => {
    settleReadyError(new MatchRuntimeError("timeout", "Match runtime did not become ready in time."));
  }, timeoutMs);

  socket.onopen = () => {
    // The runtime sends server.ready immediately after authentication. Keeping
    // the client passive here avoids racing the server's first envelope.
  };
  socket.onmessage = (event) => {
    let envelope: ProtocolEnvelope;
    try {
      envelope = parseEnvelope(event.data);
    } catch (error) {
      settleReadyError(error instanceof MatchRuntimeError ? error : protocolError("Invalid runtime envelope.", error));
      return;
    }

    options.onEnvelope?.(envelope);
    if (envelope.type === "server.ready") {
      try {
        const payload = readReadyPayload(envelope);
        if (!readySettled) {
          readySettled = true;
          globalThis.clearTimeout(timeout);
          readyResolve(payload);
        }
      } catch (error) {
        settleReadyError(error instanceof MatchRuntimeError ? error : protocolError("Invalid ready envelope.", error));
      }
      return;
    }
    if (envelope.type === "error") {
      settleReadyError(readServerError(envelope));
      return;
    }
    try {
      if (envelope.type === "match.joined") {
        const payload = readJoinedPayload(envelope);
        options.onJoined?.(payload);
      } else if (envelope.type === "match.state") {
        const payload = readStatePayload(envelope);
        options.onState?.(payload);
      } else if (envelope.type === "match.command.accepted") {
        const payload = readCommandAcceptedPayload(envelope);
        options.onCommandAccepted?.(payload);
      }
    } catch (error) {
      settleReadyError(error instanceof MatchRuntimeError ? error : protocolError("Invalid match payload.", error));
    }
  };
  socket.onerror = (event) => {
    settleReadyError(new MatchRuntimeError("network", "Match runtime connection failed.", { cause: event }));
  };
  socket.onclose = (event) => {
    if (closed) {
      return;
    }
    settleReadyError(new MatchRuntimeError(
      "closed",
      readySettled ? "Match runtime connection closed." : "Match runtime connection closed before it was ready.",
      { cause: event },
    ));
  };

  const send = (type: ClientMessageType, payload?: unknown, requestId?: string): string => {
    if (closed) {
      throw new MatchRuntimeError("closed", "Match runtime connection is closed.");
    }
    const id = requestId ?? `${requestPrefix}-${++requestSequence}`;
    const envelope: ProtocolEnvelope = {
      v: PROTOCOL_VERSION,
      type,
      request_id: id,
      ...(payload === undefined ? {} : { payload }),
    };
    try {
      socket.send(JSON.stringify(envelope));
    } catch (error) {
      throw new MatchRuntimeError("network", "Match runtime message could not be sent.", { cause: error });
    }
    return id;
  };

  return {
    ready,
    send,
    join(matchId, requestId) {
      if (!matchId.trim()) {
        throw new MatchRuntimeError("configuration", "A match Session ID is required.");
      }
      return send("match.join", { match_id: matchId.trim() }, requestId);
    },
    sync(requestId) {
      return send("match.sync", undefined, requestId);
    },
    command(command, requestId) {
      if (!command.match_id.trim()) {
        throw new MatchRuntimeError("configuration", "A match Session ID is required.");
      }
      return send("match.command", command, requestId);
    },
    close(code = 1000, reason = "client disconnect") {
      if (closed) {
        return;
      }
      closed = true;
      globalThis.clearTimeout(timeout);
      if (!readySettled) {
        readySettled = true;
        readyReject(new MatchRuntimeError("closed", "Match runtime connection closed before it was ready."));
      }
      socket.close(code, reason);
    },
  };
}
