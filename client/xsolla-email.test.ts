import { expect, it, vi } from "vitest";
import { confirmXsollaEmailCode, requestXsollaEmailCode } from "./xsolla-email";
const config = { projectId: "login-project", oauthClientId: "public-client" };
it("requests codes only from Xsolla and requires a confirmed operation response", async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ operation_id: "operation-1" })));
  expect(await requestXsollaEmailCode(" player@example.com ", config, request)).toBe("operation-1");
  expect(request).toHaveBeenCalledWith("https://login.xsolla.com/api/login/email/request?projectId=login-project&with_logout=0", expect.objectContaining({ body: JSON.stringify({ email: "player@example.com", send_link: false }) }));
  await expect(requestXsollaEmailCode("player@example.com", config, vi.fn().mockResolvedValue(new Response(null, { status: 204 })))).rejects.toThrow("invalid email-code request");
});
it("shows disabled-project and throttling errors without reporting a code sent", async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "003-056" } }), { status: 422 }));
  await expect(requestXsollaEmailCode("player@example.com", config, request)).rejects.toThrow("not enabled");
  await expect(requestXsollaEmailCode("player@example.com", config, vi.fn().mockResolvedValue(new Response(null, { status: 429 })))).rejects.toThrow("Too many attempts");
});
it("confirms the matching email, code and operation and consumes only the returned token", async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ login_url: "https://game.example/?token=verified-xsolla-token" })));
  expect(await confirmXsollaEmailCode("player@example.com", " 123456 ", "operation-1", config, request)).toBe("verified-xsolla-token");
  expect(request).toHaveBeenCalledWith("https://login.xsolla.com/api/login/email/confirm?projectId=login-project", expect.objectContaining({ body: JSON.stringify({ email: "player@example.com", code: "123456", operation_id: "operation-1" }) }));
  await expect(confirmXsollaEmailCode("player@example.com", "000000", "operation-1", config, vi.fn().mockResolvedValue(new Response(null, { status: 401 })))).rejects.toThrow("invalid or expired");
});
