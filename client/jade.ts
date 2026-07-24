import type { JadeAccount } from "../protocol/envelope";

export type JadeErrorCode =
  | "configuration"
  | "unauthenticated"
  | "ineligible"
  | "network"
  | "timeout"
  | "protocol";

export class JadeError extends Error {
  constructor(
    readonly code: JadeErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "JadeError";
  }
}

export interface JadeReservation {
  reservation_id: string;
  amount: number;
  status: string;
}

export interface JadeClient {
  getAccount(): Promise<JadeAccount>;
  reserve(): Promise<{ account: JadeAccount; reservation: JadeReservation }>;
  release(): Promise<JadeAccount>;
}

export interface JadeClientOptions {
  url: string;
  namespace: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 8_000;

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  if (value === undefined || value === null) {
    return 0;
  }
  throw new JadeError("protocol", "Jade service returned an invalid balance.");
}

function readAccount(value: unknown): JadeAccount {
  if (!value || typeof value !== "object") {
    throw new JadeError("protocol", "Jade service returned an invalid account.");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.currency_code !== "string" || typeof raw.eligible !== "boolean") {
    throw new JadeError("protocol", "Jade service returned an invalid account.");
  }
  return {
    currency_code: raw.currency_code,
    balance: toNumber(raw.balance),
    reserved: toNumber(raw.reserved),
    available: toNumber(raw.available),
    eligible: raw.eligible,
    minimum_balance: toNumber(raw.minimum_balance),
    stake_per_tai: toNumber(raw.stake_per_tai),
    debit_cap: toNumber(raw.debit_cap),
    wallet_sync_status:
      typeof raw.wallet_sync_status === "string" ? raw.wallet_sync_status : undefined,
  };
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message) {
      return body.message;
    }
  } catch {
    // Use the stable player-facing fallback below.
  }
  return `Jade service request failed with HTTP ${response.status}.`;
}

function codeForStatus(status: number): JadeErrorCode {
  if (status === 401) {
    return "unauthenticated";
  }
  if (status === 400 || status === 409 || status === 412) {
    return "ineligible";
  }
  if (status === 429 || status >= 500) {
    return "network";
  }
  return "protocol";
}

export function createJadeClient(
  accessToken: string,
  options: JadeClientOptions,
): JadeClient {
  if (!accessToken || !options.url || !options.namespace) {
    throw new JadeError("configuration", "Jade service configuration is incomplete.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const path = `${options.url}/v1/namespaces/${encodeURIComponent(options.namespace)}/jade`;

  async function request(method: "GET" | "POST" | "DELETE", suffix = ""): Promise<unknown> {
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
        throw new JadeError("timeout", "Jade service did not respond in time.", { cause: error });
      }
      throw new JadeError("network", "Jade service could not be reached.", { cause: error });
    } finally {
      globalThis.clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new JadeError(codeForStatus(response.status), await errorMessage(response));
    }
    try {
      return await response.json();
    } catch (error) {
      throw new JadeError("protocol", "Jade service returned invalid JSON.", { cause: error });
    }
  }

  return {
    async getAccount() {
      const body = (await request("GET")) as { account?: unknown };
      return readAccount(body.account);
    },
    async reserve() {
      const body = (await request("POST", "/reservation")) as {
        account?: unknown;
        reservation?: unknown;
      };
      if (!body.reservation || typeof body.reservation !== "object") {
        throw new JadeError("protocol", "Jade service returned an invalid reservation.");
      }
      const raw = body.reservation as Record<string, unknown>;
      if (typeof raw.reservation_id !== "string" || typeof raw.status !== "string") {
        throw new JadeError("protocol", "Jade service returned an invalid reservation.");
      }
      return {
        account: readAccount(body.account),
        reservation: {
          reservation_id: raw.reservation_id,
          amount: toNumber(raw.amount),
          status: raw.status,
        },
      };
    },
    async release() {
      const body = (await request("DELETE", "/reservation")) as { account?: unknown };
      return readAccount(body.account);
    },
  };
}
