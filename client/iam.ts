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
  | "not_a_guest"
  | "upgrade_failed"
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
  // False when the device ID resolves to an account that was already
  // upgraded: device login keeps working after an upgrade, so returning
  // players still arrive through loginAsGuest and must not be re-offered an
  // account they already have.
  isGuest: boolean;
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

// §10.2 guest→account migration: AGS IAM's *headless upgrade*, deliberately
// not a second registerWithEmailPassword. Upgrading attaches the email
// identity to the account the device ID already owns, so the userId — and
// with it Jade, the wallet, and every other per-user record — survives.
// Registering instead would mint a second, empty account and strand the
// guest's balance on the old one. Same field set as registration (§10.3:
// birthYear/birthMonth only, never a full birth date).
export interface GuestUpgradeInput {
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
  // Present only once an email identity is attached, which is exactly what
  // separates a headless (guest) account from a full one.
  emailAddress?: unknown;
}

export interface IamTransport {
  loginWithDeviceId(deviceId: string): Promise<TokenResponse>;
  getCurrentUser(accessToken: string): Promise<UserResponse>;
  createAuthenticatedSdk?(accessToken: string): AccelByteWebSdk;
  requestEmailVerificationCode?(email: string): Promise<void>;
  registerWithEmailPassword?(input: EmailRegistrationInput): Promise<void>;
  loginWithEmailPassword?(email: string, password: string): Promise<TokenResponse>;
  requestGuestUpgradeCode?(accessToken: string, email: string): Promise<void>;
  upgradeGuestAccount?(accessToken: string, input: GuestUpgradeInput): Promise<void>;
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
// Both are mostly safe, user-facing strings (e.g. "email already exists"),
// unlike the raw error object, which must never reach the UI.
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

// …"mostly": the headless-upgrade endpoint appends an internal identifier to
// its message ("…: code not match, userID: 69c9c424c6d2…"), observed live
// against the gameswithout-mahjong namespace on 2026-07-25. Rendering that
// would put an opaque account ID in front of the player, so any message
// carrying one is dropped in favour of our own copy.
function playerSafeDescription(error: unknown): string {
  const description = apiErrorDescription(error);
  return /userid\s*:/i.test(description) ? "" : description;
}

// AGS returns 403 — not 400 — for a verification code that is missing or
// wrong (10152 "verification code not found", 10138 "code not match"), so
// status alone cannot separate a bad code from a non-upgradable account.
const UPGRADE_CODE_REJECTED_ERROR_CODES = new Set([10138, 10152]);

function apiErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("response" in error)) {
    return undefined;
  }
  const response = error.response;
  if (!response || typeof response !== "object" || !("data" in response)) {
    return undefined;
  }
  const data = response.data;
  if (!data || typeof data !== "object" || !("errorCode" in data)) {
    return undefined;
  }
  return typeof data.errorCode === "number" ? data.errorCode : undefined;
}

export type IamOperation =
  | "login"
  | "current_user"
  | "email_login"
  | "register"
  | "request_code"
  | "upgrade"
  | "request_upgrade_code";

const UNKNOWN_MESSAGE_BY_OPERATION: Record<IamOperation, string> = {
  login: "Guest sign-in failed. Please retry.",
  current_user: "Guest sign-in failed. Please retry.",
  email_login: "Sign-in failed. Please retry.",
  register: "Account creation failed. Please retry.",
  request_code: "Could not send a verification code. Please retry.",
  upgrade: "Account creation failed. Please retry.",
  request_upgrade_code: "Could not send a verification code. Please retry.",
};

// Exported for tests: this is where every AGS failure shape is turned into
// the one string a player sees, so it is worth pinning against the payloads
// AGS actually returns.
export function mapAuthError(error: unknown, operation: IamOperation): IamAuthError {
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

  if (operation === "upgrade" && status !== undefined && status < 500) {
    if (UPGRADE_CODE_REJECTED_ERROR_CODES.has(apiErrorCode(error) ?? -1)) {
      return new IamAuthError(
        "upgrade_failed",
        "That verification code is not valid or has expired. Request a new one.",
        { cause: error },
      );
    }

    // An account that already carries an email identity cannot be upgraded
    // again. Retrying will not help, so it gets its own code and copy.
    if (/already|not headless|not a headless/i.test(apiErrorDescription(error))) {
      return new IamAuthError("not_a_guest", "This account already has email sign-in.", {
        cause: error,
      });
    }

    return new IamAuthError(
      "upgrade_failed",
      playerSafeDescription(error) || UNKNOWN_MESSAGE_BY_OPERATION.upgrade,
      { cause: error },
    );
  }

  if (operation === "request_upgrade_code" && status !== undefined && status < 500) {
    return new IamAuthError(
      "upgrade_failed",
      playerSafeDescription(error) || UNKNOWN_MESSAGE_BY_OPERATION.request_upgrade_code,
      { cause: error },
    );
  }

  if ((operation === "register" || operation === "request_code") && status !== undefined && status < 500) {
    return new IamAuthError(
      "registration_failed",
      playerSafeDescription(error) || UNKNOWN_MESSAGE_BY_OPERATION[operation],
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

    // Unlike the registration code request, this one is authenticated as the
    // guest and carries the "upgradeHeadlessAccount" context, so AGS issues a
    // code that only the headless/code/verify endpoint below will accept.
    async requestGuestUpgradeCode(accessToken, email) {
      try {
        const sdk = createSdk(config);
        sdk.setToken({ accessToken });
        await UsersApi(sdk).createUserMeCodeRequest_v3({
          emailAddress: email,
          context: "upgradeHeadlessAccount",
        });
      } catch (error) {
        throw mapAuthError(error, "request_upgrade_code");
      }
    },

    async upgradeGuestAccount(accessToken, input) {
      try {
        const sdk = createSdk(config);
        sdk.setToken({ accessToken });
        const dateOfBirth = `${input.birthYear}-${String(input.birthMonth).padStart(2, "0")}-01`;
        await UsersV4Api(sdk).createUserMeHeadlesCodeVerify_v4({
          code: input.code,
          emailAddress: input.email,
          username: input.username,
          password: input.password,
          country: input.country,
          dateOfBirth,
          reachMinimumAge: true,
        });
      } catch (error) {
        throw mapAuthError(error, "upgrade");
      }
    },
  };
}

type IdentityKind = "guest" | "full";

export class BrowserIam {
  private accessToken: string | null = null;
  private identityKind: IdentityKind | null = null;

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

    const hasEmailIdentity = typeof user.emailAddress === "string" && user.emailAddress.length > 0;
    this.accessToken = token.access_token;
    this.identityKind = hasEmailIdentity ? "full" : "guest";
    return { deviceId, userId: user.userId, isGuest: !hasEmailIdentity };
  }

  // A guest is exactly a headless account: signed in by device ID with no
  // email identity attached yet. Only such an account can be upgraded.
  isGuest(): boolean {
    return this.identityKind === "guest";
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
    this.identityKind = "full";
    return { userId: user.userId };
  }

  async requestGuestUpgradeCode(email: string): Promise<void> {
    if (!this.transport.requestGuestUpgradeCode) {
      throw new IamAuthError("configuration", "Account creation is not available.");
    }
    if (!this.isGuest()) {
      throw new IamAuthError("not_a_guest", "This account already has email sign-in.");
    }
    await this.transport.requestGuestUpgradeCode(this.getAccessToken(), email);
  }

  // The guest's access token stays valid across the upgrade — AGS attaches
  // the email identity to the same account rather than issuing a new one —
  // so nothing here re-authenticates. That keeps the live Lobby connection
  // and any match the player is sitting in untouched.
  async upgradeGuestAccount(input: GuestUpgradeInput): Promise<void> {
    if (!this.transport.upgradeGuestAccount) {
      throw new IamAuthError("configuration", "Account creation is not available.");
    }
    if (!this.isGuest()) {
      throw new IamAuthError("not_a_guest", "This account already has email sign-in.");
    }
    await this.transport.upgradeGuestAccount(this.getAccessToken(), input);
    this.identityKind = "full";
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
