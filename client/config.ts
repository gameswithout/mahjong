export interface AccelByteWebConfig {
  baseURL: string;
  namespace: string;
  clientId: string;
  matchServiceURL?: string;
  matchPool?: string;
  sessionTemplate?: string;
  sessionClientVersion?: string;
  // AGS TURN Manager endpoint used to fetch short-lived relay (TURN)
  // credentials for video chat. It lives on the same AGS base URL, so it is
  // derived from baseURL by default; ACCELBYTE_ICE_CONFIG_URL can override it.
  iceConfigURL?: string;
}

const baseURL = import.meta.env.ACCELBYTE_BASE_URL;

export const accelByteConfig: AccelByteWebConfig = {
  baseURL,
  namespace: import.meta.env.ACCELBYTE_NAMESPACE,
  clientId: import.meta.env.ACCELBYTE_CLIENT_ID,
  matchServiceURL: import.meta.env.ACCELBYTE_MATCH_SERVICE_URL,
  matchPool: import.meta.env.ACCELBYTE_MATCH_POOL,
  sessionTemplate: import.meta.env.ACCELBYTE_SESSION_TEMPLATE,
  sessionClientVersion: import.meta.env.ACCELBYTE_SESSION_CLIENT_VERSION,
  iceConfigURL:
    import.meta.env.ACCELBYTE_ICE_CONFIG_URL || (baseURL ? `${baseURL}/turnmanager/turn` : undefined),
};

export function assertAccelByteConfig(config: AccelByteWebConfig = accelByteConfig): void {
  if (!config.baseURL || !config.namespace || !config.clientId) {
    throw new Error("AGS browser configuration is incomplete.");
  }
}
