import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SettingsScreen } from "./SettingsScreen";
import { RULES_NAME, RULES_VERSION } from "./rules-version";

describe("SettingsScreen", () => {
  it("holds rules, tutorial visibility, analytics, and account sync status", () => {
    const markup = renderToStaticMarkup(
      <SettingsScreen
        settings={{ showTutorial: false, optionalAnalyticsConsent: false }}
        syncStatus="ready"
        onSettingsChange={vi.fn()}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(markup).toContain("Show Learn section");
    expect(markup).toContain("Share optional gameplay analytics");
    expect(markup).toContain(RULES_NAME);
    expect(markup).toContain(RULES_VERSION);
    expect(markup).toContain("Settings saved to your account.");
    expect(markup).not.toContain('checked=""');
  });
});
