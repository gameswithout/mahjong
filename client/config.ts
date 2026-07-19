export interface AccelByteWebConfig {
  baseURL: string;
  namespace: string;
  clientId: string;
  matchRuntimeURL?: string;
  matchPool?: string;
  sessionTemplate?: string;
  sessionClientVersion?: string;
}

export const accelByteConfig: AccelByteWebConfig = {
  baseURL: import.meta.env.ACCELBYTE_BASE_URL,
  namespace: import.meta.env.ACCELBYTE_NAMESPACE,
  clientId: import.meta.env.ACCELBYTE_CLIENT_ID,
  matchRuntimeURL: import.meta.env.ACCELBYTE_MATCH_RUNTIME_URL,
  matchPool: import.meta.env.ACCELBYTE_MATCH_POOL,
  sessionTemplate: import.meta.env.ACCELBYTE_SESSION_TEMPLATE,
  sessionClientVersion: import.meta.env.ACCELBYTE_SESSION_CLIENT_VERSION,
};

export function assertAccelByteConfig(config: AccelByteWebConfig = accelByteConfig): void {
  if (!config.baseURL || !config.namespace || !config.clientId) {
    throw new Error("AGS browser configuration is incomplete.");
  }
}
