import { describe, expect, it } from "vitest";

import { assertAccelByteConfig } from "./config";

describe("assertAccelByteConfig", () => {
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
