import type { AccelByteWebSdk } from "./iam";

export const PLAYER_SETTINGS_RECORD_KEY = "mahjong-player-settings";
const PLAYER_SETTINGS_CACHE_PREFIX = `${PLAYER_SETTINGS_RECORD_KEY}:`;

// How long the table waits before passing for the player when Pass is the only
// legal response. "off" leaves the claim to them. The delay is the point, not a
// loading cost: it is the window in which they read the discard that was just
// made, so the shortest offered value is a second rather than zero.
export const AUTO_PASS_DELAYS = ["off", "1s", "3s", "5s"] as const;
export type AutoPassDelay = (typeof AUTO_PASS_DELAYS)[number];

export function autoPassDelayMs(delay: AutoPassDelay): number {
  switch (delay) {
    case "1s":
      return 1_000;
    case "3s":
      return 3_000;
    case "5s":
      return 5_000;
    default:
      return 0;
  }
}

export interface PlayerSettings {
  showTutorial: boolean;
  optionalAnalyticsConsent: boolean;
  // Whether the player has been asked about optional analytics and answered.
  // Distinct from the consent itself, because "declined" and "never asked"
  // are both `optionalAnalyticsConsent: false` and only one of them should
  // produce a prompt. Stored with the settings so answering on one device
  // does not mean being asked again on the next.
  analyticsConsentDecided: boolean;
  expertHud: boolean;
  autoPassDelay: AutoPassDelay;
  // Whether the claim buttons carry their "what this does to your hand"
  // sentence. Off by default: it is the wordiest thing on the table and it is
  // read once and then never again by a player who knows the game.
  claimImpactAnalysis: boolean;
  practiceBotSpeed: "learning" | "normal" | "fast";
  experimentalTableUi: boolean;
  tableLayoutOutlines: boolean;
  handSortMode: "off" | "suit-rank" | "sets";
  tableFxEnabled: boolean;
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  showTutorial: true,
  optionalAnalyticsConsent: false,
  analyticsConsentDecided: false,
  expertHud: false,
  autoPassDelay: "off",
  claimImpactAnalysis: false,
  practiceBotSpeed: "learning",
  experimentalTableUi: false,
  tableLayoutOutlines: true,
  handSortMode: "suit-rank",
  tableFxEnabled: false,
};

interface AxiosLike {
  get(url: string): Promise<{ data?: unknown }>;
  put(url: string, body: unknown): Promise<{ data?: unknown }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isAutoPassDelay(value: unknown): value is AutoPassDelay {
  return AUTO_PASS_DELAYS.includes(value as AutoPassDelay);
}

export function normalizePlayerSettings(value: unknown): PlayerSettings {
  const envelope = isRecord(value) && isRecord(value.value) ? value.value : value;
  if (!isRecord(envelope)) {
    return DEFAULT_PLAYER_SETTINGS;
  }
  return {
    showTutorial:
      typeof envelope.showTutorial === "boolean"
        ? envelope.showTutorial
        : DEFAULT_PLAYER_SETTINGS.showTutorial,
    optionalAnalyticsConsent:
      typeof envelope.optionalAnalyticsConsent === "boolean"
        ? envelope.optionalAnalyticsConsent
        : DEFAULT_PLAYER_SETTINGS.optionalAnalyticsConsent,
    // A record written before this field existed has no answer in it, so it
    // normalizes to "not yet asked" and the player gets the prompt once.
    analyticsConsentDecided:
      typeof envelope.analyticsConsentDecided === "boolean"
        ? envelope.analyticsConsentDecided
        : DEFAULT_PLAYER_SETTINGS.analyticsConsentDecided,
    expertHud:
      typeof envelope.expertHud === "boolean"
        ? envelope.expertHud
        : DEFAULT_PLAYER_SETTINGS.expertHud,
    // autoPassClaims was a boolean before the delay existed, and its "on"
    // meant passing the instant the claim appeared. Nothing that fast is
    // offered now, so it migrates to the shortest delay rather than to off:
    // a player who asked not to click Pass should not have to start again.
    autoPassDelay: isAutoPassDelay(envelope.autoPassDelay)
      ? envelope.autoPassDelay
      : envelope.autoPassClaims === true
        ? "1s"
        : DEFAULT_PLAYER_SETTINGS.autoPassDelay,
    // Deliberately not migrated from compactClaimPrompts. That flag defaulted
    // to "show the impact text", so carrying it across would leave the wordy
    // table switched on for everybody who never touched the setting — which is
    // the thing this replaces.
    claimImpactAnalysis:
      typeof envelope.claimImpactAnalysis === "boolean"
        ? envelope.claimImpactAnalysis
        : DEFAULT_PLAYER_SETTINGS.claimImpactAnalysis,
    practiceBotSpeed:
      envelope.practiceBotSpeed === "learning" ||
      envelope.practiceBotSpeed === "fast" ||
      envelope.practiceBotSpeed === "normal"
        ? envelope.practiceBotSpeed
        : DEFAULT_PLAYER_SETTINGS.practiceBotSpeed,
    experimentalTableUi:
      typeof envelope.experimentalTableUi === "boolean"
        ? envelope.experimentalTableUi
        : DEFAULT_PLAYER_SETTINGS.experimentalTableUi,
    tableLayoutOutlines:
      typeof envelope.tableLayoutOutlines === "boolean"
        ? envelope.tableLayoutOutlines
        : DEFAULT_PLAYER_SETTINGS.tableLayoutOutlines,
    handSortMode:
      envelope.handSortMode === "off" || envelope.handSortMode === "sets" || envelope.handSortMode === "suit-rank"
        ? envelope.handSortMode
        : DEFAULT_PLAYER_SETTINGS.handSortMode,
    tableFxEnabled:
      typeof envelope.tableFxEnabled === "boolean"
        ? envelope.tableFxEnabled
        : DEFAULT_PLAYER_SETTINGS.tableFxEnabled,
  };
}

function recordEndpoint(namespace: string, userId: string): string {
  return (
    `/cloudsave/v1/namespaces/${encodeURIComponent(namespace)}` +
    `/users/${encodeURIComponent(userId)}/records/${PLAYER_SETTINGS_RECORD_KEY}`
  );
}

function responseStatus(error: unknown): number | undefined {
  if (!isRecord(error) || !isRecord(error.response)) {
    return undefined;
  }
  return typeof error.response.status === "number" ? error.response.status : undefined;
}

export interface PlayerSettingsClient {
  get(): Promise<PlayerSettings>;
  getStored(): Promise<PlayerSettings | null>;
  save(settings: PlayerSettings): Promise<PlayerSettings>;
}

function cacheKey(userId: string): string {
  return `${PLAYER_SETTINGS_CACHE_PREFIX}${userId}`;
}

export function loadCachedPlayerSettings(userId: string): PlayerSettings | null {
  try {
    const value = globalThis.localStorage?.getItem(cacheKey(userId));
    return value ? normalizePlayerSettings(JSON.parse(value)) : null;
  } catch {
    return null;
  }
}

export function saveCachedPlayerSettings(userId: string, settings: PlayerSettings): void {
  try {
    globalThis.localStorage?.setItem(cacheKey(userId), JSON.stringify(normalizePlayerSettings(settings)));
  } catch {
    // Private browsing and storage quotas must not block settings changes.
  }
}

export function createPlayerSettingsClient(
  sdk: AccelByteWebSdk,
  namespace: string,
  userId: string,
): PlayerSettingsClient {
  if (!namespace || !userId) {
    throw new Error("Player settings configuration is incomplete.");
  }
  const axios = sdk.assembly().axiosInstance as unknown as AxiosLike;
  const endpoint = recordEndpoint(namespace, userId);

  async function getStored(): Promise<PlayerSettings | null> {
    try {
      const response = await axios.get(endpoint);
      return normalizePlayerSettings(response.data);
    } catch (error) {
      if (responseStatus(error) === 404) {
        return null;
      }
      throw error;
    }
  }

  return {
    async get() {
      return (await getStored()) ?? DEFAULT_PLAYER_SETTINGS;
    },
    getStored,
    async save(settings) {
      const normalized = normalizePlayerSettings(settings);
      await axios.put(endpoint, {
        value: normalized,
        isPublic: false,
      });
      // Cloud Save's PUT response is an acknowledgement envelope rather than
      // the stored record on some AGS deployments. Re-normalizing that empty
      // envelope restores the defaults and makes the tutorial flash back into
      // view immediately after Hide. The accepted payload is authoritative;
      // the next account load will independently read it back from Cloud Save.
      return normalized;
    },
  };
}
