import { describe, expect, it } from "vitest";
import { detectMonoFontFamily, loadFontFamily, resolveFontFamily } from "./fonts";

describe("resolveFontFamily", () => {
  it("quotes a bare multi-word family and appends a fallback chain", () => {
    const out = resolveFontFamily("CaskaydiaCove Nerd Font Mono");
    expect(out.startsWith('"CaskaydiaCove Nerd Font Mono"')).toBe(true);
    // A fallback chain follows the primary family.
    expect(out.includes(",")).toBe(true);
    expect(out.length).toBeGreaterThan('"CaskaydiaCove Nerd Font Mono"'.length);
  });

  it("trims surrounding whitespace before quoting", () => {
    expect(resolveFontFamily("  Hack Nerd Font  ")).toBe(
      resolveFontFamily("Hack Nerd Font"),
    );
    expect(resolveFontFamily("  Hack Nerd Font  ").startsWith('"Hack Nerd Font"')).toBe(
      true,
    );
  });

  it("falls back to auto-detect for blank or whitespace-only input", () => {
    expect(resolveFontFamily("")).toBe(detectMonoFontFamily());
    expect(resolveFontFamily("   ")).toBe(detectMonoFontFamily());
  });

  it("does not double-quote an already-quoted family", () => {
    const out = resolveFontFamily('"Iosevka Nerd Font"');
    expect(out.startsWith('""')).toBe(false);
    expect(out.startsWith('"Iosevka Nerd Font"')).toBe(true);
  });

  it("passes through a user-supplied font stack untouched", () => {
    const stack = '"My Font", monospace';
    expect(resolveFontFamily(stack)).toBe(stack);
  });
});

describe("loadFontFamily", () => {
  it("resolves without throwing when there is no document (node)", async () => {
    await expect(loadFontFamily("CaskaydiaCove Nerd Font Mono")).resolves.toBeUndefined();
    await expect(loadFontFamily("")).resolves.toBeUndefined();
    await expect(loadFontFamily('"My Font", monospace')).resolves.toBeUndefined();
  });
});
