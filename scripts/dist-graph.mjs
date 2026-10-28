// Built-output startup-graph analyzer. Complements scripts/eager-graph.mjs
// (which walks the *source* graph): this one reads the real `dist/` a Vite build
// produced, because chunking decisions (manualChunks, shared-helper hoisting,
// CJS interop) can drag heavy code into the startup graph even when the source
// graph is clean.
//
// A window's startup graph is everything the browser fetches before first
// paint: the entry <script type="module">, every <link rel="modulepreload">, and
// the transitive *static* imports of those chunks. Dynamic `import()` edges are
// lazy boundaries and do not count.
//
// CLI:  node scripts/dist-graph.mjs [distDir]   (exits 1 on a violation)
// Library: used by src/app/dist-budget.test.ts.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Window entry documents emitted by `vite build` (see vite.config.ts input). */
export const WINDOW_HTML = ["index.html", "settings.html"];

/**
 * Chunk-name stems that must never be reachable at startup. Names come from
 * `manualChunks` in vite.config.ts; `ai-*` covers every provider SDK and the
 * shared AI SDK / zod core, `cm-*` every CodeMirror language pack.
 */
export const FORBIDDEN_CHUNK_PATTERNS = [
  /^ai-/,
  /^streamdown$/,
  /^codemirror$/,
  /^cm-(?:lang|legacy)-/,
];

/**
 * Content signatures for AI SDK / zod code that ended up in an anonymously
 * named chunk (the name check cannot see those). Both are runtime strings that
 * survive minification. Other heavy stacks (CodeMirror, Streamdown) have no
 * reliable string marker; they are caught by the sourcemap check below.
 */
export const FORBIDDEN_SIGNATURES = [
  { label: "zod", needle: "ZodError" },
  { label: "ai-sdk", needle: "vercel.ai.error" },
];

/**
 * npm packages that must have no module in any startup chunk. Only checked when
 * the build emitted sourcemaps (`vite build --sourcemap`), which list every
 * module a chunk contains independent of how the chunk is named.
 */
export const FORBIDDEN_PACKAGES = [
  /^zod$/,
  /^ai$/,
  /^@ai-sdk\//,
  /^@codemirror\//,
  /^@lezer\//,
  /^@uiw\//,
  /^@replit\//,
  /^codemirror/,
  /^streamdown$/,
  /^@streamdown\//,
  /^@iconify-json\//,
  /^(?:motion|framer-motion|motion-dom|motion-utils)$/,
  /^(?:@xterm\/|xterm)/,
];

// `import {a as b} from "./x.js"`, `import "./x.js"`, `export * from "./x.js"`,
// `export {a} from "./x.js"`. The clause alphabet has no `(`/quote so dynamic
// `import("./x.js")` and `import.meta` never match.
const STATIC_EDGE =
  /(?:^|[;}\n])\s*(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?(?:"([^"\n]+)"|'([^'\n]+)')/g;

/** Relative specifiers statically imported by a built chunk's source. */
export function staticImports(code) {
  const out = new Set();
  STATIC_EDGE.lastIndex = 0;
  let m;
  while ((m = STATIC_EDGE.exec(code))) {
    const spec = m[1] ?? m[2];
    if (spec.startsWith("./") || spec.startsWith("../")) out.add(spec);
  }
  return [...out];
}

const ATTR = /([\w:-]+)\s*=\s*"([^"]*)"/g;

function attrs(tag) {
  const out = {};
  ATTR.lastIndex = 0;
  let m;
  while ((m = ATTR.exec(tag))) out[m[1]] = m[2];
  return out;
}

/**
 * Assets a built HTML document asks the browser to load up front.
 * @returns {{ scripts: string[], preloads: string[], styles: string[] }} hrefs
 * as written (root-relative `/assets/x.js`).
 */
export function parseHtmlAssets(html) {
  const scripts = [];
  const preloads = [];
  const styles = [];
  for (const m of html.matchAll(/<script\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (a.type === "module" && a.src) scripts.push(a.src);
  }
  for (const m of html.matchAll(/<link\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (!a.href) continue;
    if (a.rel === "modulepreload") preloads.push(a.href);
    else if (a.rel === "stylesheet") styles.push(a.href);
  }
  return { scripts, preloads, styles };
}

/** `/assets/x.js` -> `assets/x.js` (dist-relative, posix). */
function distPath(href) {
  return posix.normalize(href.replace(/^\/+/, ""));
}

/** Strip the content hash: `ai-anthropic-BhxtMjzw.js` -> `ai-anthropic`. */
export function chunkName(file) {
  const base = posix.basename(file).replace(/\.js$/, "");
  return base.replace(/-[A-Za-z0-9_-]{8}$/, "");
}


/**
 * npm packages named in a chunk's sourcemap (null when no map was emitted).
 * Resolved from the last `node_modules/` segment so pnpm's
 * `.pnpm/<pkg>@<ver>/node_modules/` indirection yields the real package.
 */
export function packagesFromMap(mapText) {
  if (mapText == null) return null;
  const out = new Set();
  for (const source of JSON.parse(mapText).sources ?? []) {
    const m = String(source).match(/.*node_modules\/((?:@[^/]+\/)?[^/]+)/);
    if (m) out.add(m[1]);
  }
  return out;
}

/**
 * Walk the startup graph of one HTML document.
 * `readChunk(distRelativePath)` returns source text (or null if missing), which
 * keeps the walk pure and testable without touching the filesystem.
 *
 * @returns {{ files: Map<string, { bytes: number, via: string | null }>,
 *   styles: string[], missing: string[] }} `via` is the parent chunk that first
 *   reached the file by a static import (null for html-declared roots).
 */
export function traceStartup(html, readChunk) {
  const { scripts, preloads, styles } = parseHtmlAssets(html);
  const files = new Map();
  const missing = [];
  const queue = [];
  for (const href of [...scripts, ...preloads]) {
    queue.push({ file: distPath(href), via: null });
  }
  while (queue.length) {
    const { file, via } = queue.shift();
    if (files.has(file)) continue;
    const code = readChunk(file);
    if (code == null) {
      missing.push(file);
      continue;
    }
    files.set(file, {
      bytes: Buffer.byteLength(code),
      via,
      code,
      packages: packagesFromMap(readChunk(`${file}.map`)),
    });
    for (const spec of staticImports(code)) {
      queue.push({
        file: posix.normalize(posix.join(posix.dirname(file), spec)),
        via: file,
      });
    }
  }
  return { files, styles: styles.map(distPath), missing };
}

/**
 * Forbidden chunks reachable at startup.
 * @returns {{ file: string, reason: string, via: string | null }[]}
 */
export function findViolations(trace) {
  const out = [];
  for (const [file, info] of trace.files) {
    const name = chunkName(file);
    if (FORBIDDEN_CHUNK_PATTERNS.some((re) => re.test(name))) {
      out.push({ file, reason: `forbidden chunk "${name}"`, via: info.via });
      continue;
    }
    const hit = [...(info.packages ?? [])].find((pkg) =>
      FORBIDDEN_PACKAGES.some((re) => re.test(pkg)),
    );
    if (hit) {
      out.push({ file, reason: `bundles package "${hit}"`, via: info.via });
      continue;
    }
    for (const { label, needle } of FORBIDDEN_SIGNATURES) {
      if (info.code.includes(needle)) {
        out.push({
          file,
          reason: `contains ${label} code ("${needle}")`,
          via: info.via,
        });
        break;
      }
    }
  }
  return out;
}

/** Sum of startup JS bytes for a trace. */
export function startupBytes(trace) {
  let total = 0;
  for (const info of trace.files.values()) total += info.bytes;
  return total;
}

/** Analyze every window document in a built dist directory. */
export function analyzeDist(distDir, windows = WINDOW_HTML) {
  const readChunk = (rel) => {
    const p = join(distDir, rel);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  const result = {};
  for (const htmlFile of windows) {
    const html = readChunk(htmlFile);
    if (html == null) throw new Error(`missing ${htmlFile} in ${distDir}`);
    const trace = traceStartup(html, readChunk);
    result[htmlFile] = {
      trace,
      violations: findViolations(trace),
      bytes: startupBytes(trace),
    };
  }
  return result;
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const distDir = resolve(process.argv[2] ?? join(root, "dist"));
  const verbose = process.argv.includes("--verbose");
  let failed = false;
  for (const [html, r] of Object.entries(analyzeDist(distDir))) {
    const kb = (r.bytes / 1024).toFixed(1);
    console.log(`\n${html}: ${r.trace.files.size} startup chunks, ${kb} KiB JS`);
    if (verbose) {
      for (const [f, i] of r.trace.files) {
        console.log(`  ${String(i.bytes).padStart(8)}  ${f}`);
      }
    }
    for (const miss of r.trace.missing) console.log(`  ! missing ${miss}`);
    for (const v of r.violations) {
      failed = true;
      console.log(`  x ${v.file}: ${v.reason}${v.via ? ` (via ${v.via})` : ""}`);
    }
  }
  if (failed) {
    console.error(
      "\nStartup graph pulls forbidden chunks; check manualChunks in vite.config.ts.",
    );
    process.exit(1);
  }
  console.log("\nstartup graph clean");
}
