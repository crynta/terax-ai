import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type PluginOption, type UserConfig } from "vite";
import Inspect from "vite-plugin-inspect";

const host = process.env.TAURI_DEV_HOST;
const rootDir = import.meta.dirname;

// The app-lab driver (`TERAX_BENCH=1`) may only be built for the lab's own identifier
// (scripts/app-lab/run.py sets TERAX_BENCH_IDENTIFIER): a stray `TERAX_BENCH=1 pnpm build` or
// `tauri build` would otherwise ship the driver under the product identifier. The Rust side
// refuses to start a bench binary under it too (modules/bench.rs); this fails the build early.
if (process.env.TERAX_BENCH === "1") {
  const product = (
    JSON.parse(
      readFileSync(path.join(rootDir, "src-tauri/tauri.conf.json"), "utf8"),
    ) as { identifier: string }
  ).identifier;
  const identifier = process.env.TERAX_BENCH_IDENTIFIER;
  if (!identifier || identifier === product) {
    throw new Error(
      `TERAX_BENCH=1 builds the app-lab driver and needs its own TERAX_BENCH_IDENTIFIER ` +
        `(not the product identifier ${product}); run scripts/app-lab/run.py instead`,
    );
  }
}

// Bundle/treemap analysis is opt-in: `ANALYZE=true pnpm build` emits stats.html.
const analyze = process.env.ANALYZE === "true";

// Module-graph inspector is opt-in via `pnpm dev:inspect`; keeps plain
// `pnpm dev` from paying its transform-tracking overhead on every run.
const inspectGraph = process.env.INSPECT === "true";

/**
 * npm package a module id belongs to (`@scope/name` or `name`), resolved from
 * the *last* `node_modules/` segment so pnpm's `.pnpm/<pkg>@<ver>/node_modules/`
 * indirection yields the real package. Substring tests such as `/react/` are
 * wrong here: `@ai-sdk/react/dist` and `@hugeicons/react/dist` both contain it.
 */
function packageOf(id: string): string | null {
  const m = id.match(/.*node_modules\/((?:@[^/]+\/)?[^/]+)/);
  return m ? m[1] : null;
}

const EAGER_REACT_PACKAGES = new Set([
  "react",
  "react-dom",
  "scheduler",
  "@hugeicons/react",
  // Ubiquitous styling utils used by `cn()` on nearly every eager
  // component. Left unassigned, Rollup absorbs them into whichever
  // feature chunk claims them first (observed: streamdown), dragging
  // that heavy chunk into the eager graph. Pin them to react (eager).
  "clsx",
  "tailwind-merge",
  "class-variance-authority",
]);

/**
 * Modules every window needs at startup. Pinned to a small number of shared
 * chunks so no lazy feature chunk can absorb them (see `codeSplitting` below).
 */
function eagerChunk(id: string): string | null {
  // Vite's __vitePreload helper is a virtual module. Left to Rollup it
  // gets hoisted into whichever chunk it happens to land in (observed:
  // the 480kB streamdown chunk), and since every lazy importer pulls the
  // helper, that heavy chunk gets dragged into the eager startup graph.
  // Pin it to the always-eager react chunk so it costs nothing extra.
  if (id.includes("vite/preload-helper") || id.includes("/vite/dist/"))
    return "react";

  if (id.includes("/packages/ghostty-core/")) return "ghostty-vt";

  const pkg = packageOf(id);
  if (!pkg) return null;
  if (EAGER_REACT_PACKAGES.has(pkg)) return "react";
  if (pkg === "radix-ui" || pkg.startsWith("@radix-ui/")) return "radix";
  return null;
}

const AI_PROVIDER_CHUNKS: Record<string, string> = {
  "@ai-sdk/anthropic": "ai-anthropic",
  "@ai-sdk/google": "ai-google",
  "@ai-sdk/openai-compatible": "ai-openai-compat",
  "@ai-sdk/openai": "ai-openai",
  "@ai-sdk/cerebras": "ai-cerebras",
  "@ai-sdk/groq": "ai-groq",
  "@ai-sdk/xai": "ai-xai",
};

/** Heavy features loaded on demand; each lands in its own named chunk. */
function lazyChunk(id: string): string | null {
  const pkg = packageOf(id);
  if (!pkg) return null;

  // Each AI provider SDK in its own chunk so unused providers
  // don't bloat the initial load (lazy-imported in agent.ts).
  const provider = AI_PROVIDER_CHUNKS[pkg];
  if (provider) return provider;
  if (pkg.startsWith("@ai-sdk/")) return "ai-sdk-shared";

  // Lang packs and legacy modes are dynamically imported by
  // languageResolver; give each its own named chunk so they load on
  // demand instead of being glued into the codemirror core chunk.
  // (bundle audit, issue #551)
  {
    const m = id.match(/@codemirror\/lang-([\w-]+)/);
    if (m) return `cm-lang-${m[1]}`;
  }
  {
    const m = id.match(/@codemirror\/legacy-modes\/mode\/([\w-]+)/);
    if (m) return `cm-legacy-${m[1]}`;
  }
  if (pkg === "@replit/codemirror-lang-svelte") return "cm-lang-svelte";
  if (
    pkg.startsWith("@codemirror/") ||
    pkg.startsWith("@uiw/codemirror") ||
    pkg.startsWith("@replit/codemirror")
  )
    return "codemirror";
  if (pkg === "streamdown" || pkg.startsWith("@streamdown/"))
    return "streamdown";

  return null;
}

// https://vite.dev/config/
export default defineConfig(async ({ mode }): Promise<UserConfig> => ({
  plugins: [
    babel({
      presets: [reactCompilerPreset({ target: "19" })],
    }),
    react(),
    tailwindcss(),
    // Module-graph inspector at /__inspect (who-imports-what, per-plugin
    // transforms). Opt-in via `pnpm dev:inspect`, never in a production build.
    ...(mode === "development" && inspectGraph
      ? [Inspect() as PluginOption]
      : []),
    ...(analyze
      ? [
          (await import("rollup-plugin-visualizer")).visualizer({
            filename: "stats.html",
            template: "treemap",
            gzipSize: true,
            brotliSize: true,
            open: true,
          }) as PluginOption,
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
      // Shim keeps the ~117 kB CJS protocol package out of the bundle.
      "vscode-languageserver-protocol": path.resolve(
        rootDir,
        "./src/modules/lsp/lib/protocolShim.ts",
      ),
    },
  },
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome120" : "es2022",
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      input: {
        main: path.resolve(rootDir, "index.html"),
        settings: path.resolve(rootDir, "settings.html"),
      },
      // Oxc drops `debugger` by default. These calls return undefined, so
      // marking them pure lets DCE strip them from production builds.
      treeshake: {
        manualPureFunctions: [
          "console.debug",
          "console.info",
          "console.trace",
        ],
      },
      output: {
        // Two prioritised groups instead of one `manualChunks` function. With a
        // single group Rolldown resolves overlapping claims in first-seen order
        // and `includeDependenciesRecursively` (default on) lets a feature
        // chunk swallow the *dependencies* of its modules. Observed: the lazy
        // `ai-sdk-shared` chunk (`@ai-sdk/react` -> `react`) captured the CJS
        // `react/index.js` before the `react` chunk did, so the always-eager
        // `react` chunk statically imported `ai-sdk-shared`, which imports every
        // provider chunk: ~560 kB of AI SDK + zod preloaded in both windows.
        // The eager group outranks the lazy one, so shared runtime modules are
        // always claimed by an eager chunk first. The built-output budget
        // (src/app/dist-budget.test.ts) locks this.
        codeSplitting: {
          groups: [
            { name: eagerChunk, priority: 100 },
            { name: lazyChunk, priority: 0 },
          ],
        },
      },
    },
  },
  // Real-application benchmark driver (src/bench, scripts/app-lab). `TERAX_BENCH=1` compiles
  // it in; otherwise this is the literal `false` and every `if (__TERAX_BENCH__)` branch,
  // including its dynamic imports, is removed, so no bench code or chunk is emitted.
  define: {
    __TERAX_BENCH__: JSON.stringify(process.env.TERAX_BENCH === "1"),
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
