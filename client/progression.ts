import type { HandXPAward, LevelReward, PlayerProgression } from "../protocol/envelope";

// Client for the §12.1/§12.2 progression surface. Mirrors jade.ts's shape:
// stable error codes, no thrown strings, and no client-side derivation of
// anything the server owns.

export type ProgressionErrorCode =
  | "configuration"
  | "unauthenticated"
  | "network"
  | "timeout"
  | "protocol";

export class ProgressionError extends Error {
  constructor(
    readonly code: ProgressionErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProgressionError";
  }
}

export interface ProgressionSnapshot {
  progression: PlayerProgression;
  // The full §12.2 curve, served rather than hard-coded, so the client cannot
  // drift from the server's reward table.
  curve: LevelReward[];
}

export interface ProgressionClient {
  get(): Promise<ProgressionSnapshot>;
  awardOnboarding(): Promise<{ progression: PlayerProgression; award: HandXPAward }>;
}

export interface ProgressionClientOptions {
  url: string;
  namespace: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 8_000;

function codeForStatus(status: number): ProgressionErrorCode {
  if (status === 401) {
    return "unauthenticated";
  }
  if (status === 429 || status >= 500) {
    return "network";
  }
  return "protocol";
}

function readProgression(value: unknown): PlayerProgression {
  if (!value || typeof value !== "object") {
    // protojson omits zero values, so an entirely absent progression object is
    // a legitimate level-1 account rather than a malformed response.
    return {};
  }
  return value as PlayerProgression;
}

function readCurve(value: unknown): LevelReward[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is LevelReward =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as LevelReward).name === "string",
  );
}

export function createProgressionClient(
  accessToken: string,
  options: ProgressionClientOptions,
): ProgressionClient {
  if (!accessToken || !options.url || !options.namespace) {
    throw new ProgressionError("configuration", "Progression configuration is incomplete.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const path =
    `${options.url}/v1/namespaces/${encodeURIComponent(options.namespace)}/progression`;

  async function request(method: "GET" | "POST", suffix = ""): Promise<unknown> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${path}${suffix}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body: method === "POST" ? "{}" : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ProgressionError("timeout", "Progression did not respond in time.", {
          cause: error,
        });
      }
      throw new ProgressionError("network", "Progression could not be reached.", { cause: error });
    } finally {
      globalThis.clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new ProgressionError(
        codeForStatus(response.status),
        `Progression request failed with HTTP ${response.status}.`,
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw new ProgressionError("protocol", "Progression returned invalid JSON.", {
        cause: error,
      });
    }
  }

  return {
    async get() {
      const body = (await request("GET")) as { progression?: unknown; curve?: unknown };
      return {
        progression: readProgression(body.progression),
        curve: readCurve(body.curve),
      };
    },
    async awardOnboarding() {
      const body = (await request("POST", "/onboarding")) as {
        progression?: unknown;
        award?: unknown;
      };
      return {
        progression: readProgression(body.progression),
        award: (body.award ?? {}) as HandXPAward,
      };
    },
  };
}
