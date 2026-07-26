// Mirrors economy.RulesVersion in the match service. The server never sends
// this to the browser, so the lobby would otherwise have nothing truthful to
// print. rules-version.test.ts reads the Go constant and fails if the two ever
// drift, which is what makes displaying a local copy honest rather than a
// guess.
export const RULES_VERSION = "taiwanese-16-v1.1";

export const RULES_NAME = "Taiwanese 16-tile";
