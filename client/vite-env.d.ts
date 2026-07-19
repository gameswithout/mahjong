/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly ACCELBYTE_BASE_URL: string;
  readonly ACCELBYTE_NAMESPACE: string;
  readonly ACCELBYTE_CLIENT_ID: string;
  readonly ACCELBYTE_MATCH_POOL: string;
  readonly ACCELBYTE_SESSION_TEMPLATE: string;
  readonly ACCELBYTE_SESSION_CLIENT_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
