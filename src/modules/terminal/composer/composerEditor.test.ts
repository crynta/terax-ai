import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "composerEditor.ts"), "utf8");
const highlightStyle = src.match(
  /const composerHighlightStyle = HighlightStyle\.define\(\[[\s\S]*?\]\);/,
)?.[0];

describe("terminal composer editor extensions", () => {
  it("installs syntax highlighting for loaded language modes", () => {
    expect(src).toMatch(/composerHighlightStyle/);
    expect(src).not.toMatch(/textDecoration:\s*"underline"/);
  });

  it("uses composer-specific token colors instead of UI theme colors", () => {
    expect(highlightStyle).toContain("--composer-syntax-keyword");
    expect(highlightStyle).not.toMatch(/var\(--primary\)/);
    expect(highlightStyle).not.toMatch(/var\(--chart-\d\)/);
  });

  it("enables editor completions and bracket closing", () => {
    expect(src).toMatch(/autocompletion\(/);
    expect(src).toMatch(/closeBrackets\(\)/);
  });
});
