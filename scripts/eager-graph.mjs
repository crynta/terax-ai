// Static eager-import tracer. BFS from an entry following only *static* value
// imports (`import ... from "x"`, `export ... from "x"`). `import type` /
// `export type` are erased by the compiler, and `import("x")` /
// `lazy(() => import("x"))` are lazy boundaries, so none of them count toward
// the eager runtime graph. Reports which heavy node_modules packages end up in
// the eager graph and the first local file that pulls each.
//
// CLI:  node scripts/eager-graph.mjs [entry] [comma,separated,watchlist]
// Used as a library by scripts/eager-graph.test.ts to lock the startup budget.
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcAlias = join(root, "src");

export const DEFAULT_WATCH = [
  "@ai-sdk",
  "ai",
  "streamdown",
  "@codemirror",
  "@uiw",
  "motion",
  "@xterm",
  "xterm",
];

const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"];
function resolveLocal(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(srcAlias, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // bare package
  for (const e of exts) {
    const p = base + e;
    if (e && existsSync(p) && statSync(p).isFile()) return p;
  }
  for (const e of exts.slice(1)) {
    const p = join(base, "index" + e);
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

const STATIC_IMPORT =
  /(?:^|\n)\s*import\s+(?!type[\s{])(?:[^"';]*?from\s*)?["']([^"']+)["']/g;
const STATIC_EXPORT_FROM =
  /(?:^|\n)\s*export\s+(?!type[\s{])[^"';]*?from\s*["']([^"']+)["']/g;

function staticSpecs(code) {
  const specs = new Set();
  for (const re of [STATIC_IMPORT, STATIC_EXPORT_FROM]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code))) specs.add(m[1]);
  }
  return [...specs];
}

function pkgOf(spec, watch) {
  return watch.find((w) => spec === w || spec.startsWith(w + "/"));
}

/** @returns {{ moduleCount: number, hits: Map<string, {spec:string, file:string}> }} */
export function traceEager(entry, watch = DEFAULT_WATCH) {
  const entryFile = resolve(root, entry);
  const seen = new Set();
  const queue = [entryFile];
  const hits = new Map();
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    let code;
    try {
      code = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const spec of staticSpecs(code)) {
      const local = resolveLocal(spec, file);
      if (local) {
        queue.push(local);
        continue;
      }
      const pkg = pkgOf(spec, watch);
      if (pkg && !hits.has(pkg)) {
        hits.set(pkg, { spec, file: file.replace(root + "/", "") });
      }
    }
  }
  return { moduleCount: seen.size, hits };
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  const entry = process.argv[2] || "src/main.tsx";
  const watch = process.argv[3] ? process.argv[3].split(",") : DEFAULT_WATCH;
  const { moduleCount, hits } = traceEager(entry, watch);
  console.log(`\nEager graph from ${entry}: ${moduleCount} local modules\n`);
  if (hits.size === 0) {
    console.log("  none of the watched heavy packages are eagerly reachable\n");
  } else {
    console.log("  HEAVY PACKAGES IN EAGER GRAPH:");
    for (const [pkg, info] of hits) {
      console.log(
        `  x ${pkg.padEnd(14)} via ${info.spec}\n       first pulled by: ${info.file}`,
      );
    }
    console.log("");
  }
}
