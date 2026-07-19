import type { AccelByteSDK } from "@accelbyte/sdk";

export type MatchmakingErrorCode =
  | "network"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "configuration"
  | "invalid_response"
  | "unknown";

export class MatchmakingError extends Error {
  constructor(
    readonly code: MatchmakingErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "MatchmakingError";
  }
}

export interface MatchmakingTicket {
  ticketId: string;
  isActive?: boolean;
  matchFound?: boolean;
  sessionId?: string;
  queueTime?: number;
}

export interface MatchmakingCreateConfig {
  matchPool: string;
  sessionId?: string;
  attributes?: Record<string, unknown>;
  latencies?: Record<string, number>;
}

export interface MatchmakingClient {
  createTicket(): Promise<MatchmakingTicket>;
  getTicket(ticketId: string): Promise<MatchmakingTicket>;
  cancelTicket(ticketId: string): Promise<void>;
}

interface AxiosLike {
  get(url: string): Promise<{ data: unknown }>;
  post(url: string, body?: unknown): Promise<{ data: unknown }>;
  delete(url: string): Promise<{ data: unknown }>;
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

function booleanField(value: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }

  return undefined;
}

function numberField(value: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function responseBody(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new MatchmakingError("invalid_response", "AGS returned an invalid matchmaking response.");
  }

  if (isRecord(value.data)) {
    return value.data;
  }

  return value;
}

function mapCreatedTicket(value: unknown): MatchmakingTicket {
  const body = responseBody(value);
  const ticketId = stringField(body, "matchTicketID", "ticketID", "ticketId", "id");
  if (!ticketId) {
    throw new MatchmakingError("invalid_response", "AGS did not return a matchmaking ticket ID.");
  }

  return {
    ticketId,
    queueTime: numberField(body, "queueTime", "queue_time"),
    isActive: booleanField(body, "isActive", "is_active"),
    matchFound: booleanField(body, "matchFound", "match_found"),
    sessionId: stringField(body, "sessionID", "sessionId", "gameSessionId"),
  };
}

function mapTicketDetail(ticketId: string, value: unknown): MatchmakingTicket {
  const body = responseBody(value);
  const isActive = booleanField(body, "isActive", "is_active");
  const matchFound = booleanField(body, "matchFound", "match_found");
  const sessionId = stringField(body, "sessionID", "sessionId", "gameSessionId");
  if (isActive === undefined && matchFound === undefined && !sessionId) {
    throw new MatchmakingError("invalid_response", "AGS returned an invalid matchmaking ticket.");
  }

  return {
    ticketId,
    isActive,
    matchFound,
    sessionId,
    queueTime: numberField(body, "queueTime", "queue_time"),
  };
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

function mapMatchmakingError(error: unknown): MatchmakingError {
  if (error instanceof MatchmakingError) {
    return error;
  }

  const status = responseStatus(error);
  if (status === 401) {
    return new MatchmakingError(
      "unauthorized",
      "Your guest session is no longer valid. Please sign in again.",
      { cause: error },
    );
  }

  if (status === 403) {
    return new MatchmakingError("forbidden", "AGS denied access to matchmaking.", { cause: error });
  }

  if (status === 404) {
    return new MatchmakingError("not_found", "AGS could not find the matchmaking ticket or pool.", {
      cause: error,
    });
  }

  if (status === 409) {
    return new MatchmakingError("conflict", "AGS could not create another matchmaking ticket yet.", {
      cause: error,
    });
  }

  if (status === undefined) {
    return new MatchmakingError("network", "AGS matchmaking could not be reached. Please retry.", {
      cause: error,
    });
  }

  return new MatchmakingError("unknown", "Matchmaking failed. Please retry.", { cause: error });
}

function endpoint(namespace: string, ticketId?: string): string {
  const base = `/match2/v1/namespaces/${encodeURIComponent(namespace)}/match-tickets`;
  return ticketId ? `${base}/${encodeURIComponent(ticketId)}` : base;
}

function createRequestBody(config: MatchmakingCreateConfig): Record<string, unknown> {
  if (!config.matchPool) {
    throw new MatchmakingError(
      "configuration",
      "Matchmaking pool configuration is incomplete. Restart the dev server after updating .env.",
    );
  }

  const body: Record<string, unknown> = {
    attributes: config.attributes ?? {},
    matchPool: config.matchPool,
    sessionID: config.sessionId ?? "",
  };

  if (config.latencies) {
    body.latencies = config.latencies;
  }

  return body;
}

export function createMatchmakingClient(
  sdk: AccelByteSDK,
  namespace: string,
  config: MatchmakingCreateConfig,
): MatchmakingClient {
  const axiosInstance = sdk.assembly().axiosInstance as unknown as AxiosLike;

  return {
    async createTicket() {
      try {
        const response = await axiosInstance.post(endpoint(namespace), createRequestBody(config));
        return mapCreatedTicket(response.data);
      } catch (error) {
        throw mapMatchmakingError(error);
      }
    },

    async getTicket(ticketId) {
      try {
        const response = await axiosInstance.get(endpoint(namespace, ticketId));
        return mapTicketDetail(ticketId, response.data);
      } catch (error) {
        throw mapMatchmakingError(error);
      }
    },

    async cancelTicket(ticketId) {
      try {
        await axiosInstance.delete(endpoint(namespace, ticketId));
      } catch (error) {
        throw mapMatchmakingError(error);
      }
    },
  };
}
