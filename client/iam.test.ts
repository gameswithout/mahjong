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
    });
    await expect(iam.loginAsGuest()).resolves.toEqual({
      deviceId: "stable-device-id",
      userId: "guest-user-123",
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
