import { expect, it } from "vitest";
import { tokenExpiresAt } from "./token-expiry";
it("reads expiration only as a scheduling hint and tolerates opaque or malformed tokens", () => {
  expect(tokenExpiresAt(`header.${btoa(JSON.stringify({ exp: 12345 }))}.signature`)).toBe(12345000);
  for (const token of ["opaque", "header.broken.signature", `h.${btoa('{"exp":"123"}')}.s`]) expect(tokenExpiresAt(token)).toBeUndefined();
});
