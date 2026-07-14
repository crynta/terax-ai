import { describe, expect, it } from "vitest";
import { resolveFontFamily } from "./fonts";

const FALLBACK = '"JetBrains Mono", SFMono-Regular, Menlo, monospace';

describe("resolveFontFamily", () => {
  it("quotes a bare family and appends the mono fallback", () => {
    expect(resolveFontFamily("JetBrainsMono Nerd Font")).toBe(
      `"JetBrainsMono Nerd Font", ${FALLBACK}`,
    );
  });

  it("does not double-quote an already-quoted family", () => {
    expect(resolveFontFamily('"Fira Code"')).toBe(`"Fira Code", ${FALLBACK}`);
  });

  it("passes a comma-separated stack through and still appends fallback", () => {
    expect(resolveFontFamily("Foo, Bar")).toBe(`Foo, Bar, ${FALLBACK}`);
  });

  it("strips stray internal quotes to avoid a malformed token", () => {
    expect(resolveFontFamily('Foo"Bar')).toBe(`"FooBar", ${FALLBACK}`);
  });

  it("trims surrounding whitespace before quoting", () => {
    expect(resolveFontFamily("  Hack Nerd Font  ")).toBe(
      `"Hack Nerd Font", ${FALLBACK}`,
    );
  });

  it("falls back to the mono chain for empty input", () => {
    expect(resolveFontFamily("")).toBe(FALLBACK);
    expect(resolveFontFamily("   ")).toBe(FALLBACK);
  });
});
