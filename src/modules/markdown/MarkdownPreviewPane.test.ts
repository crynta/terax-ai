import { math } from "@streamdown/math";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "MarkdownPreviewPane.tsx"), "utf8");
const tauriConfig = readFileSync(
  path.join(here, "../../../src-tauri/tauri.conf.json"),
  "utf8",
);
const streamdownMatch = src.match(/<Streamdown[\s\S]*?<\/Streamdown>/);
const streamdownJsx = streamdownMatch?.[0] ?? "";

describe("MarkdownPreviewPane Streamdown configuration", () => {
  it("renders complete markdown files in static mode", () => {
    expect(streamdownJsx).toMatch(/mode="static"/);
  });

  it("enables KaTeX math rendering for display equations", () => {
    expect(src).toMatch(/import \{ math \} from "@streamdown\/math"/);
    expect(streamdownJsx).toMatch(/plugins=\{plugins\}/);
    expect(src).toContain('import "katex/dist/katex.min.css";');
  });

  it("renders display equations as KaTeX", () => {
    const html = renderToStaticMarkup(
      createElement(
        Streamdown,
        { mode: "static", plugins: { math } },
        "$$\nx^2\n$$",
      ),
    );
    expect(html).toContain("katex-display");
  });

  it("allows HTTPS image sources while preserving the CSP restriction", () => {
    expect(tauriConfig).toContain("img-src 'self' data: asset: https:");
    expect(tauriConfig).not.toContain("img-src 'self' data: asset: http:");
  });

  it("does not run streaming incomplete-markdown repair for files", () => {
    expect(streamdownJsx).toMatch(/parseIncompleteMarkdown=\{false\}/);
  });
});
