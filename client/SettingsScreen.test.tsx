import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SettingsScreen } from "./SettingsScreen";
import { DEFAULT_PLAYER_SETTINGS } from "./settings";
import { RULES_NAME, RULES_VERSION } from "./rules-version";

describe("SettingsScreen", () => {
  it("holds language, rules, tutorial visibility, analytics, and account sync status", () => {
    const markup = renderToStaticMarkup(
      <SettingsScreen
        settings={{ ...DEFAULT_PLAYER_SETTINGS, showTutorial: false, optionalAnalyticsConsent: false }}
        syncStatus="ready"
        onSettingsChange={vi.fn()}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(markup).toContain("Show Learn section");
    expect(markup).toContain("Display language");
    expect(markup).toContain("Simplified Chinese");
    expect(markup).toContain("Traditional Chinese");
    expect(markup).toContain("Share optional gameplay analytics");
    expect(markup).toContain("Show Learning HUD");
    expect(markup).toContain("Auto-pass when Pass is the only action");
    expect(markup).toContain("Compact claim prompts");
    expect(markup).toContain("Learning</option>");
    expect(markup).toContain(">Fast</option>");
    expect(markup).toContain(RULES_NAME);
    expect(markup).toContain(RULES_VERSION);
    expect(markup).toContain("Settings saved to your account.");
    expect(markup).not.toContain('checked=""');
  });
});
