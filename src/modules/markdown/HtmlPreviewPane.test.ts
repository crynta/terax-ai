import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Source-level lock on the sandbox: local HTML runs with the asset protocol's
// file scope behind it, so the isolating attributes must never be loosened.
const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "HtmlPreviewPane.tsx"), "utf8");
const iframeJsx = (src.match(/<iframe[\s\S]*?\/>/)?.[0] ?? "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");
const sandbox = iframeJsx.match(/sandbox="([^"]*)"/)?.[1];

describe("HtmlPreviewPane iframe sandbox", () => {
  it("declares a sandboxed iframe", () => {
    expect(iframeJsx).not.toBe("");
    expect(sandbox).toBeDefined();
  });

  it("never grants allow-same-origin", () => {
    expect(sandbox).not.toMatch(/allow-same-origin/);
  });

  it("never grants top navigation", () => {
    expect(sandbox).not.toMatch(/allow-top-navigation/);
  });

  it("never grants popups", () => {
    expect(sandbox).not.toMatch(/allow-popups/);
  });

  it("sets referrerPolicy to no-referrer", () => {
    expect(iframeJsx).toMatch(/referrerPolicy="no-referrer"/);
  });
});
