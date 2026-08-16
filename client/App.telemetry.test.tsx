import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { BrowserIam } from "./iam";
import type { GameTelemetry } from "./telemetry";

describe("App telemetry flow", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("starts essential lifecycle events and exposes explicit optional consent", () => {
    let consent = false;
    const telemetry: GameTelemetry = {
      track: vi.fn(() => true),
      flush: vi.fn(async () => {}),
      start: vi.fn(),
      stop: vi.fn(),
      optionalConsent: () => consent,
      setOptionalConsent: vi.fn((enabled: boolean) => {
        consent = enabled;
      }),
    };

    act(() => root.render(<App iam={{} as BrowserIam} telemetry={telemetry} />));
    act(() => vi.runOnlyPendingTimers());

    const names = vi.mocked(telemetry.track).mock.calls.map(([name]) => name);
    expect(names).toContain("app_session_started");
    expect(names).toContain("app_interactive");
    expect(telemetry.start).toHaveBeenCalledOnce();

    const consentInput = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .find((input) => input.parentElement?.textContent?.includes("optional gameplay analytics"));
    expect(consentInput).toBeDefined();
    act(() => consentInput?.click());
    expect(telemetry.setOptionalConsent).toHaveBeenCalledWith(true);
    expect(consentInput?.checked).toBe(true);
  });

  it("cohorts the session start and reports the consent decision itself", () => {
    let consent = false;
    const telemetry: GameTelemetry = {
      track: vi.fn(() => true),
      flush: vi.fn(async () => {}),
      start: vi.fn(),
      stop: vi.fn(),
      optionalConsent: () => consent,
      setOptionalConsent: vi.fn((enabled: boolean) => {
        consent = enabled;
      }),
    };

    act(() => root.render(<App iam={{} as BrowserIam} telemetry={telemetry} />));
    act(() => vi.runOnlyPendingTimers());

    const call = (name: string) =>
      vi.mocked(telemetry.track).mock.calls.find(([eventName]) => eventName === name);

    // A brand new device is its own retention cohort. Without this the
    // dashboard cannot tell a first visit from a returning player.
    expect(call("app_session_started")?.[1]).toMatchObject({
      dimensions: { return_band: "first_session", session_count_band: "1" },
    });
    // Locale is observed even though the selector lives outside the app.
    expect(call("feature_engaged")?.[1]).toMatchObject({
      dimensions: { feature: "locale", surface: "startup" },
    });
    // Restoring saved settings is not a decision and must stay unreported.
    expect(call("analytics_consent_changed")).toBeUndefined();

    const consentInput = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).find((input) => input.parentElement?.textContent?.includes("optional gameplay analytics"));
    act(() => consentInput?.click());

    // Essential class, so the opt-in is recorded even though the events it
    // unlocks are not yet flowing — this is the consent rate's numerator.
    expect(call("analytics_consent_changed")?.[1]).toMatchObject({
      dimensions: { outcome: "granted", surface: "settings" },
    });
  });

  it("closes the session with its depth when the tab is hidden", () => {
    const telemetry: GameTelemetry = {
      track: vi.fn(() => true),
      flush: vi.fn(async () => {}),
      start: vi.fn(),
      stop: vi.fn(),
      optionalConsent: () => false,
      setOptionalConsent: vi.fn(),
    };

    act(() => root.render(<App iam={{} as BrowserIam} telemetry={telemetry} />));
    act(() => vi.runOnlyPendingTimers());

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));

    const ended = vi
      .mocked(telemetry.track)
      .mock.calls.filter(([name]) => name === "app_session_ended");
    expect(ended).toHaveLength(1);
    expect(ended[0][1]).toMatchObject({
      dimensions: { end_reason: "hidden", session_depth: "bounced" },
    });

    // A tab that comes back and hides again is still one session. Firing
    // twice would halve every average session length on the dashboard.
    visibility.mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    visibility.mockReturnValue("hidden");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(
      vi.mocked(telemetry.track).mock.calls.filter(([name]) => name === "app_session_ended"),
    ).toHaveLength(1);

    visibility.mockRestore();
  });
});
