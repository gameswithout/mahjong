import { beforeEach, expect, it, vi } from "vitest";
import { BrowserIam, IamAuthError, type IamTransport } from "./iam";
import { REMEMBERED_SESSION_KEY, readRememberedSession, REMEMBERED_SESSION_MS } from "./remembered-session";
beforeEach(() => localStorage.clear());
function transport(): IamTransport {
  return { loginWithDeviceId: vi.fn(), loginWithEmailCode: async () => ({ access_token: "access", refresh_token: "refresh-1" }), getCurrentUser: async () => ({ userId: "same-player" }), refreshAccessToken: vi.fn().mockResolvedValue({ access_token: "new-access", refresh_token: "refresh-2" }) };
}
it("persists only opted-in renewal credentials, restores the verified identity and rotates credentials", async () => {
  const api = transport(); const iam = new BrowserIam(api);
  await iam.loginWithEmailCode("player@example.com", "code", "op");
  expect(readRememberedSession()).toBeNull();
  iam.setKeepLoggedIn(true);
  const stored = localStorage.getItem(REMEMBERED_SESSION_KEY)!;
  expect(stored).not.toContain('"access"'); expect(stored).not.toContain("player@example.com"); expect(stored).not.toContain('"code"');
  const reloaded = new BrowserIam(api);
  expect(await reloaded.restoreRememberedSession()).toEqual({ userId: "same-player", isGuest: false });
  expect(readRememberedSession()?.refreshToken).toBe("refresh-2");
  reloaded.clearSession(); expect(readRememberedSession()).toBeNull(); expect(() => reloaded.getAccessToken()).toThrow();
});
it("clears expired, malformed and rejected renewal sessions", async () => {
  localStorage.setItem(REMEMBERED_SESSION_KEY, JSON.stringify({ refreshToken: "old", kind: "full", expiresAt: Date.now() - 1 }));
  expect(readRememberedSession()).toBeNull();
  const api = transport(); const iam = new BrowserIam(api); iam.setKeepLoggedIn(true); await iam.loginWithEmailCode("player@example.com", "code", "op");
  api.refreshAccessToken = async () => { throw new IamAuthError("invalid_credentials", "expired"); };
  expect(await new BrowserIam(api).restoreRememberedSession()).toBeNull(); expect(readRememberedSession()).toBeNull();
  localStorage.setItem(REMEMBERED_SESSION_KEY, "bad-json"); expect(readRememberedSession()).toBeNull();
});
it("retains the saved renewal token during a temporary outage and discards late renewal after sign-out", async () => {
  const api = transport(); const iam = new BrowserIam(api); iam.setKeepLoggedIn(true); await iam.loginWithEmailCode("player@example.com", "code", "op");
  api.refreshAccessToken = async () => { throw new IamAuthError("network", "offline"); };
  expect(await new BrowserIam(api).restoreRememberedSession()).toBeNull(); expect(readRememberedSession()?.refreshToken).toBe("refresh-1");
  let finish!: (token: { access_token: string; refresh_token: string }) => void;
  api.refreshAccessToken = () => new Promise((resolve) => { finish = resolve; });
  const reloaded = new BrowserIam(api); const pending = reloaded.restoreRememberedSession();
  reloaded.clearSession(); finish({ access_token: "late-access", refresh_token: "late-refresh" });
  expect(await pending).toBeNull(); expect(readRememberedSession()).toBeNull(); expect(() => reloaded.getAccessToken()).toThrow();
  expect(REMEMBERED_SESSION_MS).toBe(30 * 24 * 60 * 60 * 1000);
});
