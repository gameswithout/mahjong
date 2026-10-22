import { assertXsollaLoginConfig, xsollaLoginConfig, type XsollaLoginConfig } from "./config";

export class XsollaEmailError extends Error {}
async function post(path: string, body: object, config: XsollaLoginConfig, request: typeof fetch) {
  assertXsollaLoginConfig(config);
  const url = new URL(`https://login.xsolla.com/api/login/email/${path}`);
  url.searchParams.set("projectId", config.projectId);
  if (path === "request") url.searchParams.set("with_logout", "0");
  let response: Response;
  try { response = await request(url.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new XsollaEmailError("Xsolla Login could not be reached. Check your connection and retry."); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (data?.error?.code === "003-056") throw new XsollaEmailError("Email-code sign-in is not enabled for this game yet. Enable passwordless email in the Xsolla Login project.");
    if (response.status === 429) throw new XsollaEmailError("Too many attempts. Please wait before requesting another code.");
    throw new XsollaEmailError(path === "confirm" ? "That code is invalid or expired. Request a new code and try again." : "Xsolla could not send a code. Please try again.");
  }
  return data as Record<string, unknown>;
}
export async function requestXsollaEmailCode(email: string, config = xsollaLoginConfig, request: typeof fetch = fetch): Promise<string> {
  const data = await post("request", { email: email.trim(), send_link: false }, config, request);
  if (typeof data.operation_id !== "string" || !data.operation_id) throw new XsollaEmailError("Xsolla returned an invalid email-code request.");
  return data.operation_id;
}
export async function confirmXsollaEmailCode(email: string, code: string, operationId: string, config = xsollaLoginConfig, request: typeof fetch = fetch): Promise<string> {
  const data = await post("confirm", { email: email.trim(), code: code.trim(), operation_id: operationId }, config, request);
  // Consume only the token, never navigate to a URL returned by the provider.
  let token: string | null = null;
  try { if (typeof data.login_url === "string") token = new URL(data.login_url).searchParams.get("token"); } catch { /* Invalid provider response. */ }
  if (!token) throw new XsollaEmailError("Xsolla returned an invalid sign-in response. Request a new code.");
  return token;
}
