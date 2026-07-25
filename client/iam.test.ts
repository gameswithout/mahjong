import { beforeEach, describe, expect, it } from "vitest";

import { BrowserIam, IamAuthError, type IamTransport } from "./iam";
import { DEVICE_ID_STORAGE_KEY } from "./device-id";

describe("BrowserIam", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("logs in with a stable device identity and proves the current user", async () => {
    const calls: string[] = [];
    const transport: IamTransport = {
      async loginWithDeviceId(deviceId) {
        calls.push(`login:${deviceId}`);
        return { access_token: "in-memory-access-token" };
      },
      async getCurrentUser(accessToken) {
        calls.push(`current-user:${accessToken}`);
        return { userId: "guest-user-123" };
      },
    };

    const iam = new BrowserIam(transport, {
      getOrCreate() {
        const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
        if (existing) return existing;
        const value = "stable-device-id";
        window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, value);
        return value;
      },
    });

    expect(() => iam.getAccessToken()).toThrowError(
      "Guest sign-in is required before connecting the match runtime.",
    );

    await expect(iam.loginAsGuest()).resolves.toEqual({
      deviceId: "stable-device-id",
      userId: "guest-user-123",
      isGuest: true,
    });
    await expect(iam.loginAsGuest()).resolves.toEqual({
      deviceId: "stable-device-id",
      userId: "guest-user-123",
      isGuest: true,
    });

    expect(calls).toEqual([
      "login:stable-device-id",
      "current-user:in-memory-access-token",
      "login:stable-device-id",
      "current-user:in-memory-access-token",
    ]);
    expect(window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)).toBe("stable-device-id");
    expect(iam.getAccessToken()).toBe("in-memory-access-token");
  });

  it("treats a device login that lands on an upgraded account as no longer a guest", async () => {
    const transport: IamTransport = {
      async loginWithDeviceId() {
        return { access_token: "device-access-token" };
      },
      async getCurrentUser() {
        // The device credential still works after an upgrade; the attached
        // email is what says this account no longer needs one.
        return { userId: "upgraded-user-123", emailAddress: "player@example.com" };
      },
    };

    const iam = new BrowserIam(transport);
    await expect(iam.loginAsGuest()).resolves.toMatchObject({ isGuest: false });
    expect(iam.isGuest()).toBe(false);
  });

  it("does not continue when AGS returns no access token", async () => {
    let currentUserCalled = false;
    const transport: IamTransport = {
      async loginWithDeviceId() {
        return {};
      },
      async getCurrentUser() {
        currentUserCalled = true;
        return { userId: "unexpected" };
      },
    };

    await expect(new BrowserIam(transport).loginAsGuest()).rejects.toMatchObject({
      code: "unknown",
    });
    expect(currentUserCalled).toBe(false);
  });

  it("keeps raw transport errors out of the user-facing error", async () => {
    const transport: IamTransport = {
      async loginWithDeviceId() {
        throw new IamAuthError("network", "safe message", {
          cause: new Error("secret-token-must-not-render"),
        });
      },
      async getCurrentUser() {
        return { userId: "unused" };
      },
    };

    await expect(new BrowserIam(transport).loginAsGuest()).rejects.toMatchObject({
      code: "network",
      message: "safe message",
    });
  });

  describe("email/password (E4.F3)", () => {
    const emailInput = {
      email: "player@example.com",
      username: "player1",
      password: "correct horse battery staple",
      country: "US",
      birthYear: 1990,
      birthMonth: 5,
      code: "123456",
    };

    it("requests a verification code, registers, and logs in with email/password", async () => {
      const calls: string[] = [];
      const transport: IamTransport = {
        async loginWithDeviceId() {
          throw new Error("unused");
        },
        async getCurrentUser(accessToken) {
          calls.push(`current-user:${accessToken}`);
          return { userId: "email-user-123" };
        },
        async requestEmailVerificationCode(email) {
          calls.push(`request-code:${email}`);
        },
        async registerWithEmailPassword(input) {
          calls.push(`register:${input.email}:${input.code}`);
        },
        async loginWithEmailPassword(email, password) {
          calls.push(`login:${email}:${password}`);
          return { access_token: "email-access-token" };
        },
      };

      const iam = new BrowserIam(transport);
      await iam.requestEmailVerificationCode(emailInput.email);
      await iam.registerWithEmail(emailInput);
      await expect(iam.loginWithEmail(emailInput.email, emailInput.password)).resolves.toEqual({
        userId: "email-user-123",
      });

      expect(calls).toEqual([
        "request-code:player@example.com",
        "register:player@example.com:123456",
        "login:player@example.com:correct horse battery staple",
        "current-user:email-access-token",
      ]);
      expect(iam.getAccessToken()).toBe("email-access-token");
    });

    it("surfaces a safe registration_failed error without a transport wired up", async () => {
      const transport: IamTransport = {
        async loginWithDeviceId() {
          throw new Error("unused");
        },
        async getCurrentUser() {
          throw new Error("unused");
        },
      };

      const iam = new BrowserIam(transport);
      await expect(iam.requestEmailVerificationCode(emailInput.email)).rejects.toMatchObject({
        code: "configuration",
      });
      await expect(iam.registerWithEmail(emailInput)).rejects.toMatchObject({ code: "configuration" });
      await expect(iam.loginWithEmail(emailInput.email, emailInput.password)).rejects.toMatchObject({
        code: "configuration",
      });
    });

    it("upgrades the signed-in guest in place, keeping its account and token", async () => {
      const calls: string[] = [];
      const transport: IamTransport = {
        async loginWithDeviceId() {
          return { access_token: "guest-access-token" };
        },
        async getCurrentUser() {
          return { userId: "guest-user-123" };
        },
        async requestGuestUpgradeCode(accessToken, email) {
          calls.push(`upgrade-code:${accessToken}:${email}`);
        },
        async upgradeGuestAccount(accessToken, input) {
          calls.push(`upgrade:${accessToken}:${input.email}:${input.code}`);
        },
      };

      const iam = new BrowserIam(transport);
      await iam.loginAsGuest();
      expect(iam.isGuest()).toBe(true);

      await iam.requestGuestUpgradeCode(emailInput.email);
      await iam.upgradeGuestAccount(emailInput);

      expect(calls).toEqual([
        "upgrade-code:guest-access-token:player@example.com",
        "upgrade:guest-access-token:player@example.com:123456",
      ]);
      // No re-login: the same token stays live so the Lobby connection and
      // any joined match survive the upgrade.
      expect(iam.getAccessToken()).toBe("guest-access-token");
      expect(iam.isGuest()).toBe(false);
    });

    it("refuses to upgrade an account that is not a signed-in guest", async () => {
      const transport: IamTransport = {
        async loginWithDeviceId() {
          throw new Error("unused");
        },
        async getCurrentUser() {
          return { userId: "email-user-123" };
        },
        async loginWithEmailPassword() {
          return { access_token: "email-access-token" };
        },
        async requestGuestUpgradeCode() {
          throw new Error("must not be called");
        },
        async upgradeGuestAccount() {
          throw new Error("must not be called");
        },
      };

      const iam = new BrowserIam(transport);
      // Signed out entirely.
      await expect(iam.upgradeGuestAccount(emailInput)).rejects.toMatchObject({
        code: "not_a_guest",
      });

      await iam.loginWithEmail(emailInput.email, emailInput.password);
      expect(iam.isGuest()).toBe(false);
      await expect(iam.requestGuestUpgradeCode(emailInput.email)).rejects.toMatchObject({
        code: "not_a_guest",
      });
      await expect(iam.upgradeGuestAccount(emailInput)).rejects.toMatchObject({
        code: "not_a_guest",
      });
    });

    it("reports a configuration error when no upgrade transport is wired up", async () => {
      const transport: IamTransport = {
        async loginWithDeviceId() {
          return { access_token: "guest-access-token" };
        },
        async getCurrentUser() {
          return { userId: "guest-user-123" };
        },
      };

      const iam = new BrowserIam(transport);
      await iam.loginAsGuest();
      await expect(iam.requestGuestUpgradeCode(emailInput.email)).rejects.toMatchObject({
        code: "configuration",
      });
      await expect(iam.upgradeGuestAccount(emailInput)).rejects.toMatchObject({
        code: "configuration",
      });
      expect(iam.isGuest()).toBe(true);
    });

    it("leaves the identity a guest when the upgrade itself fails", async () => {
      const transport: IamTransport = {
        async loginWithDeviceId() {
          return { access_token: "guest-access-token" };
        },
        async getCurrentUser() {
          return { userId: "guest-user-123" };
        },
        async upgradeGuestAccount() {
          throw new IamAuthError("upgrade_failed", "Email address is already used.", {
            cause: new Error("secret-token-must-not-render"),
          });
        },
      };

      const iam = new BrowserIam(transport);
      await iam.loginAsGuest();
      await expect(iam.upgradeGuestAccount(emailInput)).rejects.toMatchObject({
        code: "upgrade_failed",
        message: "Email address is already used.",
      });
      expect(iam.isGuest()).toBe(true);
    });

    it("keeps raw transport errors out of the email-login failure", async () => {
      const transport: IamTransport = {
        async loginWithDeviceId() {
          throw new Error("unused");
        },
        async getCurrentUser() {
          throw new Error("unused");
        },
        async loginWithEmailPassword() {
          throw new IamAuthError("invalid_credentials", "Incorrect email or password.", {
            cause: new Error("secret-token-must-not-render"),
          });
        },
      };

      await expect(
        new BrowserIam(transport).loginWithEmail(emailInput.email, emailInput.password),
      ).rejects.toMatchObject({
        code: "invalid_credentials",
        message: "Incorrect email or password.",
      });
    });
  });
});
