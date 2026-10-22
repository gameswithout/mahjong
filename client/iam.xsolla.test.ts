import { afterEach, expect, it, vi } from "vitest";
const platformLogin = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { access_token: "game-token" } }));
vi.mock("@accelbyte/sdk", () => ({ AccelByte: { SDK: vi.fn(() => ({ setToken: vi.fn() })) } }));
vi.mock("@accelbyte/sdk-iam", () => ({ OAuth20V4Api: () => ({ postTokenOauth_ByPlatformId_v4: platformLogin }), OAuth20Api: vi.fn(), UsersApi: vi.fn() }));
import { createSdkIamTransport } from "./iam";
afterEach(() => { vi.unstubAllGlobals(); platformLogin.mockClear(); });
it("routes email codes through Xsolla then exchanges the verified Xsolla token for the game session", async () => {
  const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ operation_id: "op-1" }))).mockResolvedValueOnce(new Response(JSON.stringify({ login_url: "https://game.example/?token=xsolla-token" })));
  vi.stubGlobal("fetch", request);
  const transport = createSdkIamTransport({ baseURL: "https://backend.example", namespace: "game", clientId: "game-client" }, { projectId: "login-project", oauthClientId: "public-client" });
  expect(await transport.requestEmailCode!("player@example.com")).toBe("op-1");
  expect(await transport.loginWithEmailCode!("player@example.com", "123456", "op-1")).toEqual({ access_token: "game-token" });
  expect(platformLogin).toHaveBeenCalledWith("xsolla", expect.objectContaining({ platform_token: "xsolla-token", createHeadless: true }));
  expect(request.mock.calls.every(([url]) => String(url).startsWith("https://login.xsolla.com/api/login/email/"))).toBe(true);
  await expect(transport.requestGuestUpgradeCode!("guest-token", "player@example.com", "en-US")).rejects.toThrow("guest progress is unchanged");
  expect(request).toHaveBeenCalledTimes(2);
});
