import { accelByteConfig, xsollaLoginConfig } from "./config";
export const REMEMBERED_SESSION_KEY = `mahjong.session.v1:${accelByteConfig.namespace}:${xsollaLoginConfig.projectId}`;
export const REMEMBERED_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export interface RememberedSession { refreshToken: string; kind: "guest" | "full"; expiresAt: number }
export function forgetSession() { try { localStorage.removeItem(REMEMBERED_SESSION_KEY); } catch { /* Storage unavailable. */ } }
export function readRememberedSession(): RememberedSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(REMEMBERED_SESSION_KEY) ?? "null");
    if (value && typeof value.refreshToken === "string" && value.refreshToken && (value.kind === "guest" || value.kind === "full") && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now() && value.expiresAt <= Date.now() + REMEMBERED_SESSION_MS) return value;
  } catch { /* Malformed or unavailable storage. */ }
  forgetSession(); return null;
}
export function saveRememberedSession(session: RememberedSession) {
  try { localStorage.setItem(REMEMBERED_SESSION_KEY, JSON.stringify(session)); } catch { /* This session still works in memory. */ }
}
