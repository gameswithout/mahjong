import { RULES_VERSION } from "./rules-version";

export const TELEMETRY_SCHEMA_VERSION = 1;
export const TELEMETRY_MAX_BATCH_SIZE = 20;
export const OPTIONAL_ANALYTICS_CONSENT_KEY = "mahjong.analytics.optional";

export type TelemetryPrivacyClass = "essential" | "optional";

export type TelemetryEventName =
  | "app_session_started"
  | "app_interactive"
  | "app_visibility_changed"
  | "lobby_impression"
  | "mode_selected"
  | "queue_entry_result"
  | "queue_threshold_reached"
  | "queue_alternative_offered"
  | "queue_alternative_selected"
  | "queue_cancel_result"
  | "session_join_result"
  | "tutorial_started"
  | "tutorial_step_shown"
  | "tutorial_step_completed"
  | "tutorial_step_retried"
  | "tutorial_step_replayed"
  | "tutorial_chapter_completed"
  | "tutorial_skipped"
  | "tutorial_completed"
  // §P2.3 / AI Analytics. AGS AI Analytics answers questions from game
  // telemetry rather than from Statistics, so the hand outcomes the dashboard
  // counts also have to be emitted as events for anyone to ask about them
  // across players. The statistics remain authoritative for a player's own
  // record; these are the analysable stream.
  | "hand_completed";

export interface TelemetryFields {
  dimensions?: Record<string, string | undefined>;
  measurements?: Record<string, number | undefined>;
}

export interface QueuedTelemetryEvent {
  event_id: string;
  event_name: TelemetryEventName;
  schema_version: number;
  occurred_at: string;
  analytics_session_id: string;
  privacy_class: TelemetryPrivacyClass;
  dimensions: Record<string, string>;
  measurements: Record<string, number>;
}

export interface GameTelemetry {
  track(name: TelemetryEventName, fields?: TelemetryFields): boolean;
  flush(): Promise<void>;
  start(): void;
  stop(): void;
  optionalConsent(): boolean;
  setOptionalConsent(enabled: boolean): void;
}

export interface BrowserTelemetryOptions {
  baseURL?: string;
  namespace: string;
  clientVersion?: string;
  getAccessToken(): string;
  fetchImpl?: typeof fetch;
  consentStorage?: Pick<Storage, "getItem" | "setItem">;
  sessionStorage?: Pick<Storage, "getItem" | "setItem">;
  flushIntervalMs?: number;
  now?: () => Date;
  createID?: () => string;
}

type EventSpec = {
  privacy: TelemetryPrivacyClass;
  dimensions: ReadonlySet<string>;
  measurements: ReadonlySet<string>;
};

const commonDimensions = new Set([
  "account_type",
  "browser_family",
  "client_version",
  "coarse_region",
  "device_class",
  "locale",
  "orientation",
  "rules_version",
]);

function spec(
  privacy: TelemetryPrivacyClass,
  dimensions: string[] = [],
  measurements: string[] = [],
): EventSpec {
  return {
    privacy,
    dimensions: new Set([...commonDimensions, ...dimensions]),
    measurements: new Set(measurements),
  };
}

const eventSpecs: Record<TelemetryEventName, EventSpec> = {
  app_session_started: spec("essential", ["entry_point"]),
  app_interactive: spec("essential", [], ["interactive_ms"]),
  app_visibility_changed: spec("essential", ["visibility_state"]),
  lobby_impression: spec("optional", ["entry_point"]),
  mode_selected: spec("optional", ["entry_point", "mode", "tier"]),
  queue_entry_result: spec("optional", ["mode", "outcome", "reason_code", "tier"], ["elapsed_ms"]),
  queue_threshold_reached: spec("optional", ["queue_health", "threshold"], ["elapsed_ms"]),
  queue_alternative_offered: spec("optional", ["alternative", "queue_health"], ["elapsed_ms"]),
  queue_alternative_selected: spec("optional", ["alternative"], ["elapsed_ms"]),
  queue_cancel_result: spec("optional", ["outcome", "reason_code"], ["elapsed_ms"]),
  session_join_result: spec(
    "optional",
    ["entry_point", "outcome", "reason_code"],
    ["elapsed_ms", "member_count"],
  ),
  tutorial_started: spec("optional", ["script_version"]),
  tutorial_step_shown: spec("optional", ["chapter_id", "script_version", "step_id"]),
  tutorial_step_completed: spec("optional", ["chapter_id", "script_version", "step_id"]),
  tutorial_step_retried: spec("optional", ["chapter_id", "script_version", "step_id"]),
  tutorial_step_replayed: spec("optional", ["chapter_id", "script_version", "step_id"]),
  tutorial_chapter_completed: spec("optional", ["chapter_id", "script_version"]),
  // Gameplay outcome, the analysable counterpart to the §P2.3 statistics.
  // Optional like every other behavioural event: a player who declines
  // optional analytics still has their own statistics, which are essential to
  // the product rather than to analysis.
  hand_completed: spec(
    "optional",
    ["mode", "outcome", "win_kind", "dealt_in", "ting"],
    ["raw_tai", "wall_remaining"],
  ),
  tutorial_skipped: spec("optional", [
    "chapter_id",
    "from_step_id",
    "script_version",
    "step_id",
  ]),
  tutorial_completed: spec("optional", ["script_version"]),
};

const SESSION_ID_KEY = "mahjong.analytics.session_id";
const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
const MAX_QUEUE_SIZE = 100;

function defaultID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function safeStorage(
  provided: Pick<Storage, "getItem" | "setItem"> | undefined,
  fallback: "localStorage" | "sessionStorage",
): Pick<Storage, "getItem" | "setItem"> | undefined {
  if (provided) {
    return provided;
  }
  try {
    return globalThis[fallback];
  } catch {
    return undefined;
  }
}

function readConsent(storage: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return storage?.getItem(OPTIONAL_ANALYTICS_CONSENT_KEY) === "true";
  } catch {
    return false;
  }
}

function analyticsSessionID(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  createID: () => string,
): string {
  try {
    const stored = storage?.getItem(SESSION_ID_KEY);
    if (stored) {
      return stored;
    }
    const created = `session-${createID()}`;
    storage?.setItem(SESSION_ID_KEY, created);
    return created;
  } catch {
    return `session-${createID()}`;
  }
}

function browserFamily(): string {
  const agent = globalThis.navigator?.userAgent ?? "";
  if (/Edg\//.test(agent)) return "edge";
  if (/Firefox\//.test(agent)) return "firefox";
  if (/Chrome\//.test(agent)) return "chrome";
  if (/Safari\//.test(agent)) return "safari";
  return "other";
}

function deviceClass(): string {
  const width = globalThis.innerWidth || globalThis.screen?.width || 0;
  if (width > 0 && width < 768) return "mobile";
  if (width > 0 && width < 1100) return "tablet";
  return "desktop";
}

function orientation(): string {
  const width = globalThis.innerWidth || globalThis.screen?.width || 0;
  const height = globalThis.innerHeight || globalThis.screen?.height || 0;
  if (!width || !height) return "unknown";
  return width >= height ? "landscape" : "portrait";
}

function localeContext(): { locale?: string; coarseRegion?: string } {
  const locale = globalThis.navigator?.language;
  if (!locale) return {};
  const parts = locale.split("-");
  const region = parts.find((part, index) => index > 0 && /^[A-Za-z]{2}$/.test(part));
  return { locale, coarseRegion: region?.toUpperCase() };
}

function commonContext(clientVersion?: string): Record<string, string> {
  const locale = localeContext();
  return {
    browser_family: browserFamily(),
    device_class: deviceClass(),
    orientation: orientation(),
    rules_version: RULES_VERSION,
    ...(clientVersion ? { client_version: clientVersion } : {}),
    ...(locale.locale ? { locale: locale.locale } : {}),
    ...(locale.coarseRegion ? { coarse_region: locale.coarseRegion } : {}),
  };
}

function normalizeFields(
  spec: EventSpec,
  fields: TelemetryFields,
  clientVersion?: string,
): Pick<QueuedTelemetryEvent, "dimensions" | "measurements"> | null {
  const dimensions = { ...commonContext(clientVersion) };
  for (const [key, value] of Object.entries(fields.dimensions ?? {})) {
    if (value === undefined) {
      continue;
    }
    if (
      !spec.dimensions.has(key) ||
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 128 ||
      /[\r\n\u0000]/.test(value)
    ) {
      return null;
    }
    dimensions[key] = value;
  }
  if (Object.keys(dimensions).length > 16) {
    return null;
  }

  const measurements: Record<string, number> = {};
  for (const [key, value] of Object.entries(fields.measurements ?? {})) {
    if (value === undefined) {
      continue;
    }
    if (
      !spec.measurements.has(key) ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      Math.abs(value) > 1e12
    ) {
      return null;
    }
    measurements[key] = value;
  }
  if (Object.keys(measurements).length > 8) {
    return null;
  }
  return { dimensions, measurements };
}

export function createBrowserTelemetry(options: BrowserTelemetryOptions): GameTelemetry {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const consentStorage = safeStorage(options.consentStorage, "localStorage");
  const sessionStore = safeStorage(options.sessionStorage, "sessionStorage");
  const createID = options.createID ?? defaultID;
  const sessionID = analyticsSessionID(sessionStore, createID);
  const now = options.now ?? (() => new Date());
  const queue: QueuedTelemetryEvent[] = [];
  let consent = readConsent(consentStorage);
  let interval: ReturnType<typeof globalThis.setInterval> | undefined;
  let inFlight: Promise<void> | undefined;

  async function sendNextBatch(): Promise<void> {
    if (!options.baseURL || !options.namespace || !fetchImpl || queue.length === 0) {
      return;
    }
    const batch = queue.slice(0, TELEMETRY_MAX_BATCH_SIZE);
    const token = options.getAccessToken();
    if (!token) {
      return;
    }
    const response = await fetchImpl(`${options.baseURL}/game-telemetry/v1/protected/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        batch.map((event) => ({
          ClientTimestamp: event.occurred_at,
          DeviceType: "web",
          EventId: event.event_id,
          EventName: event.event_name,
          EventNamespace: options.namespace,
          Payload: {
            event_id: event.event_id,
            schema_version: event.schema_version,
            analytics_session_id: event.analytics_session_id,
            privacy_class: event.privacy_class,
            dimensions: event.dimensions,
            measurements: event.measurements,
          },
        })),
      ),
      keepalive: true,
    });
    if (!response.ok) {
      throw new Error(`AGS Game Telemetry returned HTTP ${response.status}`);
    }
    const sentEventIDs = new Set(batch.map((event) => event.event_id));
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (sentEventIDs.has(queue[index].event_id)) {
        queue.splice(index, 1);
      }
    }
  }

  const api: GameTelemetry = {
    track(name, fields = {}) {
      const eventSpec = eventSpecs[name];
      if (eventSpec.privacy === "optional" && !consent) {
        return false;
      }
      const normalized = normalizeFields(eventSpec, fields, options.clientVersion);
      if (!normalized) {
        return false;
      }
      if (queue.length >= MAX_QUEUE_SIZE) {
        const optionalIndex = queue.findIndex((event) => event.privacy_class === "optional");
        if (optionalIndex >= 0) {
          queue.splice(optionalIndex, 1);
        } else {
          queue.shift();
        }
      }
      queue.push({
        event_id: `event-${createID()}`,
        event_name: name,
        schema_version: TELEMETRY_SCHEMA_VERSION,
        occurred_at: now().toISOString(),
        analytics_session_id: sessionID,
        privacy_class: eventSpec.privacy,
        ...normalized,
      });
      if (queue.length >= TELEMETRY_MAX_BATCH_SIZE) {
        void api.flush();
      }
      return true;
    },

    flush() {
      if (inFlight) {
        return inFlight;
      }
      inFlight = sendNextBatch()
        .catch(() => {
          // Telemetry is deliberately best-effort at the player boundary.
          // The unchanged queue is retried by the next scheduled flush.
        })
        .finally(() => {
          inFlight = undefined;
        });
      return inFlight;
    },

    start() {
      if (interval !== undefined) {
        return;
      }
      interval = globalThis.setInterval(
        () => void api.flush(),
        options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      );
    },

    stop() {
      if (interval !== undefined) {
        globalThis.clearInterval(interval);
        interval = undefined;
      }
    },

    optionalConsent() {
      return consent;
    },

    setOptionalConsent(enabled) {
      consent = enabled;
      try {
        consentStorage?.setItem(OPTIONAL_ANALYTICS_CONSENT_KEY, enabled ? "true" : "false");
      } catch {
        // A browser may block storage while still allowing the current
        // in-memory consent choice to govern this tab.
      }
      if (!enabled) {
        for (let index = queue.length - 1; index >= 0; index -= 1) {
          if (queue[index].privacy_class === "optional") {
            queue.splice(index, 1);
          }
        }
      }
    },
  };

  return api;
}
