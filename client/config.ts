export interface AccelByteWebConfig {
  baseURL: string;
  namespace: string;
  clientId: string;
  sessionURL?: string;
  matchServiceURL?: string;
  matchPool?: string;
  // §8.4 Full Rotation queues into its own pool. It cannot share Quick Play's:
  // that pool's session template stakes Jade and produces a single-hand match,
  // and Full Rotation is ranked, unstaked, and several hands long. The pool's
  // session template is what carries full_rotation=true to the match service,
  // so a client cannot fake it by sending attributes of its own.
  rotationMatchPool?: string;
  sessionTemplate?: string;
  sessionClientVersion?: string;
  // §8.6 party session template. Separate from sessionTemplate: a party is its
  // own AGS session, INVITE_ONLY and 4 seats, and it exists only to carry a
  // group into matchmaking together.
  partyTemplate?: string;
  // AGS TURN Manager endpoint used to fetch short-lived relay (TURN)
  // credentials for video chat. It lives on the same AGS base URL, so it is
  // derived from baseURL by default; ACCELBYTE_ICE_CONFIG_URL can override it.
  iceConfigURL?: string;
}

export interface XsollaLoginConfig {
  // Public Xsolla Login project identifier (also called the Login ID).
  projectId: string;
  // Public browser OAuth client identifier. Its secret must never be bundled.
  oauthClientId: string;
}

// The AccelByte SDK requires an absolute URL. Vite's local reverse proxy is
// intentionally configured as a relative path so it follows either localhost
// or 127.0.0.1; resolve that path against the page origin before SDK creation.
export function resolveBrowserBaseURL(configured: string, origin: string): string {
  return configured?.startsWith("/")
    ? new URL(configured, origin).toString().replace(/\/$/, "")
    : configured;
}

const baseURL = resolveBrowserBaseURL(
  import.meta.env.ACCELBYTE_BASE_URL,
  window.location.origin,
);
const matchServiceURL = resolveBrowserBaseURL(
  import.meta.env.ACCELBYTE_MATCH_SERVICE_URL,
  window.location.origin,
);
const sessionURL = resolveBrowserBaseURL(
  import.meta.env.ACCELBYTE_SESSION_URL,
  window.location.origin,
);

export const accelByteConfig: AccelByteWebConfig = {
  baseURL,
  namespace: import.meta.env.ACCELBYTE_NAMESPACE,
  clientId: import.meta.env.ACCELBYTE_CLIENT_ID,
  sessionURL,
  matchServiceURL,
  matchPool: import.meta.env.ACCELBYTE_MATCH_POOL,
  rotationMatchPool: import.meta.env.ACCELBYTE_ROTATION_MATCH_POOL,
  sessionTemplate: import.meta.env.ACCELBYTE_SESSION_TEMPLATE,
  sessionClientVersion: import.meta.env.ACCELBYTE_SESSION_CLIENT_VERSION,
  partyTemplate: import.meta.env.ACCELBYTE_PARTY_TEMPLATE || "mahjong-party",
  iceConfigURL:
    import.meta.env.ACCELBYTE_ICE_CONFIG_URL || (baseURL ? `${baseURL}/turnmanager/turn` : undefined),
};

export const xsollaLoginConfig: XsollaLoginConfig = {
  projectId: import.meta.env.XSOLLA_LOGIN_PROJECT_ID,
  oauthClientId: import.meta.env.XSOLLA_OAUTH_CLIENT_ID,
};

export function assertAccelByteConfig(config: AccelByteWebConfig = accelByteConfig): void {
  if (!config.baseURL || !config.namespace || !config.clientId) {
    throw new Error("AGS browser configuration is incomplete.");
  }
}

export function assertXsollaLoginConfig(
  config: XsollaLoginConfig = xsollaLoginConfig,
): void {
  if (!config.projectId) {
    throw new Error("Xsolla Login configuration is incomplete.");
  }
}
