import { describe, expect, it } from "vitest";

// Read as text through Vite rather than node:fs, so this test needs no Node
// type surface in the app's TypeScript project.
import rulesetSource from "../rulesengine/ruleset.go?raw";
import { RULES_VERSION } from "./rules-version";

describe("rules version", () => {
  it("matches the match service's own constant", () => {
    // The lobby prints a rules version the server never sends it. That is only
    // defensible while this assertion holds: bump the Go constant without
    // bumping the client and this fails rather than shipping a stale claim.
    const declared = /Taiwanese16V11RulesetID\s*=\s*"([^"]+)"/.exec(rulesetSource);

    expect(declared?.[1]).toBe(RULES_VERSION);
  });
});
