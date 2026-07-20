import { AccelByte } from "@accelbyte/sdk";
import { OAuth20Api, OAuth20V4Api, UsersApi, UsersV4Api } from "@accelbyte/sdk-iam";

import { accelByteConfig, assertAccelByteConfig, type AccelByteWebConfig } from "./config";
import { browserDeviceIdStore, type DeviceIdStore } from "./device-id";

export type IamAuthErrorCode =
  | "configuration"
  | "device_login_disabled"
  | "invalid_client"
  | "network"
  | "current_user"
  | "invalid_credentials"
  | "registration_failed"
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

export interface EmailIdentity {
  userId: string;
}

// §10.2/§10.3: AGS IAM's native EMAILPASSWD registration — a verification
// code (obtained separately via requestEmailVerificationCode) is supplied
// up front so the account is created already-verified, rather than
// registering first and verifying after. birthYear/birthMonth only (never
// a full birth date) per §10.3's "full birth date is not retained" rule;
// the day is synthesized when calling AGS, which requires a full date.
export interface EmailRegistrationInput {
  email: string;
  username: string;
  password: string;
  country: string;
  birthYear: number;
  birthMonth: number;
  code: string;
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
  requestEmailVerificationCode?(email: string): Promise<void>;
  registerWithEmailPassword?(input: EmailRegistrationInput): Promise<void>;
  loginWithEmailPassword?(email: string, password: string): Promise<TokenResponse>;
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

// AGS's OAuth token endpoint uses {error, error_description}; its plain
// REST endpoints (registration, verification codes) use {errorMessage}.
// Both are safe, user-facing strings (e.g. "email already exists"), unlike
// the raw error object, which must never reach the UI.
function apiErrorDescription(error: unknown): string {
  if (!error || typeof error !== "object" || !("response" in error)) {
    return "";
  }

  const response = error.response;
  if (!response || typeof response !== "object" || !("data" in response)) {
    return "";
  }

  const data = response.data;
  if (!data || typeof data !== "object") {
    return "";
  }

  if ("error_description" in data && typeof data.error_description === "string") {
    return data.error_description;
  }
  if ("errorMessage" in data && typeof data.errorMessage === "string") {
    return data.errorMessage;
  }
  return "";
}

type IamOperation = "login" | "current_user" | "email_login" | "register" | "request_code";

const UNKNOWN_MESSAGE_BY_OPERATION: Record<IamOperation, string> = {
  login: "Guest sign-in failed. Please retry.",
  current_user: "Guest sign-in failed. Please retry.",
  email_login: "Sign-in failed. Please retry.",
  register: "Account creation failed. Please retry.",
  request_code: "Could not send a verification code. Please retry.",
};

function mapAuthError(error: unknown, operation: IamOperation): IamAuthError {
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

  if (operation === "email_login" && (status === 400 || status === 401 || status === 403)) {
    return new IamAuthError(
      "invalid_credentials",
      "Incorrect email or password.",
      { cause: error },
    );
  }

  if ((operation === "register" || operation === "request_code") && status !== undefined && status < 500) {
    const description = apiErrorDescription(error);
    return new IamAuthError(
      "registration_failed",
      description || UNKNOWN_MESSAGE_BY_OPERATION[operation],
      { cause: error },
    );
  }

  if (isNetworkFailure(error)) {
    return new IamAuthError("network", "AGS could not be reached. Check your connection and retry.", {
      cause: error,
    });
  }

  return new IamAuthError("unknown", UNKNOWN_MESSAGE_BY_OPERATION[operation], { cause: error });
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

    async requestEmailVerificationCode(email) {
      try {
        const sdk = createSdk(config);
        await UsersApi(sdk).createUserCodeRequest_v3({ emailAddress: email });
      } catch (error) {
        throw mapAuthError(error, "request_code");
      }
    },

    async registerWithEmailPassword(input) {
      try {
        const sdk = createSdk(config);
        const dateOfBirth = `${input.birthYear}-${String(input.birthMonth).padStart(2, "0")}-01`;
        await UsersV4Api(sdk).createUser_v4({
          authType: "EMAILPASSWD",
          emailAddress: input.email,
          username: input.username,
          password: input.password,
          country: input.country,
          dateOfBirth,
          code: input.code,
        });
      } catch (error) {
        throw mapAuthError(error, "register");
      }
    },

    async loginWithEmailPassword(email, password) {
      try {
        // Deliberately not IamUserAuthorizationClient.loginWithPasswordAuthorization:
        // that helper builds its Basic auth header from the bare Node
        // `Buffer` global (only safe here because @accelbyte/sdk's browser
        // entry happens to polyfill window.Buffer as an import side effect).
        // postOauthToken_v3 with grant_type "password" is the same
        // underlying call, built the same explicit, self-contained way
        // loginWithDeviceId already uses (Basic auth header via btoa).
        const sdk = createSdk(config, {
          Authorization: basicClientHeader(config.clientId),
        });
        const response = await OAuth20Api(sdk).postOauthToken_v3({
          grant_type: "password",
          username: email,
          password,
          client_id: config.clientId,
        });
        return response.data as TokenResponse;
      } catch (error) {
        throw mapAuthError(error, "email_login");
      }
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

  async requestEmailVerificationCode(email: string): Promise<void> {
    if (!this.transport.requestEmailVerificationCode) {
      throw new IamAuthError("configuration", "Email registration is not available.");
    }
    await this.transport.requestEmailVerificationCode(email);
  }

  async registerWithEmail(input: EmailRegistrationInput): Promise<void> {
    if (!this.transport.registerWithEmailPassword) {
      throw new IamAuthError("configuration", "Email registration is not available.");
    }
    await this.transport.registerWithEmailPassword(input);
  }

  async loginWithEmail(email: string, password: string): Promise<EmailIdentity> {
    if (!this.transport.loginWithEmailPassword) {
      throw new IamAuthError("configuration", "Email sign-in is not available.");
    }
    const token = await this.transport.loginWithEmailPassword(email, password);
    if (typeof token.access_token !== "string" || token.access_token.length === 0) {
      throw new IamAuthError("unknown", "AGS returned an invalid session.");
    }

    const user = await this.transport.getCurrentUser(token.access_token);
    if (typeof user.userId !== "string" || user.userId.length === 0) {
      throw new IamAuthError("current_user", "AGS returned an invalid profile.");
    }

    this.accessToken = token.access_token;
    return { userId: user.userId };
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
