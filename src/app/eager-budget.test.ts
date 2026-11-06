import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { traceEager } from "../../scripts/eager-graph.mjs";

// Locks the startup-bundle invariant: the heavy editor / AI / markdown stacks
// must stay out of the eager graph of both window entries so they load only
// when the user opens those surfaces. A static import that re-introduces any of
// these (e.g. a barrel re-export of chat runtime or a
// `cn`-style util getting absorbed into a feature chunk) will fail here.
const HEAVY = [
  "@ai-sdk",
  "ai",
  "streamdown",
  "@codemirror",
  "@uiw",
  "motion",
  "@xterm",
  "xterm",
  // The Catppuccin icon set (~300 kB). Only `explorer/lib/iconEngine.ts` may
  // import it, and only behind the dynamic import in `iconResolver.ts`.
  "@iconify-json",
];

function heavyEagerHits(entry: string): string[] {
  const { hits } = traceEager(entry, HEAVY);
  return [...hits.entries()].map(([pkg, info]) => `${pkg} <- ${info.file}`);
}

describe("startup bundle budget", () => {
  it("keeps the WebGL fallback outside the WebGPU terminal import graph", () => {
    const { files } = traceEager(
      "src/modules/terminal/ghostty/useGhosttyTerminalSession.ts",
    );
    expect(
      [...files].filter((file) => /[/\\]ghostty[/\\]webgl[/\\]/.test(file)),
    ).toEqual([]);
  });
  it("loads link detection, hover, confirmation and activation only on use", () => {
    const { files } = traceEager(
      "src/modules/terminal/ghostty/useGhosttyTerminalSession.ts",
    );
    const lazy =
      /[/\\](?:LazyTerminalLinks|terminalLinksRuntime|ViewportLinkResolver|TerminalLinkInteraction|LinkUnderlineOverlay|terminalLinks|terminalLinkTargets)\.ts$/;
    expect([...files].filter((file) => lazy.test(file))).toEqual([]);
    // What stays eager is one dynamic import, made once the surface exists.
    expect(
      [...files].some((file) => /[/\\]terminalLinksLoader\.ts$/.test(file)),
    ).toBe(true);
  });
  it("ships no xterm model or addons, including lazy dependencies", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
    const packages = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });
    expect(
      packages.filter(
        (name) =>
          name === "xterm" ||
          name.startsWith("@xterm/") ||
          name.startsWith("xterm-addon-"),
      ),
    ).toEqual([]);
    const lock = readFileSync(
      new URL("../../pnpm-lock.yaml", import.meta.url),
      "utf8",
    );
    expect(lock).not.toMatch(/(?:@xterm\/|xterm-addon-|\bxterm@)/);
  });

  it("main window does not eagerly pull editor/AI/markdown stacks", () => {
    expect(heavyEagerHits("src/main.tsx")).toEqual([]);
  });

  it("settings window does not eagerly pull editor/AI/markdown stacks", () => {
    expect(heavyEagerHits("src/settings/main.tsx")).toEqual([]);
  });

  it("keeps rarely used terminal code out of the session import graph", () => {
    // The primary terminal chunk (size-limit) is what every window loads. These load
    // on first use: procedural legacy-computing glyphs, the search engine (the
    // surfaces own a thin controller that imports it on the first find) and the
    // release diagnostics.
    const { files } = traceEager(
      "src/modules/terminal/ghostty/useGhosttyTerminalSession.ts",
    );
    const eager = [...files].map((file) => file.replace(/\\/g, "/"));
    for (const lazy of [
      "ghostty/gpu/builtin/legacyComputing.ts",
      "ghostty/search/GhosttySearchEngine.ts",
      "ghostty/sessionDiagnostics.ts",
      "ghostty/GhosttyBlocks.ts",
    ]) {
      expect(
        eager.filter((file) => file.endsWith(lazy)),
        `${lazy} must stay behind a dynamic import`,
      ).toEqual([]);
    }
    // The lazy glyph code is reached only through its loader, and the loader is eager.
    expect(
      eager.some((file) => file.endsWith("ghostty/gpu/builtin/lazyGlyphs.ts")),
    ).toBe(true);
  });
});
