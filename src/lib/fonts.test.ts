import { describe, expect, it } from "vitest";
import { detectMonoFontFamily, resolveFontFamily } from "./fonts";

describe("resolveFontFamily", () => {
  it("falls back to the bundled chain for empty input", () => {
    expect(resolveFontFamily("")).toBe(
      '"JetBrains Mono", SFMono-Regular, Menlo, monospace',
    );
    expect(resolveFontFamily("   ")).toBe(
      '"JetBrains Mono", SFMono-Regular, Menlo, monospace',
    );
  });

  it("quotes a single family name and strips embedded quotes", () => {
    expect(resolveFontFamily("Fira Code")).toBe(
      '"Fira Code", "JetBrains Mono", SFMono-Regular, Menlo, monospace',
    );
    expect(resolveFontFamily("O'Brien")).toBe(
      '"OBrien", "JetBrains Mono", SFMono-Regular, Menlo, monospace',
    );
  });

  it("keeps a full stack as provided and appends the fallback chain", () => {
    expect(resolveFontFamily('"Cascadia Code", Consolas')).toBe(
      '"Cascadia Code", Consolas, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
    );
  });
});

describe("detectMonoFontFamily", () => {
  it("returns the fallback chain when no DOM fonts are available", () => {
    expect(detectMonoFontFamily()).toBe(
      '"JetBrains Mono", SFMono-Regular, Menlo, monospace',
    );
  });
});
