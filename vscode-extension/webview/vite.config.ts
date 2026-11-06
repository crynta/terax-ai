import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const here = import.meta.dirname;
const terax = path.resolve(here, "../..");
const shim = (file: string) => path.resolve(here, "shims", file);

/**
 * Builds the Terax Session Reader for a VS Code webview. The Reader's own
 * sources are used as-is; only the Tauri and terminal-coupled modules are
 * swapped for shims that talk to the extension host.
 */
export default defineConfig({
  root: here,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom", "zustand"],
    alias: [
      { find: /^@tauri-apps\/api\/core$/u, replacement: shim("tauri-core.ts") },
      { find: /^@tauri-apps\/api\/webview$/u, replacement: shim("tauri-webview.ts") },
      {
        find: /^@tauri-apps\/(api\/path|api\/event|plugin-log|plugin-opener|plugin-store)$/u,
        replacement: shim("tauri-misc.ts"),
      },
      {
        find: /^@\/modules\/terminal\/lib\/terminalSessionApi$/u,
        replacement: shim("terminalSessionApi.ts"),
      },
      {
        find: /^@\/modules\/(terminal\/lib\/agentActivity|agents\/store\/agentStore|settings\/preferences|workspace|workspace\/env|ai\/store\/chatStore)$/u,
        replacement: shim("stores.ts"),
      },
      { find: /^@\/app\/components\/useGitBranch$/u, replacement: shim("useGitBranch.ts") },
      { find: /^\.\/ComposerVoice$/u, replacement: shim("ComposerVoice.tsx") },
      { find: /^@\//u, replacement: `${path.join(terax, "src")}/` },
    ],
  },
  build: {
    outDir: path.resolve(here, "../dist/webview"),
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: path.resolve(here, "main.tsx"),
      output: {
        entryFileNames: "assets/main.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (info) =>
          info.names?.some((n) => n.endsWith(".css"))
            ? "assets/main.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
