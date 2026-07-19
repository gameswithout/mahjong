import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        // Vite resolves these relative to the project root by default; no
        // Node path APIs needed (tsconfig here has no "node" types).
        input: {
          main: "index.html",
          wireframe: "wireframe.html",
        },
      },
    },
    define: {
      "import.meta.env.ACCELBYTE_BASE_URL": JSON.stringify(env.ACCELBYTE_BASE_URL),
      "import.meta.env.ACCELBYTE_NAMESPACE": JSON.stringify(env.ACCELBYTE_NAMESPACE),
      "import.meta.env.ACCELBYTE_CLIENT_ID": JSON.stringify(env.ACCELBYTE_CLIENT_ID),
      "import.meta.env.ACCELBYTE_MATCH_RUNTIME_URL": JSON.stringify(env.ACCELBYTE_MATCH_RUNTIME_URL),
      "import.meta.env.ACCELBYTE_MATCH_POOL": JSON.stringify(env.ACCELBYTE_MATCH_POOL),
      "import.meta.env.ACCELBYTE_SESSION_TEMPLATE": JSON.stringify(env.ACCELBYTE_SESSION_TEMPLATE),
      "import.meta.env.ACCELBYTE_SESSION_CLIENT_VERSION": JSON.stringify(
        env.ACCELBYTE_SESSION_CLIENT_VERSION,
      ),
    },
  };
});
