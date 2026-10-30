import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyzeDist,
  chunkName,
  findViolations,
  packagesFromMap,
  parseHtmlAssets,
  staticImports,
  traceStartup,
} from "../../scripts/dist-graph.mjs";

// Complements eager-budget.test.ts. That one walks the *source* import graph;
// this one reads what the bundler actually emitted, because chunk assignment
// can drag heavy code into the startup graph even when the source graph is
// clean (observed: React's CJS interop landed in the lazy `ai-sdk-shared`
// chunk, so the always-eager `react` chunk imported it, and with it every AI
// provider SDK and zod, in both windows). Preloaded bytes are paid by every
// launch, so the AI SDK, zod, Streamdown, CodeMirror and the icon set must stay
// reachable only through dynamic `import()`.

const root = fileURLToPath(new URL("../..", import.meta.url));

describe("dist graph analyzer", () => {
  it("reads only static import edges, not dynamic ones", () => {
    const code = [
      'import{a as b}from"./one.js";import"./two.js";',
      'export{c}from"./three.js";export*from"./four.js";',
      'const lazy=()=>import("./lazy.js");',
      'import.meta.url;import x,{y}from"../up.js";',
      'const s="import {z} from \\"./string.js\\"";',
      'import{r}from"pkg";',
    ].join("\n");
    expect(staticImports(code).sort()).toEqual(
      ["../up.js", "./four.js", "./one.js", "./three.js", "./two.js"].sort(),
    );
  });

  it("collects entry scripts, modulepreloads and stylesheets from html", () => {
    const html = `<head>
      <script>var inline = 1</script>
      <script type="module" crossorigin src="/assets/main-AAAA1111.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/react-BBBB2222.js">
      <link rel="stylesheet" crossorigin href="/assets/app-CCCC3333.css">
      <link rel="icon" href="/logo.png">
    </head>`;
    expect(parseHtmlAssets(html)).toEqual({
      scripts: ["/assets/main-AAAA1111.js"],
      preloads: ["/assets/react-BBBB2222.js"],
      styles: ["/assets/app-CCCC3333.css"],
    });
  });

  it("strips the content hash from chunk names", () => {
    expect(chunkName("assets/ai-sdk-shared-CAWduq6e.js")).toBe("ai-sdk-shared");
    expect(chunkName("assets/cm-lang-css-Bzp8a_YD.js")).toBe("cm-lang-css");
    expect(chunkName("assets/react-Cg0CyNNP.js")).toBe("react");
  });

  it("resolves npm packages through pnpm's nested node_modules", () => {
    const map = JSON.stringify({
      sources: [
        "../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core.js",
        "../../node_modules/.pnpm/@ai-sdk+gateway@3/node_modules/@ai-sdk/gateway/dist/index.mjs",
        "../../src/main.tsx",
      ],
    });
    expect([...(packagesFromMap(map) ?? [])].sort()).toEqual([
      "@ai-sdk/gateway",
      "zod",
    ]);
    expect(packagesFromMap(null)).toBeNull();
  });

  it("follows transitive static imports and flags forbidden chunks with their importer", () => {
    // The shape of the original regression: react -> ai-sdk-shared -> ai-*.
    const files: Record<string, string> = {
      "index.html":
        '<script type="module" src="/assets/main-AAAA1111.js"></script>',
      "assets/main-AAAA1111.js": 'import"./react-BBBB2222.js";',
      "assets/react-BBBB2222.js": 'import{n}from"./ai-sdk-shared-CCCC3333.js";',
      "assets/ai-sdk-shared-CCCC3333.js":
        'import{z}from"./ai-anthropic-DDDD4444.js";',
      "assets/ai-anthropic-DDDD4444.js": "export const z=1;",
    };
    const trace = traceStartup(files["index.html"], (p) => files[p] ?? null);
    expect([...trace.files.keys()]).toHaveLength(4);
    expect(
      findViolations(trace).map((v) => [chunkName(v.file), v.via]),
    ).toEqual([
      ["ai-sdk-shared", "assets/react-BBBB2222.js"],
      ["ai-anthropic", "assets/ai-sdk-shared-CCCC3333.js"],
    ]);
  });

  it("catches heavy code hiding in an anonymous chunk, by signature and by sourcemap", () => {
    const files: Record<string, string> = {
      "index.html":
        '<script type="module" src="/assets/main-AAAA1111.js"></script>',
      "assets/main-AAAA1111.js":
        'import"./dist-BBBB2222.js";import"./esm-CCCC3333.js";',
      "assets/dist-BBBB2222.js": 'class E{};E.name="ZodError";',
      "assets/esm-CCCC3333.js": "export const x=1;",
      "assets/esm-CCCC3333.js.map": JSON.stringify({
        sources: [
          "../../node_modules/.pnpm/x/node_modules/@codemirror/state/a.js",
        ],
      }),
    };
    const trace = traceStartup(files["index.html"], (p) => files[p] ?? null);
    expect(findViolations(trace).map((v) => v.reason)).toEqual([
      'contains zod code ("ZodError")',
      'bundles package "@codemirror/state"',
    ]);
  });

  it("passes a clean graph and counts bytes once per chunk", () => {
    const files: Record<string, string> = {
      "index.html":
        '<script type="module" src="/assets/main-AAAA1111.js"></script><link rel="modulepreload" href="/assets/react-BBBB2222.js">',
      "assets/main-AAAA1111.js":
        'import"./react-BBBB2222.js";const l=()=>import("./ai-openai-EEEE5555.js");',
      "assets/react-BBBB2222.js": "export const r=1;",
    };
    const trace = traceStartup(files["index.html"], (p) => files[p] ?? null);
    expect(findViolations(trace)).toEqual([]);
    expect(trace.missing).toEqual([]);
    expect(trace.files.size).toBe(2);
  });
});

describe("built startup graph", () => {
  let outDir = "";

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), "terax-dist-budget-"));
    // Sourcemaps list every module inside each chunk, so the package check does
    // not depend on how a chunk happens to be named. Built into a temp dir:
    // the real dist/ is untouched.
    execFileSync(
      process.execPath,
      [
        join(root, "node_modules/vite/bin/vite.js"),
        "build",
        "--outDir",
        outDir,
        "--emptyOutDir",
        "--sourcemap",
        "--logLevel",
        "error",
      ],
      {
        cwd: root,
        // TERAX_BENCH is explicitly off: a shipped build must not contain the app-lab driver.
        env: { ...process.env, NODE_ENV: "production", TERAX_BENCH: "" },
        stdio: "pipe",
        timeout: 240_000,
      },
    );
  }, 300_000);

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  for (const html of ["index.html", "settings.html"]) {
    it(`${html}: no AI SDK, zod, Streamdown, CodeMirror or icon-set code is preloaded`, () => {
      const result = analyzeDist(outDir, [html])[html];
      expect(result.trace.missing).toEqual([]);
      expect(result.trace.files.size).toBeGreaterThan(5);
      expect(
        result.violations.map(
          (v) => `${v.file}: ${v.reason}${v.via ? ` (via ${v.via})` : ""}`,
        ),
      ).toEqual([]);
    });
  }

  it("keeps the heavy stacks lazily loadable: they exist and are reached by dynamic import", () => {
    const assets = join(outDir, "assets");
    const chunks = readdirSync(assets).filter((f) => f.endsWith(".js"));
    const texts = new Map(
      chunks.map((f) => [f, readFileSync(join(assets, f), "utf8")]),
    );
    const startup = new Set(
      ["index.html", "settings.html"].flatMap((html) => [
        ...analyzeDist(outDir, [html])[html].trace.files.keys(),
      ]),
    );
    for (const stem of [
      "ai-sdk-shared",
      "ai-anthropic",
      "streamdown",
      "codemirror",
      "iconEngine",
    ]) {
      const file = chunks.find((f) => chunkName(f) === stem);
      expect(file, `${stem} chunk should be emitted`).toBeDefined();
      expect(startup.has(`assets/${file}`), `${stem} must not be startup`).toBe(
        false,
      );
      const referenced = [...texts].some(
        ([other, code]) => other !== file && code.includes(file as string),
      );
      expect(referenced, `${stem} must be referenced by a dynamic import`).toBe(
        true,
      );
    }
  });

  it("bundles one shared Lezer highlighter for parsers and themes", () => {
    const assets = join(outDir, "assets");
    const sources = new Set<string>();
    for (const file of readdirSync(assets).filter((f) =>
      f.endsWith(".js.map"),
    )) {
      const map = JSON.parse(readFileSync(join(assets, file), "utf8")) as {
        sources: string[];
      };
      for (const source of map.sources) {
        if (source.includes("/node_modules/@lezer/highlight/")) {
          sources.add(source);
        }
      }
    }
    expect([...sources]).toHaveLength(1);
  });

  it("refuses to build the app-lab driver without its own identifier, and under the product one", () => {
    const build = (extra: Record<string, string>) =>
      execFileSync(
        process.execPath,
        [
          join(root, "node_modules/vite/bin/vite.js"),
          "build",
          "--outDir",
          join(outDir, "guarded"),
          "--logLevel",
          "error",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            NODE_ENV: "production",
            TERAX_BENCH: "1",
            ...extra,
          },
          stdio: "pipe",
          timeout: 60_000,
        },
      );
    const failure = (extra: Record<string, string>): string => {
      try {
        build(extra);
      } catch (error) {
        return String((error as { stderr?: Buffer }).stderr ?? error);
      }
      return "";
    };
    expect(failure({ TERAX_BENCH_IDENTIFIER: "" })).toContain(
      "TERAX_BENCH_IDENTIFIER",
    );
    expect(failure({ TERAX_BENCH_IDENTIFIER: "app.crynta.terax" })).toContain(
      "not the product identifier",
    );
    // Nothing was emitted by either attempt.
    expect(existsSync(join(outDir, "guarded"))).toBe(false);
  }, 120_000);

  it("contains none of the app-lab benchmark driver (TERAX_BENCH is off)", () => {
    // The driver (src/bench) and its Tauri commands exist only in builds made with
    // TERAX_BENCH=1: `__TERAX_BENCH__` is the literal `false` otherwise, so its lazy import, the
    // chunks behind it and every bench-only string are removed before bundling.
    const markers = [
      "bench_config",
      "bench_window",
      "bench_exit",
      "__teraxBenchConfig",
      // The smoothness probe's seam (src/bench/smoothHooks.ts): product code reports to it
      // only behind __TERAX_BENCH__, and the lookup itself is gated too.
      "__teraxSmooth",
      "terax:bench:",
      "TERAX_BENCH",
      "__TERAX_BENCH__",
    ];
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(join(dir, entry.name))
          : [join(dir, entry.name)],
      );
    const emitted = files(outDir).filter((file) => !file.endsWith(".map"));
    expect(
      emitted
        .map((file) => file.slice(outDir.length))
        .filter((file) => /bench/i.test(file)),
    ).toEqual([]);
    const offenders = emitted
      .filter((file) => /\.(js|html|css)$/.test(file))
      .flatMap((file) => {
        const code = readFileSync(file, "utf8");
        return markers
          .filter((marker) => code.includes(marker))
          .map((marker) => `${file.slice(outDir.length)}: ${marker}`);
      });
    expect(offenders).toEqual([]);
  });
});
