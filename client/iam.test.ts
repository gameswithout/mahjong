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
});
