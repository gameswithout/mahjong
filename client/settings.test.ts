import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PLAYER_SETTINGS,
  createPlayerSettingsClient,
  normalizePlayerSettings,
} from "./settings";

function sdkWith(get: ReturnType<typeof vi.fn>, put = vi.fn()) {
  return {
    assembly: () => ({ axiosInstance: { get, put } }),
  } as never;
}

describe("player settings", () => {
  it("normalizes missing and wrapped values", () => {
    expect(normalizePlayerSettings(undefined)).toEqual(DEFAULT_PLAYER_SETTINGS);
    expect(normalizePlayerSettings({ value: { showTutorial: false } })).toEqual({
      showTutorial: false,
      optionalAnalyticsConsent: false,
    });
  });

  it("loads the account-scoped Cloud Save record", async () => {
    const get = vi.fn().mockResolvedValue({
      data: { value: { showTutorial: false, optionalAnalyticsConsent: true } },
    });
    const client = createPlayerSettingsClient(sdkWith(get), "mahjong", "player 1");

    await expect(client.get()).resolves.toEqual({
      showTutorial: false,
      optionalAnalyticsConsent: true,
    });
    expect(get).toHaveBeenCalledWith(
      "/cloudsave/v1/namespaces/mahjong/users/player%201/records/mahjong-player-settings",
    );
  });

  it("uses defaults when the account has no settings record yet", async () => {
    const get = vi.fn().mockRejectedValue({ response: { status: 404 } });
    const client = createPlayerSettingsClient(sdkWith(get), "mahjong", "player");
    await expect(client.get()).resolves.toEqual(DEFAULT_PLAYER_SETTINGS);
  });

  it("saves a private user record", async () => {
    const put = vi.fn().mockResolvedValue({
      data: { value: { showTutorial: false, optionalAnalyticsConsent: true } },
    });
    const client = createPlayerSettingsClient(sdkWith(vi.fn(), put), "mahjong", "player");

    await expect(
      client.save({ showTutorial: false, optionalAnalyticsConsent: true }),
    ).resolves.toEqual({
      showTutorial: false,
      optionalAnalyticsConsent: true,
    });
    expect(put).toHaveBeenCalledWith(
      "/cloudsave/v1/namespaces/mahjong/users/player/records/mahjong-player-settings",
      {
        value: { showTutorial: false, optionalAnalyticsConsent: true },
        isPublic: false,
      },
    );
  });
});
