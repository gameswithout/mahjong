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
});
