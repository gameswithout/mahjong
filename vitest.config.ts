import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Linked agent worktrees live under the repository root. They may hold
    // independent in-progress changes and must not be collected as duplicate
    // tests when verifying the current branch.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
