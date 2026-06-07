import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesDir = dirname(fileURLToPath(import.meta.url));

describe("global styles", () => {
  it("loads KaTeX styles for Streamdown math rendering", () => {
    const css = readFileSync(join(stylesDir, "globals.css"), "utf8");

    expect(css).toContain('@import "katex/dist/katex.min.css";');
    expect(css).toContain(
      '@source "../../node_modules/@streamdown/math/dist/*.js";',
    );
  });
});
