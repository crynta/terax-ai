import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Locks the compositing budget documented in TERAX.md. Every composited layer
// costs a backing store (and WebKit allocates a new one per resize step for
// every layer whose size follows the window), so the shell must not create
// layers by default. These constructs force or imply one; they may only appear
// in the files below, each of which gates the layer behind a state the user
// asked for or that lasts a moment.
const SRC = decodeURIComponent(new URL("..", import.meta.url).pathname);

const FORCED_LAYER_PATTERNS: Record<string, RegExp> = {
  "will-change": /will-change|willChange/,
  "3D transform":
    /translateZ|translate3d|translate-z|transform-gpu|backface|perspective/,
  "backdrop filter":
    /backdrop-(?:blur|filter|brightness|saturate)|backdropFilter|supports-backdrop/,
  "filter blur":
    /(?<![-\w])blur-(?:\[|xs|sm|md|lg|xl|2xl|3xl)|filter:\s*blur|drop-shadow/,
};

/** File (relative to src/) -> constructs it may contain, with the reason. */
const ALLOWED: Record<string, { allows: string[]; why: string }> = {
  "modules/theme/SurfaceLayer.tsx": {
    allows: ["3D transform", "filter blur"],
    why: "user background image; layer only when blurred or animated (surfaceOwnsLayer)",
  },
  "components/ui/dialog.tsx": {
    allows: ["backdrop filter"],
    why: "modal scrim, mounted only while open",
  },
  "components/ui/alert-dialog.tsx": {
    allows: ["backdrop filter"],
    why: "modal scrim, mounted only while open",
  },
  "components/ui/sheet.tsx": {
    allows: ["backdrop filter"],
    why: "modal scrim, mounted only while open",
  },
  "components/ai-elements/conversation.tsx": {
    allows: ["backdrop filter"],
    why: "generated AI Element; scroll-to-bottom button exists only while scrolled up",
  },
  "modules/ai/components/PlanDiffReview.tsx": {
    allows: ["backdrop filter"],
    why: "plan review overlay, mounted only during a review",
  },
  "modules/editor/lib/chromeTheme.ts": {
    allows: ["backdrop filter"],
    why: "CodeMirror tooltip, exists only while shown",
  },
};

// The terminal renderer owns its canvases (see its own budget); tests and the
// bench driver are not part of the shipped shell.
const SKIPPED = [`modules${sep}terminal${sep}`, `bench${sep}`];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (/\.(tsx?|css)$/.test(entry.name) && !/\.test\./.test(entry.name))
      out.push(path);
  }
  return out;
}

const files = sources(SRC)
  .map((path) => relative(SRC, path))
  .filter((path) => !SKIPPED.some((skip) => path.startsWith(skip)));

describe("compositing budget", () => {
  it("scans the shell sources", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(join("styles", "globals.css"));
  });

  it("creates no layer by default outside the allowlist", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(SRC, file), "utf8");
      const allowed = ALLOWED[file.split(sep).join("/")]?.allows ?? [];
      for (const [name, pattern] of Object.entries(FORCED_LAYER_PATTERNS)) {
        if (!allowed.includes(name) && pattern.test(text))
          offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders, "add a reason to ALLOWED or remove the layer").toEqual(
      [],
    );
  });

  it("keeps the allowlist honest", () => {
    for (const [file, { allows }] of Object.entries(ALLOWED)) {
      const text = readFileSync(join(SRC, file), "utf8");
      for (const name of allows)
        expect(
          FORCED_LAYER_PATTERNS[name].test(text),
          `${file} no longer uses ${name}; drop it from ALLOWED`,
        ).toBe(true);
    }
  });

  it("gates the page overlay's own layer behind surfaceOwnsLayer", () => {
    const layer = readFileSync(
      join(SRC, "modules/theme/SurfaceLayer.tsx"),
      "utf8",
    );
    expect(layer).toMatch(
      /surfaceOwnsLayer\([^)]*\)\s*\?\s*"translateZ\(0\)"/s,
    );
  });

  it("does not pin the global stylesheet to a layer", () => {
    const css = readFileSync(join(SRC, "styles/globals.css"), "utf8");
    expect(css).not.toMatch(
      /will-change|translateZ|translate3d|backdrop-filter/,
    );
  });
});
