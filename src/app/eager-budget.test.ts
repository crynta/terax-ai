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
});
