import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserIam } from "./iam";
import type { GameTelemetry } from "./telemetry";
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from "./settings";

const dependencies = vi.hoisted(() => ({
  createJadeClient: vi.fn(),
  createLobbyConnection: vi.fn(),
  createProgressionClient: vi.fn(),
  createPlayerSettingsClient: vi.fn(),
}));

vi.mock("./config", async () => {
  const actual = await vi.importActual<typeof import("./config")>("./config");
  return {
    ...actual,
    accelByteConfig: {
      baseURL: "https://example.test",
      namespace: "mahjong-test",
      clientId: "browser-client",
      matchServiceURL: "https://match.example.test",
      matchPool: "bamboo",
      sessionTemplate: "mahjong",
      sessionClientVersion: "test",
      partyTemplate: "mahjong-party",
    },
  };
});

vi.mock("./jade", async () => {
  const actual = await vi.importActual<typeof import("./jade")>("./jade");
  return { ...actual, createJadeClient: dependencies.createJadeClient };
});

vi.mock("./lobby", async () => {
  const actual = await vi.importActual<typeof import("./lobby")>("./lobby");
  return { ...actual, createLobbyConnection: dependencies.createLobbyConnection };
});

vi.mock("./progression", async () => {
  const actual = await vi.importActual<typeof import("./progression")>("./progression");
  return { ...actual, createProgressionClient: dependencies.createProgressionClient };
});

vi.mock("./settings", async () => {
  const actual = await vi.importActual<typeof import("./settings")>("./settings");
  return { ...actual, createPlayerSettingsClient: dependencies.createPlayerSettingsClient };
});

import { App } from "./App";

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const target = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  if (!(target instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return target;
}

describe("App optional-analytics consent ask", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let telemetry: GameTelemetry;
  let consent: boolean;
  let save: ReturnType<typeof vi.fn>;

  function consentCalls() {
    return vi
      .mocked(telemetry.track)
      .mock.calls.filter(([name]) => name === "analytics_consent_changed");
  }

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    consent = false;
    telemetry = {
      track: vi.fn(() => true),
      flush: vi.fn(async () => {}),
      start: vi.fn(),
      stop: vi.fn(),
      optionalConsent: () => consent,
      setOptionalConsent: vi.fn((enabled: boolean) => {
        consent = enabled;
      }),
    };

    dependencies.createJadeClient.mockReturnValue({
      getAccount: vi.fn().mockResolvedValue({
        balance: 5000,
        available: 5000,
        reserved: 0,
        eligible: true,
      }),
    });
    dependencies.createProgressionClient.mockReturnValue({
      get: vi.fn().mockResolvedValue({ progression: { level: 1, lifetime_xp: 0 }, curve: [] }),
      getAchievements: vi.fn().mockResolvedValue([]),
    });
    dependencies.createLobbyConnection.mockImplementation((_sdk, callbacks) => {
      queueMicrotask(() => callbacks.onOpen());
      return { disconnect: vi.fn() };
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function enterLobby(stored: PlayerSettings | null): Promise<void> {
    save = vi.fn(async (settings: PlayerSettings) => settings);
    dependencies.createPlayerSettingsClient.mockReturnValue({
      get: vi.fn().mockResolvedValue(stored ?? DEFAULT_PLAYER_SETTINGS),
      getStored: vi.fn().mockResolvedValue(stored),
      save,
    });

    const iam = {
      loginAsGuest: vi.fn().mockResolvedValue({
        userId: "player-1",
        deviceId: "device-1",
        isGuest: true,
      }),
      getAuthenticatedSdk: vi.fn().mockReturnValue({}),
      getAccessToken: vi.fn().mockReturnValue("player-token"),
    } as unknown as BrowserIam;

    act(() => root.render(<App iam={iam} telemetry={telemetry} />));
    await act(async () => {
      button(container, "Continue as Guest").click();
      for (let tick = 0; tick < 4; tick += 1) {
        await Promise.resolve();
      }
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Solo Practice"));
  }

  it("asks a player who has never answered, and takes yes for an answer", async () => {
    // No stored record at all: this player has never been asked, which is a
    // different state from having declined.
    await enterLobby(null);

    const card = await vi.waitFor(() => {
      const found = container.querySelector(".analytics-consent-card");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    // Both answers are one click and neither is preselected — the card is a
    // question, so a checkbox defaulted either way would be the wrong shape.
    expect(card.querySelectorAll("input")).toHaveLength(0);
    expect(card.textContent).toContain("Share analytics");
    expect(card.textContent).toContain("No thanks");
    expect(consentCalls()).toHaveLength(0);

    await act(async () => {
      button(container, "Share analytics").click();
      await Promise.resolve();
    });

    expect(telemetry.setOptionalConsent).toHaveBeenCalledWith(true);
    // Essential class, and tagged with the surface that earned it, so the
    // lobby ask and the Settings checkbox stay separable in the consent rate.
    expect(consentCalls()).toHaveLength(1);
    expect(consentCalls()[0][1]).toMatchObject({
      dimensions: { outcome: "granted", surface: "first_run" },
    });
    // Answering is what closes it, not consenting: the card must not become a
    // thing you can only dismiss by saying yes.
    await vi.waitFor(() =>
      expect(container.querySelector(".analytics-consent-card")).toBeNull(),
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ optionalAnalyticsConsent: true, analyticsConsentDecided: true }),
    );
  });

  it("takes no for an answer and does not ask again", async () => {
    await enterLobby(null);
    await vi.waitFor(() =>
      expect(container.querySelector(".analytics-consent-card")).not.toBeNull(),
    );

    await act(async () => {
      button(container, "No thanks").click();
      await Promise.resolve();
    });

    expect(consentCalls()).toHaveLength(1);
    expect(consentCalls()[0][1]).toMatchObject({
      dimensions: { outcome: "declined", surface: "first_run" },
    });
    await vi.waitFor(() =>
      expect(container.querySelector(".analytics-consent-card")).toBeNull(),
    );
    // A decline is recorded as an answer, not left as the default, so the
    // player is not asked the same question on every visit.
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ optionalAnalyticsConsent: false, analyticsConsentDecided: true }),
    );
  });

  it("does not ask a player who already declined on another device", async () => {
    // Declined and decided reads identically to never-asked on the consent
    // flag alone. Only analyticsConsentDecided tells them apart.
    await enterLobby({
      ...DEFAULT_PLAYER_SETTINGS,
      optionalAnalyticsConsent: false,
      analyticsConsentDecided: true,
    });

    await vi.waitFor(() => expect(container.textContent).toContain("Solo Practice"));
    expect(container.querySelector(".analytics-consent-card")).toBeNull();
    // Restoring a stored preference is not a decision and must not be counted
    // as one, or the consent rate becomes a count of page loads.
    expect(consentCalls()).toHaveLength(0);
  });
});
