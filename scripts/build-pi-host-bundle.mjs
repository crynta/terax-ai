import { spawn } from "node:child_process";
import { rename, rm, stat, writeFile, readdir as fsReaddir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const piHostDir = join(repoRoot, "sidecars", "pi-host");
const bundleDir = join(piHostDir, "dist");
const tempDir = join(piHostDir, `.dist-tmp-${process.pid}-${Date.now()}`);

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

async function assertBundleFile(relativePath) {
  const path = join(tempDir, relativePath);
  if (!(await pathExists(path))) {
    throw new Error(`Pi host bundle missing ${relativePath}`);
  }
}

try {
  await rm(tempDir, { recursive: true, force: true });
  await run("pnpm", [
    "--filter",
    "@terax/pi-host",
    "deploy",
    "--prod",
    "--legacy",
    "--config.node-linker=hoisted",
    tempDir,
  ]);

  for (const testFile of [
    "host.test.js",
    "model-catalog.test.js",
    "protocol-schema.test.js",
    "protocol.test.js",
    "sessions.test.js",
    "package.test.js",
  ]) {
    await rm(join(tempDir, testFile), { force: true });
  }

  await assertBundleFile("host.js");
  await assertBundleFile("model-catalog.js");
  await assertBundleFile("protocol-schema.js");
  await assertBundleFile("protocol.js");
  await assertBundleFile("provider-config.js");
  await assertBundleFile("session-errors.js");
  await assertBundleFile("sessions.js");
  await assertBundleFile("package.json");
  await assertBundleFile(
    "node_modules/@earendil-works/pi-coding-agent/package.json",
  );

  // Prune hoisted workspace deps that the sidecar doesn't need.
  // pnpm deploy with --legacy --config.node-linker=hoisted pulls in the
  // entire workspace's dependency tree (mermaid, @hugeicons, react-dom,
  // cytoscape, etc.) which inflates the bundle from ~30MB to 460MB+.
  // The pi-host sidecar only needs @earendil-works packages and their
  // AI SDK transitive deps. Everything else is UI bloat.
  const prunePatterns = [
    // UI frameworks (headless sidecar has no UI)
    "react", "react-dom",
    // Charting/diagram libraries
    "mermaid", "@mermaid-js", "cytoscape", "cytoscape-cose-bilkent", "cytoscape-fcose",
    // Icon libraries
    "@hugeicons", "@iconify", "@iconify-json", "@fontsource", "@fontsource-variable",
    // UI component libraries
    "@radix-ui", "@floating-ui", "@tanstack", "@xyflow", "@upsetjs",
    // Code editors (sidecar doesn't render code)
    "@codemirror", "@lezer", "@uiw", "codemirror",
    // Markdown rendering (sidecar sends raw text)
    "streamdown", "remend",
    // Animation
    "framer-motion", "motion", "motion-dom", "motion-utils",
    // Token/pricing UI library
    "@tokenlens",
    // Replit/sandbox SDK
    "@replit",
    // Babel (build-time only)
    "@babel",
    // Other UI/tooling not needed at runtime
    "@antfu", "@ungap", "@chevrotain", "@braintree",
    "@nodable", "@standard-schema", "@marijn",
    // @tauri-apps API (sidecar uses Node.js, not Tauri)
    "@tauri-apps",
    // Hono (HTTP server framework — not needed for stdio sidecar)
    "@hono",
    // Verdict/jujutsu
    "@vercel",
    // D3 visualization
    "d3", "d3-",
    // Terminal UI (not used by pi-host)
    "@xterm",
    // KaTeX math rendering
    "katex",
    // Resizable panels
    "react-resizable-panels",
    // Web streams polyfill (Node 22+ has native)
    "web-streams-polyfill",
    // Utility belt already covered by builtins
    "es-toolkit",
    // Sonner toast UI
    "sonner",
    // CMDK command palette
    "cmdk",
    // Zustand (UI state)
    "zustand",
    // SWR (React data fetching)
    "swr",
    // Rough.js sketch rendering
    "roughjs", "rough",
    // Dagre graph layout
    "dagre-d3-es", "dagre",
    // Sankey diagram
    "d3-sankey",
    // React-remove-scroll
    "react-remove-scroll", "react-remove-scroll-bar", "react-style-singleton",
    // Class variance authority (UI)
    "class-variance-authority",
    // Scheduler (React)
    "scheduler",
    // Style-to-js/object
    "style-to-js", "style-to-object",
    // Use-callback-ref, use-sidecar, use-sync-external-store
    "use-callback-ref", "use-sidecar", "use-sync-external-store",
    // Stylis CSS compiler
    "stylis",
    // Express server
    "express", "express-rate-limit", "cors",
    // use-stick-to-bottom
    "use-stick-to-bottom",
    // Parse5 HTML parser
    "parse5", "hast-util-raw",
    // rehype/remark (markdown processing)
    "rehype-raw", "rehype-sanitize", "rehype-harden",
    "remark-gfm", "remark-rehype", "remark-parse", "remark-stringify",
    "mdast-util-to-hast", "mdast-util-from-markdown",
    // DOMPurify
    "dompurify",
    // Dequal deep equality
    "dequal",
    // Khroma color library
    "khroma",
    // Points/curves (rough.js deps)
    "points-on-curve", "points-on-path",
    // Hachure fill (rough.js dep)
    "hachure-fill",
    // Layout-base (graph layout)
    "layout-base",
    // Cosine-base (graph layout)
    "cose-base",
    // Robust predicates (geometry)
    "robust-predicates",
    // property-information (hast)
    "property-information",
    // MCP SDK server transport (sidecar is a client, not an MCP server)
    // Pruning this also eliminates the express/hono/body-parser transitive chain
    "@modelcontextprotocol",
    // Hono HTTP framework
    "hono",
    // Lodash (graphlib dep, dead after dagre prune)
    "lodash", "lodash-es",
    // Graphlib (dagre dep, dead after dagre prune)
    "graphlib",
    // TypeScript definitions (not needed at runtime)
    "@types",
    // Token pricing UI
    "tokenlens",
    // Clipboard (sidecar doesn't use clipboard)
    "@mariozechner",
  ];

  for (const pattern of prunePatterns) {
    const pkgPath = join(tempDir, "node_modules", pattern);
    try {
      await rm(pkgPath, { recursive: true, force: true });
    } catch {
      // Some may not exist at top level — that's fine
    }
  }

  // Also prune d3-* packages (d3 ecosystem has ~30 sub-packages)
  const nmDir = join(tempDir, "node_modules");
  const nmEntries = await fsReaddir(nmDir).catch(() => []);
  for (const entry of nmEntries) {
    if (entry.startsWith("d3-") || entry === "d3") {
      await rm(join(nmDir, entry), { recursive: true, force: true }).catch(() => {});
    }
  }

  // Clean up broken symlinks in .bin (from pruned packages)
  const binDir = join(nmDir, ".bin");
  try {
    const binEntries = await fsReaddir(binDir);
    for (const entry of binEntries) {
      const linkPath = join(binDir, entry);
      try {
        await stat(linkPath); // Throws if broken symlink
      } catch {
        await rm(linkPath, { force: true }).catch(() => {});
      }
    }
  } catch {
    // .bin may not exist — that's fine
  }

  // Strip non-runtime artifacts from the bundled dependency tree. A production
  // stdio sidecar never loads source maps or type definitions, and docs add
  // weight with no value. Source maps alone account for ~50MB in the AI SDKs.
  // License/notice files are preserved for redistribution compliance.
  const isStrippable = (name) => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".map")) return true;
    if (
      lower.endsWith(".d.ts") ||
      lower.endsWith(".d.cts") ||
      lower.endsWith(".d.mts")
    ) {
      return true;
    }
    // Preserve license/notice files for redistribution compliance.
    if (/^(license|licence|copying|notice)/i.test(name)) return false;
    // Documentation — match by doc extension only. Never match by name alone:
    // packages ship real runtime modules like `changelog.js` or `history.js`.
    if (lower.endsWith(".md") || lower.endsWith(".markdown")) return true;
    if (
      /\.(txt|rst)$/i.test(name) &&
      /^(readme|changelog|changes|history|authors|contributing)/i.test(name)
    ) {
      return true;
    }
    return false;
  };

  try {
    const allEntries = await fsReaddir(nmDir, {
      recursive: true,
      withFileTypes: true,
    });
    for (const entry of allEntries) {
      if (!entry.isFile()) continue;
      if (isStrippable(entry.name)) {
        await rm(join(entry.parentPath, entry.name), { force: true }).catch(
          () => {},
        );
      }
    }
  } catch {
    // Stripping is best-effort — never fail the build over it.
  }

  // Report final bundle size
  const { execSync } = await import("node:child_process");
  try {
    const sizeOutput = execSync(`du -sh ${join(tempDir, "node_modules")}`, {
      encoding: "utf-8",
    }).trim();
    console.log(`[pi-host] Bundle node_modules size after pruning: ${sizeOutput}`);
  } catch {
    // Size check is informational — don't fail the build
  }

  await writeFile(
    join(tempDir, "bundle-manifest.json"),
    `${JSON.stringify(
      {
        name: "@terax/pi-host",
        generatedAt: new Date().toISOString(),
        strategy: "pnpm deploy --prod --legacy --config.node-linker=hoisted",
      },
      null,
      2,
    )}\n`,
  );

  await rm(bundleDir, { recursive: true, force: true });
  await rename(tempDir, bundleDir);
  await writeFile(join(bundleDir, ".gitkeep"), "");
} catch (error) {
  await rm(tempDir, { recursive: true, force: true });
  throw error;
}
