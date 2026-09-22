import { describe, expect, it } from "vitest";

import { assertAccelByteConfig, resolveBrowserBaseURL } from "./config";

describe("assertAccelByteConfig", () => {
  it("resolves the local AGS proxy to the absolute URL required by the SDK", () => {
    expect(resolveBrowserBaseURL("/ags", "http://127.0.0.1:5173")).toBe(
      "http://127.0.0.1:5173/ags",
    );
  });

  it("resolves the local match-service proxy against the active dev origin", () => {
    expect(resolveBrowserBaseURL("/match-service", "http://localhost:5173")).toBe(
      "http://localhost:5173/match-service",
    );
  });

  it("resolves the local Session proxy against the active dev origin", () => {
    expect(resolveBrowserBaseURL("/ags", "http://localhost:5173")).toBe(
      "http://localhost:5173/ags",
    );
  });

  it("allows IAM to start when optional Session-create settings are absent", () => {
    expect(() =>
      assertAccelByteConfig({
        baseURL: "https://example.accelbyte.io",
        namespace: "mahjong",
        clientId: "public-client",
      }),
    ).not.toThrow();
  });

  it("rejects incomplete core IAM settings", () => {
    expect(() =>
      assertAccelByteConfig({
        baseURL: "https://example.accelbyte.io",
        namespace: "mahjong",
        clientId: "",
      }),
    ).toThrow("AGS browser configuration is incomplete.");
  });
});
