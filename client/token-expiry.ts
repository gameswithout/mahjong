// Scheduling hint only. Signature and authorization remain server-validated.
export function tokenExpiresAt(token: string): number | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const encoded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const exp = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : undefined;
  } catch { return undefined; }
}
