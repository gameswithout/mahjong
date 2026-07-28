import { beforeEach, describe, expect, it } from "vitest";

import { BrowserIam, IamAuthError, mapAuthError, type IamTransport } from "./iam";
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

  // Live AGS returns emailAddress as an empty string for a headless account,
  // not by omitting the field (gameswithout-mahjong, 2026-07-25).
  it("still counts an empty AGS emailAddress as a guest", async () => {
    const transport: IamTransport = {
      async loginWithDeviceId() {
        return { access_token: "device-access-token" };
      },
      async getCurrentUser() {
        return { userId: "guest-user-123", emailAddress: "" };
      },
    };

    const iam = new BrowserIam(transport);
    await expect(iam.loginAsGuest()).resolves.toMatchObject({ isGuest: true });
    expect(iam.isGuest()).toBe(true);
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

    // Payloads copied from live calls against the gameswithout-mahjong
    // namespace on 2026-07-25 — the shapes that drove these mappings.
    describe("upgrade failures observed against live AGS", () => {
      function agsError(status: number, data: unknown) {
        return { response: { status, data } };
      }

      it("reads a rejected verification code as a bad code, not a used-up account", () => {
        for (const data of [
          {
            errorCode: 10152,
            errorMessage:
              "unable to upgrade headless account with verification code: verification code not found, userID: 69c9c424c6d249c1a8605b452b812f71",
          },
          {
            errorCode: 10138,
            errorMessage:
              "unable to upgrade headless account with verification code: code not match, userID: 69c9c424c6d249c1a8605b452b812f71",
          },
        ]) {
          // AGS answers a bad code with 403, so status alone would have
          // read this as "this account already has email sign-in".
          const mapped = mapAuthError(agsError(403, data), "upgrade");
          expect(mapped.code).toBe("upgrade_failed");
          expect(mapped.message).toBe(
            "That verification code is not valid or has expired. Request a new one.",
          );
        }
      });

      it("never puts an AGS-internal userID in front of the player", () => {
        const mapped = mapAuthError(
          agsError(400, {
            errorCode: 20000,
            errorMessage: "internal server error, userID: 69c9c424c6d249c1a8605b452b812f71",
          }),
          "upgrade",
        );

        expect(mapped.message).toBe("Account creation failed. Please retry.");
        expect(mapped.message).not.toContain("69c9c424");
      });

      it("still separates an account that cannot be upgraded again", () => {
        const mapped = mapAuthError(
          agsError(403, { errorCode: 10141, errorMessage: "user already has email account" }),
          "upgrade",
        );

        expect(mapped.code).toBe("not_a_guest");
        expect(mapped.message).toBe("This account already has email sign-in.");
      });

      it("keeps a clean AGS message for the upgrade code request", () => {
        const mapped = mapAuthError(
          agsError(409, { errorCode: 10133, errorMessage: "email already used" }),
          "request_upgrade_code",
        );

        expect(mapped.code).toBe("upgrade_failed");
        expect(mapped.message).toBe("email already used");
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

  // A hand can outlast the token it began with, and the client holds one token
  // from sign-in to sign-out. Renewing it is what keeps a long session from
  // ending in a 401 the player cannot act on.
  describe("access token renewal", () => {
    function signedInIam(
      refresh: IamTransport["refreshAccessToken"],
      refreshToken: unknown = "refresh-1",
    ): BrowserIam {
      return new BrowserIam(
        {
          async loginWithDeviceId() {
            return { access_token: "access-1", refresh_token: refreshToken };
          },
          async getCurrentUser() {
            return { userId: "guest-user-123" };
          },
          refreshAccessToken: refresh,
        },
        { getOrCreate: () => "stable-device-id" },
      );
    }

    it("exchanges the refresh token and adopts the new access token", async () => {
      const seen: string[] = [];
      const iam = signedInIam(async (token) => {
        seen.push(token);
        return { access_token: "access-2", refresh_token: "refresh-2" };
      });
      await iam.loginAsGuest();
      expect(iam.getAccessToken()).toBe("access-1");

      await expect(iam.refreshAccessToken()).resolves.toBe(true);
      expect(seen).toEqual(["refresh-1"]);
      expect(iam.getAccessToken()).toBe("access-2");
    });

    // AGS returns a new refresh token from every exchange, so the second
    // renewal has to present that replacement rather than the original.
    it("presents the rotated refresh token on the next renewal", async () => {
      const seen: string[] = [];
      const iam = signedInIam(async (token) => {
        seen.push(token);
        return { access_token: `access-${seen.length + 1}`, refresh_token: `refresh-${seen.length + 1}` };
      });
      await iam.loginAsGuest();

      await iam.refreshAccessToken();
      await iam.refreshAccessToken();
      expect(seen).toEqual(["refresh-1", "refresh-2"]);
    });

    // Several callers can meet a 401 in the same second. AGS currently
    // tolerates a reused refresh token, so this is about not depending on
    // that: if reuse detection is ever enabled, concurrent renewals would
    // otherwise become concurrent sign-outs.
    it("collapses concurrent renewals into one exchange", async () => {
      let exchanges = 0;
      const iam = signedInIam(async () => {
        exchanges += 1;
        await Promise.resolve();
        return { access_token: "access-2", refresh_token: "refresh-2" };
      });
      await iam.loginAsGuest();

      const results = await Promise.all([
        iam.refreshAccessToken(),
        iam.refreshAccessToken(),
        iam.refreshAccessToken(),
      ]);
      expect(results).toEqual([true, true, true]);
      expect(exchanges).toBe(1);
    });

    it("reports failure without throwing, and does not retry a rejected token", async () => {
      let exchanges = 0;
      const iam = signedInIam(async () => {
        exchanges += 1;
        throw new IamAuthError("unknown", "refresh rejected");
      });
      await iam.loginAsGuest();

      await expect(iam.refreshAccessToken()).resolves.toBe(false);
      await expect(iam.refreshAccessToken()).resolves.toBe(false);
      expect(exchanges).toBe(1);
      // The token that was already working stays usable; only renewal is spent.
      expect(iam.getAccessToken()).toBe("access-1");
    });

    it("reports failure when the sign-in never returned a refresh token", async () => {
      let exchanges = 0;
      const iam = signedInIam(async () => {
        exchanges += 1;
        return { access_token: "access-2" };
      }, null);
      await iam.loginAsGuest();

      await expect(iam.refreshAccessToken()).resolves.toBe(false);
      expect(exchanges).toBe(0);
    });

    // A response with no replacement means this was the last renewal on offer.
    it("stops renewing once a response omits the next refresh token", async () => {
      let exchanges = 0;
      const iam = signedInIam(async () => {
        exchanges += 1;
        return { access_token: "access-2" };
      });
      await iam.loginAsGuest();

      await expect(iam.refreshAccessToken()).resolves.toBe(true);
      await expect(iam.refreshAccessToken()).resolves.toBe(false);
      expect(exchanges).toBe(1);
    });
  });
});
