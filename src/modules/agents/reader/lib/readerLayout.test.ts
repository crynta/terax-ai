import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../reader.css", import.meta.url), "utf8");

describe("Reader layout CSS", () => {
  it("never caps prose at a character width", () => {
    expect(css).toMatch(/--reader-measure:\s*none/u);
    expect(css).not.toMatch(/max-width:\s*\d+(?:\.\d+)?ch/u);
  });

  it("shares one wide column for the document and the dock", () => {
    const column = /\.terax-reader-column\s*\{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(column).toMatch(/max-width:\s*1280px/u);
    expect(column).toMatch(/padding-inline:\s*clamp\(16px,\s*2vw,\s*24px\)/u);
  });
});
