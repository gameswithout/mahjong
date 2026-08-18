import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PLAYER_SETTINGS,
  createPlayerSettingsClient,
  loadCachedPlayerSettings,
  normalizePlayerSettings,
  saveCachedPlayerSettings,
} from "./settings";

function sdkWith(get: ReturnType<typeof vi.fn>, put = vi.fn()) {
  return {
    assembly: () => ({ axiosInstance: { get, put } }),
  } as never;
}

describe("player settings", () => {
  it("caches settings by account for immediate login hydration", () => {
    saveCachedPlayerSettings("guest-1", {
      ...DEFAULT_PLAYER_SETTINGS,
      showTutorial: false,
      optionalAnalyticsConsent: true,
    });

    expect(loadCachedPlayerSettings("guest-1")).toEqual({
      ...DEFAULT_PLAYER_SETTINGS,
      showTutorial: false,
      optionalAnalyticsConsent: true,
    });
    expect(loadCachedPlayerSettings("guest-2")).toBeNull();
  });

  it("normalizes missing and wrapped values", () => {
    expect(normalizePlayerSettings(undefined)).toEqual(DEFAULT_PLAYER_SETTINGS);
    expect(normalizePlayerSettings({ value: { showTutorial: false } })).toEqual({
      ...DEFAULT_PLAYER_SETTINGS,
      showTutorial: false,
    });
  });

  it("keeps the experimental table opt-in with review outlines enabled by default", () => {
    expect(DEFAULT_PLAYER_SETTINGS).toMatchObject({
      experimentalTableUi: false,
      tableLayoutOutlines: true,
      handSortMode: "suit-rank",
      tableFxEnabled: false,
    });
    expect(normalizePlayerSettings({ value: { experimentalTableUi: true } })).toMatchObject({
      experimentalTableUi: true,
      tableLayoutOutlines: true,
    });
  });

  it("migrates the old auto-pass switch to the shortest offered delay", () => {
    // The boolean meant "pass the instant the claim appears". Nothing that
    // fast is offered now, so it lands on 1s — off would silently take the
    // feature away from someone who had asked for it.
    expect(normalizePlayerSettings({ value: { autoPassClaims: true } }).autoPassDelay).toBe("1s");
    expect(normalizePlayerSettings({ value: { autoPassClaims: false } }).autoPassDelay).toBe("off");
    expect(normalizePlayerSettings({ value: { autoPassDelay: "5s" } }).autoPassDelay).toBe("5s");
    expect(normalizePlayerSettings({ value: { autoPassDelay: "2s" } }).autoPassDelay).toBe("off");
  });

  it("leaves claim impact analysis off regardless of the retired compact flag", () => {
    // compactClaimPrompts defaulted to "show the impact text", so migrating it
    // would switch the wordy table back on for everyone who never touched it.
    expect(
      normalizePlayerSettings({ value: { compactClaimPrompts: false } }).claimImpactAnalysis,
    ).toBe(false);
    expect(
      normalizePlayerSettings({ value: { claimImpactAnalysis: true } }).claimImpactAnalysis,
    ).toBe(true);
  });

  it("treats a record written before the consent ask existed as never asked", () => {
    // "declined" and "never asked" are both optionalAnalyticsConsent: false.
    // A record from before the field existed has to normalize to the second,
    // or every player who predates the ask is silently counted as having
    // refused and never gets asked at all.
    const legacy = normalizePlayerSettings({
      value: { showTutorial: false, optionalAnalyticsConsent: false },
    });
    expect(legacy.analyticsConsentDecided).toBe(false);

    const answered = normalizePlayerSettings({
      value: { optionalAnalyticsConsent: false, analyticsConsentDecided: true },
    });
    expect(answered).toMatchObject({
      optionalAnalyticsConsent: false,
      analyticsConsentDecided: true,
    });
  });

  it("loads the account-scoped Cloud Save record", async () => {
    const get = vi.fn().mockResolvedValue({
      data: { value: { showTutorial: false, optionalAnalyticsConsent: true } },
    });
    const client = createPlayerSettingsClient(sdkWith(get), "mahjong", "player 1");

    await expect(client.get()).resolves.toEqual({
      ...DEFAULT_PLAYER_SETTINGS,
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

  it("distinguishes a missing Cloud Save record from stored defaults", async () => {
    const get = vi.fn().mockRejectedValue({ response: { status: 404 } });
    const client = createPlayerSettingsClient(sdkWith(get), "mahjong", "player");
    await expect(client.getStored()).resolves.toBeNull();
  });

  it("saves a private user record", async () => {
    const put = vi.fn().mockResolvedValue({
      data: { value: { showTutorial: false, optionalAnalyticsConsent: true } },
    });
    const client = createPlayerSettingsClient(sdkWith(vi.fn(), put), "mahjong", "player");

    await expect(
      client.save({ ...DEFAULT_PLAYER_SETTINGS, showTutorial: false, optionalAnalyticsConsent: true }),
    ).resolves.toEqual({
      ...DEFAULT_PLAYER_SETTINGS,
      showTutorial: false,
      optionalAnalyticsConsent: true,
    });
    expect(put).toHaveBeenCalledWith(
      "/cloudsave/v1/namespaces/mahjong/users/player/records/mahjong-player-settings",
      {
        value: { ...DEFAULT_PLAYER_SETTINGS, showTutorial: false, optionalAnalyticsConsent: true },
        isPublic: false,
      },
    );
  });

  it("keeps the submitted settings when Cloud Save returns an acknowledgement envelope", async () => {
    const put = vi.fn().mockResolvedValue({
      data: { key: "mahjong-player-settings", namespace: "mahjong", user_id: "player" },
    });
    const client = createPlayerSettingsClient(sdkWith(vi.fn(), put), "mahjong", "player");

    await expect(
      client.save({ ...DEFAULT_PLAYER_SETTINGS, showTutorial: false, optionalAnalyticsConsent: false }),
    ).resolves.toEqual({
      ...DEFAULT_PLAYER_SETTINGS,
      showTutorial: false,
      optionalAnalyticsConsent: false,
    });
  });
});
