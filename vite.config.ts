import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async ({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  esbuild: {
    drop: mode === "production" ? (["debugger"] as ["debugger"]) : [],
    pure:
      mode === "production"
        ? ["console.debug", "console.info", "console.trace"]
        : [],
  },
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "es2020",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        settings: path.resolve(__dirname, "settings.html"),
      },
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;

          // Each AI provider SDK in its own chunk so unused providers
          // don't bloat the initial load (lazy-imported in agent.ts).
          if (id.includes("@ai-sdk/anthropic")) return "ai-anthropic";
          if (id.includes("@ai-sdk/google")) return "ai-google";
          if (id.includes("@ai-sdk/openai-compatible"))
            return "ai-openai-compat";
          if (id.includes("@ai-sdk/openai")) return "ai-openai";
          if (id.includes("@ai-sdk/cerebras")) return "ai-cerebras";
          if (id.includes("@ai-sdk/groq")) return "ai-groq";
          if (id.includes("@ai-sdk/xai")) return "ai-xai";
          if (id.includes("@ai-sdk/")) return "ai-sdk-shared";

          if (id.includes("/xterm/") || id.includes("@xterm/")) return "xterm";
          if (
            id.includes("@codemirror/") ||
            id.includes("@uiw/codemirror") ||
            id.includes("@replit/codemirror")
          )
            return "codemirror";
          if (id.includes("/streamdown/") || id.includes("@streamdown/"))
            return "streamdown";
          // Only the shiki core/engine in one chunk. Grammars and themes
          // stay split (one chunk per file) — they load lazily on first use.
          if (
            id.includes("/shiki/dist/core") ||
            id.includes("/shiki/dist/engine") ||
            id.includes("/shiki/dist/index")
          )
            return "shiki";
          if (id.includes("/motion/") || id.includes("framer-motion"))
            return "motion";
          if (
            id.includes("/react-dom/") ||
            id.includes("/react/") ||
            id.includes("/scheduler/")
          )
            return "react";
          if (id.includes("@radix-ui/") || id.includes("/radix-ui/"))
            return "radix";
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
