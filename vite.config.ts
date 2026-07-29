import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The API origins the client talks to, derived from the same env the app is
// built against so they cannot drift from it. In production these usually
// collapse to a single host; the Set keeps the duplicate out.
function apiOrigins(env: Record<string, string>): string[] {
  const origins = new Set<string>();
  for (const url of [env.ACCELBYTE_BASE_URL, env.ACCELBYTE_MATCH_SERVICE_URL, env.ACCELBYTE_ICE_CONFIG_URL]) {
    if (!url) {
      continue;
    }
    // Matched rather than parsed with URL: this config's tsconfig carries no
    // DOM or node lib, so the global constructor is not in scope here. A
    // malformed or relative value is a dev-config problem, not a reason to
    // fail the build — it just gets no hint.
    const origin = /^https?:\/\/[^/?#]+/i.exec(url);
    if (origin) {
      origins.add(origin[0]);
    }
  }

  return [...origins];
}

// Warms DNS + TCP + TLS to the API origins while the browser is still parsing
// HTML and pulling the bundle, so the first real request does not pay three
// round trips first. That handshake costs well under 100ms on a desktop
// connection and the better part of a second on a phone, which is where it is
// worth spending a link tag to avoid.
//
// The PeerJS broker is deliberately left out: video is opt-in and most players
// never start a call, so preconnecting there would open a connection almost
// nobody uses.
function preconnectPlugin(env: Record<string, string>) {
  const origins = apiOrigins(env);

  return {
    name: "mahjong-preconnect",
    transformIndexHtml() {
      return origins.map((origin) => ({
        tag: "link",
        attrs: { rel: "preconnect", href: origin, crossorigin: "" },
        injectTo: "head" as const,
      }));
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, ".", "");

  return {
    // GitHub Pages serves this as a project site at
    // https://gameswithout.github.io/mahjong/, so built asset URLs must be
    // rooted there. The dev server still serves from "/".
    base: command === "build" ? "/mahjong/" : "/",
    plugins: [react(), preconnectPlugin(env)],
    build: {
      rollupOptions: {
        // Vite resolves these relative to the project root by default; no
        // Node path APIs needed (tsconfig here has no "node" types).
        input: {
          main: "index.html",
          wireframe: "wireframe.html",
          resultWireframe: "result-wireframe.html",
          progressionWireframe: "progression-wireframe.html",
          onboardingEvidence: "onboarding-evidence.html",
        },
      },
    },
    define: {
      "import.meta.env.ACCELBYTE_BASE_URL": JSON.stringify(env.ACCELBYTE_BASE_URL),
      "import.meta.env.ACCELBYTE_NAMESPACE": JSON.stringify(env.ACCELBYTE_NAMESPACE),
      "import.meta.env.ACCELBYTE_CLIENT_ID": JSON.stringify(env.ACCELBYTE_CLIENT_ID),
      "import.meta.env.ACCELBYTE_MATCH_SERVICE_URL": JSON.stringify(env.ACCELBYTE_MATCH_SERVICE_URL),
      "import.meta.env.ACCELBYTE_ICE_CONFIG_URL": JSON.stringify(env.ACCELBYTE_ICE_CONFIG_URL),
      "import.meta.env.ACCELBYTE_MATCH_POOL": JSON.stringify(env.ACCELBYTE_MATCH_POOL),
      "import.meta.env.ACCELBYTE_SESSION_TEMPLATE": JSON.stringify(env.ACCELBYTE_SESSION_TEMPLATE),
      "import.meta.env.ACCELBYTE_SESSION_CLIENT_VERSION": JSON.stringify(
        env.ACCELBYTE_SESSION_CLIENT_VERSION,
      ),
    },
  };
});
