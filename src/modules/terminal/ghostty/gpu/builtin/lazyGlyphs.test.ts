import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function fresh() {
  vi.resetModules();
  const fonts = await import("@/lib/fonts");
  const glyphs = await import("../BuiltinGlyphs");
  const lazy = await import("./lazyGlyphs");
  return { fonts, glyphs, lazy };
}

const SPEC = { width: 8, height: 16, thickness: 1 };

describe("lazily loaded builtin glyphs", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("./legacyComputing"));

  it("claims their ranges without loading anything", async () => {
    const { glyphs, lazy } = await fresh();
    for (const codepoint of [0x25e2, 0x1fb00, 0x1fb70, 0x1cd00]) {
      expect(lazy.isLazyBuiltin(codepoint)).toBe(true);
      expect(glyphs.isBuiltinGlyph(codepoint)).toBe(true);
    }
    for (const codepoint of [0x2500, 0x2588, 0x2800, 0xe0b0, 0x41]) {
      expect(lazy.isLazyBuiltin(codepoint)).toBe(false);
    }
    expect(lazy.lazyBuiltinDraw()).toBeNull();
  });

  it("draws nothing while loading, then draws and announces the arrival once", async () => {
    const { fonts, glyphs, lazy } = await fresh();
    const renderer = new glyphs.BuiltinGlyphRenderer(SPEC);
    const epoch = fonts.symbolFontEpoch();
    const notified = vi.fn();
    fonts.subscribeSymbolFonts(notified);

    expect(renderer.render(0x1fb00)).toBeNull();
    expect(glyphs.builtinGlyphPending(0x1fb00)).toBe(true);
    // A glyph that is always eager never waits.
    expect(glyphs.builtinGlyphPending(0x2500)).toBe(false);
    expect(renderer.render(0x2500)).not.toBeNull();
    expect(notified).not.toHaveBeenCalled();

    await lazy.loadLazyBuiltin();
    expect(notified).toHaveBeenCalledTimes(1);
    expect(fonts.symbolFontEpoch()).toBe(epoch + 1);
    expect(glyphs.builtinGlyphPending(0x1fb00)).toBe(false);
    expect(renderer.render(0x1fb00)?.some((value) => value > 0)).toBe(true);
    expect(renderer.render(0x25e2)?.some((value) => value > 0)).toBe(true);

    // Further requests reuse the loaded code.
    await lazy.loadLazyBuiltin();
    glyphs.builtinGlyphPending(0x1fb00);
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it("falls back to the font when the code cannot load", async () => {
    vi.doMock("./legacyComputing", () => {
      throw new Error("chunk missing");
    });
    const { fonts, glyphs, lazy } = await fresh();
    const renderer = new glyphs.BuiltinGlyphRenderer(SPEC);
    const epoch = fonts.symbolFontEpoch();

    expect(glyphs.builtinGlyphPending(0x1fb00)).toBe(true);
    await lazy.loadLazyBuiltin();
    expect(glyphs.builtinGlyphPending(0x1fb00)).toBe(false);
    expect(renderer.render(0x1fb00)).toBeNull();
    expect(fonts.symbolFontEpoch()).toBe(epoch + 1);
  });
});
