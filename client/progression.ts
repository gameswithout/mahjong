import type {
  HandXPAward,
  LevelStep,
  LevelReward,
  OnboardingOutcome,
  PlayerAchievement,
  PlayerProgression,
  XPComponent,
} from "../protocol/envelope";

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
  // All 50 §12.2 thresholds, served rather than hard-coded, so the client
  // cannot drift from the server's curve or reward table.
  curve: LevelStep[];
}

export interface OnboardingAwardResult {
  progression: PlayerProgression;
  award: HandXPAward;
  // False on an idempotent replay; award still describes the original grant.
  granted: boolean;
}

export interface ProgressionClient {
  get(): Promise<ProgressionSnapshot>;
  getAchievements(): Promise<PlayerAchievement[]>;
  // §10.4: the award is the same either way, but which exit the player took
  // is recorded, so the outcome is required rather than assumed.
  awardOnboarding(outcome: OnboardingOutcome): Promise<OnboardingAwardResult>;
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

function numericValue(value: unknown, fallback = 0): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new ProgressionError(
    "protocol",
    "Progression returned a non-numeric value where XP was expected.",
  );
}

function readReward(value: unknown): LevelReward | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const reward = value as Record<string, unknown>;
  if (
    typeof reward.name !== "string" ||
    typeof reward.kind !== "string"
  ) {
    return null;
  }
  return {
    code: typeof reward.code === "string" ? reward.code : undefined,
    level: numericValue(reward.level),
    kind: reward.kind,
    name: reward.name,
  };
}

function readRewards(value: unknown): LevelReward[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const reward = readReward(entry);
    return reward ? [reward] : [];
  });
}

function field(raw: Record<string, unknown>, protoName: string, jsonName: string): unknown {
  return raw[protoName] !== undefined ? raw[protoName] : raw[jsonName];
}

export function normalizePlayerProgression(value: unknown): PlayerProgression {
  if (!value || typeof value !== "object") {
    // protojson omits zero values, so an entirely absent progression object is
    // a legitimate level-1 account rather than a malformed response.
    return {
      level: 1,
      lifetime_xp: 0,
      xp_into_level: 0,
      xp_for_next_level: 0,
      at_cap: false,
      earned: [],
    };
  }
  const raw = value as Record<string, unknown>;
  const next = readReward(raw.next);
  const onboarding =
    raw.onboarding && typeof raw.onboarding === "object"
      ? (raw.onboarding as Record<string, unknown>)
      : null;
  return {
    level: numericValue(raw.level, 1),
    lifetime_xp: numericValue(field(raw, "lifetime_xp", "lifetimeXp")),
    xp_into_level: numericValue(field(raw, "xp_into_level", "xpIntoLevel")),
    xp_for_next_level: numericValue(field(raw, "xp_for_next_level", "xpForNextLevel")),
    at_cap: field(raw, "at_cap", "atCap") === true,
    earned: readRewards(raw.earned),
    next: next ?? undefined,
    onboarding:
      onboarding && typeof onboarding.outcome === "string"
        ? {
            outcome: onboarding.outcome,
            recorded_at:
              typeof field(onboarding, "recorded_at", "recordedAt") === "string"
                ? field(onboarding, "recorded_at", "recordedAt") as string
                : undefined,
          }
        : undefined,
  };
}

function readCurve(value: unknown): LevelStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const step = entry as Record<string, unknown>;
    const level = numericValue(step.level);
    if (level < 1) {
      return [];
    }
    return [{
      level,
      total_xp_required: numericValue(field(step, "total_xp_required", "totalXpRequired")),
      xp_for_next_level: numericValue(field(step, "xp_for_next_level", "xpForNextLevel")),
      rewards: readRewards(step.rewards),
    }];
  });
}

export function normalizeHandXPAward(value: unknown): HandXPAward | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const components: XPComponent[] = Array.isArray(raw.components)
    ? raw.components.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const component = entry as Record<string, unknown>;
        if (typeof component.label !== "string") {
          return [];
        }
        return [{
          code: typeof component.code === "string" ? component.code : undefined,
          label: component.label,
          amount: numericValue(component.amount),
        }];
      })
    : [];
  return {
    award_id:
      typeof field(raw, "award_id", "awardId") === "string"
        ? field(raw, "award_id", "awardId") as string
        : undefined,
    source: typeof raw.source === "string" ? raw.source : undefined,
    total: numericValue(raw.total),
    components,
    capped_by_daily: field(raw, "capped_by_daily", "cappedByDaily") === true,
  };
}

export function normalizePlayerAchievements(value: unknown): PlayerAchievement[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const raw = entry as Record<string, unknown>;
    if (
      typeof raw.code !== "string" ||
      typeof raw.name !== "string" ||
      typeof raw.description !== "string"
    ) {
      return [];
    }
    return [{
      code: raw.code,
      name: raw.name,
      description: raw.description,
      current: numericValue(raw.current),
      goal: numericValue(raw.goal),
      xp_reward: numericValue(field(raw, "xp_reward", "xpReward")),
      bonus_reward:
        typeof field(raw, "bonus_reward", "bonusReward") === "string" &&
        field(raw, "bonus_reward", "bonusReward")
          ? field(raw, "bonus_reward", "bonusReward") as string
          : undefined,
      // protojson omits false booleans, so strict true checks are deliberate.
      eligible: raw.eligible === true,
      unlocked: raw.unlocked === true,
      unavailable_reason:
        typeof field(raw, "unavailable_reason", "unavailableReason") === "string" &&
        field(raw, "unavailable_reason", "unavailableReason")
          ? field(raw, "unavailable_reason", "unavailableReason") as string
          : undefined,
    }];
  });
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
  const serviceURL = options.url.replace(/\/+$/, "");
  const path = `${serviceURL}/v1/namespaces/${encodeURIComponent(options.namespace)}`;

  async function request(
    method: "GET" | "POST",
    resource: "progression" | "achievements",
    suffix = "",
    payload: Record<string, unknown> = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${path}/${resource}${suffix}`, {
        method,
        cache: method === "GET" ? "no-store" : undefined,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body: method === "POST" ? JSON.stringify(payload) : undefined,
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
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new ProgressionError("network", "Progression response could not be read.", {
        cause: error,
      });
    }
    if (!text.trim() || contentType.includes("text/html")) {
      throw new ProgressionError(
        "network",
        "Progression is temporarily unavailable. Please retry.",
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new ProgressionError(
        "network",
        "Progression is temporarily unavailable. Please retry.",
        { cause: error },
      );
    }
  }

  return {
    async get() {
      const body = (await request("GET", "progression")) as {
        progression?: unknown;
        curve?: unknown;
      };
      return {
        progression: normalizePlayerProgression(body.progression),
        curve: readCurve(body.curve),
      };
    },
    async getAchievements() {
      const body = (await request("GET", "achievements")) as {
        achievements?: unknown;
      };
      return normalizePlayerAchievements(body.achievements);
    },
    async awardOnboarding(outcome: OnboardingOutcome) {
      const body = (await request("POST", "progression", "/onboarding", { outcome })) as {
        progression?: unknown;
        award?: unknown;
        granted?: unknown;
      };
      return {
        progression: normalizePlayerProgression(body.progression),
        award: normalizeHandXPAward(body.award) ?? {},
        // protojson omits a false bool.
        granted: body.granted === true,
      };
    },
  };
}
