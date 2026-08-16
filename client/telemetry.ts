import { RULES_VERSION } from "./rules-version";

// v2 adds the growth event set (§ "Growth" below). Consumers keyed to v1 keep
// working: no v1 event changed shape, and the only v1 event to gain fields is
// app_session_started, which gained optional dimensions.
export const TELEMETRY_SCHEMA_VERSION = 2;
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
  | "result_friend_options_shown"
  | "friend_request_result"
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
  | "hand_completed"
  | "rotation_completed"
  // Growth. The first eleven events answer "is the game working?"; these
  // answer "is the game growing?" — the two are not the same question and the
  // second one had no events at all before this set.
  //
  // Each name below becomes its own Athena table in AI Analytics
  // (`gameswithout_mahjong_<event_name>`), so the set is deliberately small:
  // one event per growth stage, with the stage's variation carried in
  // dimensions rather than split across near-duplicate names.
  | "app_session_ended"
  | "analytics_consent_changed"
  | "account_upgrade_step"
  | "activation_milestone"
  | "match_abandoned"
  | "economy_checkpoint"
  | "economy_recovery"
  | "progression_level_up"
  | "social_action"
  | "feature_engaged";

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
  // return_band and session_count_band are coarse, device-local, and disclose
  // nothing that was not already derivable: AGS binds the player's user ID to
  // every event, so day-N return was always computable from this event's own
  // history. The bands only make the cohort a GROUP BY instead of a self-join
  // over the whole table on every question.
  app_session_started: spec("essential", [
    "entry_point",
    "return_band",
    "session_count_band",
  ]),
  app_interactive: spec("essential", [], ["interactive_ms"]),
  app_visibility_changed: spec("essential", ["visibility_state"]),
  lobby_impression: spec("optional", ["entry_point"]),
  mode_selected: spec("optional", ["entry_point", "mode", "tier"]),
  queue_entry_result: spec("optional", ["mode", "outcome", "reason_code", "tier"], ["elapsed_ms"]),
  queue_threshold_reached: spec("optional", ["queue_health", "threshold"], ["elapsed_ms"]),
  queue_alternative_offered: spec("optional", ["alternative", "queue_health"], ["elapsed_ms"]),
  queue_alternative_selected: spec("optional", ["alternative"], ["elapsed_ms"]),
  queue_cancel_result: spec("optional", ["mode", "outcome", "reason_code"], ["elapsed_ms"]),
  session_join_result: spec(
    "optional",
    ["entry_point", "mode", "outcome", "reason_code"],
    ["elapsed_ms", "member_count"],
  ),
  result_friend_options_shown: spec(
    "optional",
    ["source"],
    ["eligible_count", "opponent_count"],
  ),
  friend_request_result: spec("optional", ["outcome", "reason_code", "source"]),
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
  rotation_completed: spec(
    "optional",
    ["completion_reason"],
    ["hands_played", "seats_dealt"],
  ),
  tutorial_skipped: spec("optional", [
    "chapter_id",
    "from_step_id",
    "script_version",
    "step_id",
  ]),
  tutorial_completed: spec("optional", ["script_version"]),

  // --- Growth ------------------------------------------------------------
  //
  // Three of these are essential and seven are optional, and the split is not
  // arbitrary. Essential covers the lifecycle of the app and of the account —
  // facts the game needs whether or not anybody analyses them. Everything that
  // describes how a player *behaved* is optional, exactly as the tutorial and
  // queue journeys already are.
  //
  // Worth knowing when reading the resulting data: optional events are
  // currently a small fraction of sessions because consent is off by default,
  // so an optional-event count is a floor over consenting players, never a
  // population count. Divide optional by optional; never divide an optional
  // numerator by an essential denominator.

  // The lifecycle counterpart of app_session_started. Without it there is no
  // session length, and without session length "engagement" is unmeasurable —
  // a bounced tab and an hour of play are the same single session_started row.
  // Every dimension here is derived from the counts it already carries.
  app_session_ended: spec(
    "essential",
    ["end_reason", "session_depth"],
    ["session_seconds", "hands_completed", "matches_entered", "queue_entries"],
  ),

  // The consent gate measured on its own terms. Essential because it has to be
  // recordable at the moment consent is *withdrawn*, and because the rate at
  // which players opt in is the denominator that makes every optional event
  // below interpretable.
  analytics_consent_changed: spec("essential", ["outcome", "surface"]),

  // Guest to linked account: the conversion that unlocks ranked play, friends,
  // and any durable relationship with the player. AGS IAM records that an
  // upgrade happened; it cannot record the offer that was shown and ignored,
  // or the step where the flow broke, which is where the funnel actually
  // leaks. Account lifecycle, so essential.
  account_upgrade_step: spec("essential", ["step", "surface", "reason_code"]),

  // The activation ladder — one row per rung per player, ever. This is the
  // event the growth loop is built on: everything upstream of the first
  // completed hand is acquisition spend, and everything downstream is
  // retention.
  activation_milestone: spec(
    "optional",
    ["milestone", "mode", "session_count_band"],
    ["minutes_since_first_session"],
  ),

  // Leaving a table with a hand still live. The clearest voluntary churn
  // signal the client can see, and the phase says whether players quit when
  // bored (early) or when beaten (late).
  match_abandoned: spec(
    "optional",
    ["mode", "phase", "taken_over"],
    ["wall_remaining"],
  ),

  // Jade against the thresholds that gate play. A player at "empty" cannot
  // enter Bamboo Courtyard at all, which makes this the economy's churn edge
  // rather than a vanity balance metric.
  economy_checkpoint: spec(
    "optional",
    ["balance_band", "eligible", "trigger"],
    ["available", "minimum_balance"],
  ),

  // Whether the recovery faucet actually recovers anybody: offered, claimed,
  // and what happened next.
  economy_recovery: spec(
    "optional",
    ["outcome", "reason", "balance_band"],
    ["amount"],
  ),

  // Levelling is the retention hook the game already ships. Whether players
  // reach the levels that unlock rewards — and how long that takes — decides
  // whether the hook is set at the right place on the curve.
  progression_level_up: spec(
    "optional",
    ["level_band", "source"],
    ["level", "lifetime_xp"],
  ),

  // The social loop, which in a four-seat game is also the acquisition loop:
  // a player with friends brings the other three seats with them.
  social_action: spec("optional", ["action", "outcome", "surface"]),

  // Feature adoption, including the one the game just shipped: a non-English
  // locale is a market signal, not a preference toggle.
  feature_engaged: spec("optional", ["feature", "value", "surface"]),
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
