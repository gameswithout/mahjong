import type { AccelByteSDK } from "@accelbyte/sdk";

// AI Practice: passed as createSession's attributes so the match service's
// roster resolver (AGSResolver.Roster, pkg/session/ags_resolver.go) pads
// the roster with bot seats instead of requiring three more real players.
export const AI_PRACTICE_SESSION_ATTRIBUTES: Record<string, unknown> = { ai_practice: "true" };

export type SessionErrorCode =
  | "network"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "configuration"
  | "invalid_response"
  | "unknown";

export class SessionLookupError extends Error {
  constructor(
    readonly code: SessionErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SessionLookupError";
  }
}

export interface SessionMember {
  userId: string;
  displayName?: string;
  status?: string;
}

export interface GameSessionSummary {
  sessionId: string;
  status?: string;
  members: SessionMember[];
}

export interface SessionClient {
  listMySessions(): Promise<GameSessionSummary[]>;
  getSession(sessionId: string): Promise<GameSessionSummary>;
  // attributes is arbitrary client-supplied session metadata that AGS
  // round-trips unchanged; the match service's roster resolver reads
  // { ai_practice: "true" } from it to know a session should be padded
  // with bot seats instead of requiring three more real players.
  createSession(attributes?: Record<string, unknown>): Promise<GameSessionSummary>;
  joinSession(sessionId: string): Promise<void>;
  leaveSession(sessionId: string): Promise<void>;
}

interface SessionApiResponse {
  data?: unknown;
}

interface AxiosLike {
  get(url: string): Promise<SessionApiResponse>;
  post(url: string, body?: unknown): Promise<SessionApiResponse>;
  delete(url: string): Promise<SessionApiResponse>;
}

export interface SessionCreateConfig {
  configurationName: string;
  clientVersion: string;
  maxPlayers: number;
  minPlayers: number;
  joinability: "OPEN" | "INVITE_ONLY" | "CLOSED";
  type: "NONE" | "P2P" | "DS";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function stringField(value: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function arrayField(value: Record<string, unknown>, ...keys: string[]): unknown[] {
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function mapMember(value: unknown): SessionMember | null {
  if (!isRecord(value)) {
    return null;
  }

  const userId = stringField(value, "userId", "userID", "uid", "memberId", "id");
  if (!userId) {
    return null;
  }

  return {
    userId,
    displayName: stringField(value, "displayName", "name", "userName", "username"),
    status: stringField(value, "status", "memberStatus"),
  };
}

function mapSession(value: unknown): GameSessionSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const sessionId = stringField(value, "sessionId", "gameSessionId", "id");
  if (!sessionId) {
    return null;
  }

  return {
    sessionId,
    status: stringField(value, "status", "sessionStatus"),
    members: arrayField(value, "members", "member", "roster")
      .map(mapMember)
      .filter((member): member is SessionMember => member !== null),
  };
}

function mapSessionList(value: unknown): GameSessionSummary[] {
  const envelope = isRecord(value) && "data" in value ? value.data : value;
  const values = Array.isArray(envelope)
    ? envelope
    : isRecord(envelope)
      ? arrayField(envelope, "data", "gamesessions", "gameSessions", "sessions")
      : [];

  const sessions = values
    .map(mapSession)
    .filter((session): session is GameSessionSummary => session !== null);

  if (values.length > 0 && sessions.length === 0) {
    throw new SessionLookupError("invalid_response", "AGS returned an invalid session list.");
  }

  return sessions;
}

function mapSessionDetail(value: unknown): GameSessionSummary {
  const envelope = isRecord(value) && "data" in value ? value.data : value;
  const session = mapSession(envelope);
  if (!session) {
    throw new SessionLookupError("invalid_response", "AGS returned an invalid session.");
  }

  return session;
}

function responseStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const response = error.response;
  if (!isRecord(response) || typeof response.status !== "number") {
    return undefined;
  }

  return response.status;
}

function mapSessionError(error: unknown): SessionLookupError {
  if (error instanceof SessionLookupError) {
    return error;
  }

  const status = responseStatus(error);
  if (status === 401) {
    return new SessionLookupError("unauthorized", "Your guest session is no longer valid. Please sign in again.", {
      cause: error,
    });
  }

  if (status === 403) {
    return new SessionLookupError("forbidden", "AGS denied access to your sessions.", { cause: error });
  }

  if (status === 404) {
    return new SessionLookupError("not_found", "AGS could not find the requested session.", {
      cause: error,
    });
  }

  if (status === undefined) {
    return new SessionLookupError("network", "AGS sessions could not be reached. Please retry.", {
      cause: error,
    });
  }

  return new SessionLookupError("unknown", "Session lookup failed. Please retry.", { cause: error });
}

function endpoint(namespace: string, sessionId?: string): string {
  const encodedNamespace = encodeURIComponent(namespace);
  if (!sessionId) {
    return `/session/v1/public/namespaces/${encodedNamespace}/users/me/gamesessions`;
  }

  return `/session/v1/public/namespaces/${encodedNamespace}/gamesessions/${encodeURIComponent(sessionId)}`;
}

function createEndpoint(namespace: string): string {
  return `/session/v1/public/namespaces/${encodeURIComponent(namespace)}/gamesession`;
}

function joinEndpoint(namespace: string, sessionId: string): string {
  return `${endpoint(namespace, sessionId)}/join`;
}

function leaveEndpoint(namespace: string, sessionId: string): string {
  return `${endpoint(namespace, sessionId)}/leave`;
}

function createRequestBody(
  config: SessionCreateConfig | undefined,
  attributes?: Record<string, unknown>,
): Record<string, unknown> {
  if (!config) {
    throw new SessionLookupError(
      "configuration",
      "Session table configuration is incomplete. Restart the dev server after updating .env.",
    );
  }

  return {
    attributes: attributes ?? {},
    backfillTicketID: "",
    clientVersion: config.clientVersion,
    configurationName: config.configurationName,
    deployment: "",
    inactiveTimeout: 60,
    inviteTimeout: 60,
    joinability: config.joinability,
    matchPool: "",
    maxPlayers: config.maxPlayers,
    minPlayers: config.minPlayers,
    requestedRegions: [],
    serverName: "",
    teams: [],
    textChat: false,
    ticketIDs: [],
    type: config.type,
  };
}

export function createSessionClient(
  sdk: AccelByteSDK,
  namespace: string,
  config?: SessionCreateConfig,
): SessionClient {
  const axiosInstance = sdk.assembly().axiosInstance as unknown as AxiosLike;

  return {
    async listMySessions() {
      try {
        const response = await axiosInstance.get(endpoint(namespace));
        return mapSessionList(response.data);
      } catch (error) {
        throw mapSessionError(error);
      }
    },

    async getSession(sessionId) {
      try {
        const response = await axiosInstance.get(endpoint(namespace, sessionId));
        return mapSessionDetail(response.data);
      } catch (error) {
        throw mapSessionError(error);
      }
    },

    async createSession(attributes) {
      try {
        const response = await axiosInstance.post(
          createEndpoint(namespace),
          createRequestBody(config, attributes),
        );
        return mapSessionDetail(response.data);
      } catch (error) {
        throw mapSessionError(error);
      }
    },

    async joinSession(sessionId) {
      try {
        await axiosInstance.post(joinEndpoint(namespace, sessionId));
      } catch (error) {
        throw mapSessionError(error);
      }
    },

    async leaveSession(sessionId) {
      try {
        await axiosInstance.delete(leaveEndpoint(namespace, sessionId));
      } catch (error) {
        throw mapSessionError(error);
      }
    },
  };
}
