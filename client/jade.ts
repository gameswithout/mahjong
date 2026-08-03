import type { JadeAccount, JadeWelfareReason } from "../protocol/envelope";

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
    options?: { cause?: unknown; diagnostic?: string },
  ) {
    super(message, options);
    this.name = "JadeError";
    this.diagnostic = options?.diagnostic;
  }

  readonly diagnostic?: string;
}

export interface JadeReservation {
  reservation_id: string;
  amount: number;
  status: string;
}

export interface JadeWelfareClaim {
  account: JadeAccount;
  granted: boolean;
  amount: number;
  reason: JadeWelfareReason;
}

export interface JadeClient {
  getAccount(): Promise<JadeAccount>;
  reserve(): Promise<{ account: JadeAccount; reservation: JadeReservation }>;
  release(): Promise<JadeAccount>;
  claimWelfare(): Promise<JadeWelfareClaim>;
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
  const field = (protoName: string, jsonName: string) =>
    raw[protoName] !== undefined ? raw[protoName] : raw[jsonName];
  const currencyCode = field("currency_code", "currencyCode");
  const eligible = field("eligible", "eligible");
  // grpc-gateway's proto3 JSON encoder omits scalar fields at their default
  // value. An ineligible account therefore legitimately has no `eligible`
  // property; treating that omission as a malformed response made the entire
  // Jade service appear unavailable.
  if (
    typeof currencyCode !== "string" ||
    (eligible !== undefined && typeof eligible !== "boolean")
  ) {
    throw new JadeError("protocol", "Jade service returned an invalid account.");
  }
  return {
    currency_code: currencyCode,
    balance: toNumber(raw.balance),
    reserved: toNumber(raw.reserved),
    available: toNumber(raw.available),
    eligible: eligible === true,
    minimum_balance: toNumber(field("minimum_balance", "minimumBalance")),
    stake_per_tai: toNumber(field("stake_per_tai", "stakePerTai")),
    debit_cap: toNumber(field("debit_cap", "debitCap")),
    wallet_sync_status:
      typeof field("wallet_sync_status", "walletSyncStatus") === "string"
        ? field("wallet_sync_status", "walletSyncStatus") as string
        : undefined,
    wallet_sync_error:
      typeof field("wallet_sync_error", "walletSyncError") === "string"
        ? field("wallet_sync_error", "walletSyncError") as string
        : undefined,
    welfare_eligible: field("welfare_eligible", "welfareEligible") === true,
    welfare_amount: toNumber(field("welfare_amount", "welfareAmount")),
    welfare_reason:
      typeof field("welfare_reason", "welfareReason") === "string"
        ? field("welfare_reason", "welfareReason") as string
        : undefined,
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
  // Deployment variables are commonly entered with a trailing slash. Avoid a
  // double-slash route, which some gateways answer with the hosting shell
  // (HTML and HTTP 200) instead of the Jade JSON endpoint.
  const serviceURL = options.url.replace(/\/+$/, "");
  const path = `${serviceURL}/v1/namespaces/${encodeURIComponent(options.namespace)}/jade`;

  async function request(method: "GET" | "POST" | "DELETE", suffix = ""): Promise<unknown> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${path}${suffix}`, {
        method,
        // A Jade balance is private, mutable account state. Safari can reuse a
        // cached gateway response while navigating back to the lobby, which
        // previously replaced a valid balance with "Unavailable". Always ask
        // the service for a fresh representation.
        cache: "no-store",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
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
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new JadeError("network", "Jade service response could not be read.", { cause: error });
    }
    if (!text.trim() || contentType.includes("text/html")) {
      const diagnostic =
        `HTTP ${response.status}; ${contentType || "no content-type"}; ` +
        `${text.length} bytes; ${response.url || path}`;
      if (import.meta.env.DEV) {
        console.warn("[jade] Invalid success response", diagnostic);
      }
      throw new JadeError(
        "network",
        import.meta.env.DEV
          ? `Jade service returned an invalid response (${diagnostic}).`
          : "Jade service is temporarily unavailable. Please retry your balance.",
        { diagnostic },
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      const diagnostic =
        `HTTP ${response.status}; ${contentType || "no content-type"}; ` +
        `${text.length} bytes; ${response.url || path}`;
      if (import.meta.env.DEV) {
        console.warn("[jade] Invalid JSON response", diagnostic);
      }
      throw new JadeError(
        "network",
        import.meta.env.DEV
          ? `Jade service returned invalid JSON (${diagnostic}).`
          : "Jade service is temporarily unavailable. Please retry your balance.",
        { cause: error, diagnostic },
      );
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
      const reservationID =
        typeof raw.reservation_id === "string" ? raw.reservation_id : raw.reservationId;
      if (typeof reservationID !== "string" || typeof raw.status !== "string") {
        throw new JadeError("protocol", "Jade service returned an invalid reservation.");
      }
      return {
        account: readAccount(body.account),
        reservation: {
          reservation_id: reservationID,
          amount: toNumber(raw.amount),
          status: raw.status,
        },
      };
    },
    async release() {
      const body = (await request("DELETE", "/reservation")) as { account?: unknown };
      return readAccount(body.account);
    },
    async claimWelfare() {
      const body = (await request("POST", "/welfare")) as {
        account?: unknown;
        granted?: unknown;
        amount?: unknown;
        reason?: unknown;
      };
      if (
        (body.granted !== undefined && typeof body.granted !== "boolean") ||
        typeof body.reason !== "string"
      ) {
        throw new JadeError("protocol", "Jade service returned an invalid welfare result.");
      }
      return {
        account: readAccount(body.account),
        // protojson omits a false bool and zero int64 by default.
        granted: body.granted === true,
        amount: toNumber(body.amount),
        reason: body.reason,
      };
    },
  };
}
