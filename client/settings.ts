import type { AccelByteWebSdk } from "./iam";

export const PLAYER_SETTINGS_RECORD_KEY = "mahjong-player-settings";
const PLAYER_SETTINGS_CACHE_PREFIX = `${PLAYER_SETTINGS_RECORD_KEY}:`;

export interface PlayerSettings {
  showTutorial: boolean;
  optionalAnalyticsConsent: boolean;
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  showTutorial: true,
  optionalAnalyticsConsent: false,
};

interface AxiosLike {
  get(url: string): Promise<{ data?: unknown }>;
  put(url: string, body: unknown): Promise<{ data?: unknown }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
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
