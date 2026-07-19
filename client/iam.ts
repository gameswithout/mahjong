import { AccelByte } from "@accelbyte/sdk";
import { OAuth20V4Api, UsersApi } from "@accelbyte/sdk-iam";

import { accelByteConfig, assertAccelByteConfig, type AccelByteWebConfig } from "./config";
import { browserDeviceIdStore, type DeviceIdStore } from "./device-id";

export type IamAuthErrorCode =
  | "configuration"
  | "device_login_disabled"
  | "invalid_client"
  | "network"
  | "current_user"
  | "unknown";

export class IamAuthError extends Error {
  constructor(
    readonly code: IamAuthErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "IamAuthError";
  }
}

export interface GuestIdentity {
  userId: string;
  deviceId: string;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
}

interface UserResponse {
  userId?: unknown;
}

export interface IamTransport {
  loginWithDeviceId(deviceId: string): Promise<TokenResponse>;
  getCurrentUser(accessToken: string): Promise<UserResponse>;
  createAuthenticatedSdk?(accessToken: string): AccelByteWebSdk;
}

export type AccelByteWebSdk = ReturnType<typeof AccelByte.SDK>;

function basicClientHeader(clientId: string): string {
  return `Basic ${btoa(`${clientId}:`)}`;
}

function createSdk(
  config: AccelByteWebConfig,
  requestHeaders?: Record<string, string>,
): AccelByteWebSdk {
  return AccelByte.SDK({
    coreConfig: {
      baseURL: config.baseURL,
      clientId: config.clientId,
      namespace: config.namespace,
      redirectURI: window.location.origin,
    },
    axiosConfig: {
      request: {
        headers: requestHeaders,
        withCredentials: false,
      },
    },
    webSocketConfig: {
      allowReconnect: true,
      maxReconnectAttempts: 3,
    },
  });
}

function apiStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const response = "response" in error ? error.response : undefined;
  if (!response || typeof response !== "object" || !("status" in response)) {
    return undefined;
  }

  return typeof response.status === "number" ? response.status : undefined;
}

function isNetworkFailure(error: unknown): boolean {
  return apiStatus(error) === undefined;
}

function apiErrorDescription(error: unknown): string {
  if (!error || typeof error !== "object" || !("response" in error)) {
    return "";
  }

  const response = error.response;
  if (!response || typeof response !== "object" || !("data" in response)) {
    return "";
  }

  const data = response.data;
  if (!data || typeof data !== "object" || !("error_description" in data)) {
    return "";
  }

  return typeof data.error_description === "string" ? data.error_description : "";
}

function mapAuthError(error: unknown, operation: "login" | "current_user"): IamAuthError {
  if (error instanceof IamAuthError) {
    return error;
  }

  const status = apiStatus(error);
  if (
    operation === "login" &&
    (status === 400 || status === 404 ||
      apiErrorDescription(error).toLowerCase().includes("platform login config is disabled"))
  ) {
    return new IamAuthError(
      "device_login_disabled",
      "Device ID guest login is not enabled for this project.",
      { cause: error },
    );
  }

  if (operation === "login" && (status === 401 || status === 403)) {
    return new IamAuthError("invalid_client", "The browser IAM client was rejected.", {
      cause: error,
    });
  }

  if (operation === "current_user" && (status === 401 || status === 403)) {
    return new IamAuthError("current_user", "AGS could not verify the guest session.", {
      cause: error,
    });
  }

  if (isNetworkFailure(error)) {
    return new IamAuthError("network", "AGS could not be reached. Check your connection and retry.", {
      cause: error,
    });
  }

  return new IamAuthError("unknown", "Guest sign-in failed. Please retry.", { cause: error });
}

export function createSdkIamTransport(config: AccelByteWebConfig = accelByteConfig): IamTransport {
  assertAccelByteConfig(config);

  return {
    async loginWithDeviceId(deviceId) {
      try {
        const sdk = createSdk(config, {
          Authorization: basicClientHeader(config.clientId),
          "Device-Id": deviceId,
        });
        const response = await OAuth20V4Api(sdk).postTokenOauth_ByPlatformId_v4("device", {
          client_id: config.clientId,
          createHeadless: true,
          device_id: deviceId,
          skipSetCookie: true,
        });
        return response.data as TokenResponse;
      } catch (error) {
        throw mapAuthError(error, "login");
      }
    },

    async getCurrentUser(accessToken) {
      try {
        const sdk = createSdk(config);
        sdk.setToken({ accessToken });
        const response = await UsersApi(sdk).getUsersMe_v3();
        return response.data as UserResponse;
      } catch (error) {
        throw mapAuthError(error, "current_user");
      }
    },

    createAuthenticatedSdk(accessToken) {
      const sdk = createSdk(config);
      sdk.setToken({ accessToken });
      return sdk;
    },
  };
}

export class BrowserIam {
  private accessToken: string | null = null;

  constructor(
    private readonly transport: IamTransport,
    private readonly deviceIdStore: DeviceIdStore = browserDeviceIdStore,
  ) {}

  async loginAsGuest(): Promise<GuestIdentity> {
    const deviceId = this.deviceIdStore.getOrCreate();
    const token = await this.transport.loginWithDeviceId(deviceId);
    if (typeof token.access_token !== "string" || token.access_token.length === 0) {
      throw new IamAuthError("unknown", "AGS returned an invalid guest session.");
    }

    const user = await this.transport.getCurrentUser(token.access_token);
    if (typeof user.userId !== "string" || user.userId.length === 0) {
      throw new IamAuthError("current_user", "AGS returned an invalid guest profile.");
    }

    this.accessToken = token.access_token;
    return { deviceId, userId: user.userId };
  }

  getAuthenticatedSdk(): AccelByteWebSdk {
    if (!this.accessToken || !this.transport.createAuthenticatedSdk) {
      throw new IamAuthError("configuration", "Guest sign-in is required before connecting Lobby.");
    }

    return this.transport.createAuthenticatedSdk(this.accessToken);
  }

  // The token remains in memory and is exposed only to the local runtime
  // transport boundary. Callers must never persist, render, or log it.
  getAccessToken(): string {
    if (!this.accessToken) {
      throw new IamAuthError("configuration", "Guest sign-in is required before connecting the match runtime.");
    }
    return this.accessToken;
  }
}

export function createBrowserIam(): BrowserIam {
  return new BrowserIam(createSdkIamTransport());
}
