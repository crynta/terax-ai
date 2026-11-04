import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveFontFamily } from "./fonts";

const FALLBACK =
  '"JetBrains Mono", "Symbols Nerd Font Mono", "Symbols Nerd Font", "Terax Terminal Symbols", "Terax Terminal Symbols MDI", SFMono-Regular, Menlo, monospace';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A canvas whose text width depends only on which families appear in the font string. */
function measuringCanvas(installed: ReadonlyMap<string, number>) {
  const context = {
    font: "",
    measureText: vi.fn((text: string) => {
      const generic = /(monospace|sans-serif|serif)$/.exec(context.font)?.[1];
      let width = 100 + (generic === "serif" ? 10 : 0);
      for (const [family, delta] of installed) {
        if (context.font.includes(`"${family}"`)) {
          width = 130 + delta + text.length;
          break;
        }
      }
      return { width };
    }),
  };
  vi.stubGlobal("document", {
    createElement: () => ({ getContext: () => context }),
  });
  return context;
}

describe("terminal font availability", () => {
  it("does not accept an absent font when FontFaceSet.check returns true", async () => {
    const context = {
      font: "",
      measureText: () => ({
        width: context.font.endsWith("serif") ? 110 : 100,
      }),
    };
    vi.stubGlobal("document", {
      fonts: { check: () => true },
      createElement: () => ({ getContext: () => context }),
    });
    const { detectMonoFontFamily } = await import("./fonts");
    expect(detectMonoFontFamily()).toBe(FALLBACK);
  });

  it("finds an installed later candidate and caches its measurements", async () => {
    const context = measuringCanvas(new Map([["Hack Nerd Font", 0]]));
    const { detectMonoFontFamily } = await import("./fonts");
    expect(detectMonoFontFamily()).toBe(`"Hack Nerd Font", ${FALLBACK}`);
    const calls = context.measureText.mock.calls.length;
    detectMonoFontFamily();
    expect(context.measureText).toHaveBeenCalledTimes(calls);
  });

  it("detects an installed font that equals one generic family's metrics", async () => {
    // Same width as `monospace` alone, but different from `serif` and `sans-serif`.
    const context = {
      font: "",
      measureText: (text: string) => ({
        width: context.font.includes('"Hack Nerd Font"')
          ? text.length * 10
          : context.font.endsWith("monospace")
            ? text.length * 10
            : text.length * 7,
      }),
    };
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => context }),
    });
    const { isFontAvailable } = await import("./fonts");
    expect(isFontAvailable("Hack Nerd Font")).toBe(true);
    expect(isFontAvailable("Nonexistent Font")).toBe(false);
  });

  it("reports nothing available without a canvas", async () => {
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => null }),
    });
    const { detectMonoFontFamily, isFontAvailable } = await import("./fonts");
    expect(isFontAvailable("Anything")).toBe(false);
    expect(detectMonoFontFamily()).toBe(FALLBACK);
  });

  it("loads text and symbol fonts before rasterization, only once per window", async () => {
    const load = vi.fn(async () => []);
    vi.stubGlobal("document", { fonts: { load } });
    const { ensureMonoFontsLoaded } = await import("./fonts");
    const first = ensureMonoFontsLoaded();
    expect(ensureMonoFontsLoaded()).toBe(first);
    await first;
    expect(load).toHaveBeenCalledWith('400 14px "JetBrains Mono"');
    expect(load).toHaveBeenCalledWith('700 14px "JetBrains Mono"');
    expect(load).toHaveBeenCalledWith(
      '400 14px "Terax Terminal Symbols"',
      "",
    );
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("never loads the Material Design face with the text fonts", async () => {
    const load = vi.fn(async () => []);
    vi.stubGlobal("document", { fonts: { load } });
    const { ensureMonoFontsLoaded } = await import("./fonts");
    await ensureMonoFontsLoaded();
    for (const [font] of load.mock.calls as unknown as [string][]) {
      expect(font).not.toContain("MDI");
    }
  });

  it("waits for the symbol font before allowing canvas rasterization", async () => {
    let resolveSymbols: () => void = () => undefined;
    const load = vi.fn((font: string) =>
      font.includes("Terax Terminal Symbols")
        ? new Promise<void>((resolve) => {
            resolveSymbols = resolve;
          })
        : Promise.resolve([]),
    );
    vi.stubGlobal("document", { fonts: { load } });
    const { ensureMonoFontsLoaded } = await import("./fonts");
    const ready = ensureMonoFontsLoaded();
    const complete = vi.fn();
    void ready.then(complete);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(complete).not.toHaveBeenCalled();
    resolveSymbols();
    await ready;
    expect(complete).toHaveBeenCalledOnce();
  });

  it("allows rasterization if the symbol font cannot be loaded", async () => {
    const load = vi.fn((font: string) =>
      font.includes("Terax Terminal Symbols")
        ? Promise.reject(new Error("Font unavailable"))
        : Promise.resolve([]),
    );
    vi.stubGlobal("document", { fonts: { load } });
    const { ensureMonoFontsLoaded } = await import("./fonts");
    await expect(ensureMonoFontsLoaded()).resolves.toBeUndefined();
  });
});

describe("Material Design icon face", () => {
  it("loads on the first request only and announces its arrival", async () => {
    let finish: () => void = () => undefined;
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("document", { fonts: { load } });
    const fonts = await import("./fonts");
    const heard = vi.fn();
    fonts.subscribeSymbolFonts(heard);

    expect(fonts.extendedSymbolsPending()).toBe(true);
    expect(fonts.extendedSymbolsPending()).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(
      '400 14px "Terax Terminal Symbols MDI"',
      "\u{f024b}",
    );
    expect(fonts.symbolFontEpoch()).toBe(0);

    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fonts.extendedSymbolsPending()).toBe(false);
    expect(fonts.symbolFontEpoch()).toBe(1);
    expect(heard).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("settles when the face cannot load, so the glyph reaches the system fallback", async () => {
    const load = vi.fn(() => Promise.reject(new Error("missing")));
    vi.stubGlobal("document", { fonts: { load } });
    const fonts = await import("./fonts");
    expect(fonts.extendedSymbolsPending()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fonts.extendedSymbolsPending()).toBe(false);
    expect(fonts.symbolFontEpoch()).toBe(1);
  });

  it("never waits where there is no font loading", async () => {
    vi.stubGlobal("document", {});
    const fonts = await import("./fonts");
    expect(fonts.extendedSymbolsPending()).toBe(false);
  });

  it("stops notifying an unsubscribed listener", async () => {
    const load = vi.fn(async () => []);
    vi.stubGlobal("document", { fonts: { load } });
    const fonts = await import("./fonts");
    const heard = vi.fn();
    const stop = fonts.subscribeSymbolFonts(heard);
    stop();
    fonts.extendedSymbolsPending();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heard).not.toHaveBeenCalled();
  });
});

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

  it("keeps the bundled symbol faces ahead of every system fallback", () => {
    const chain = resolveFontFamily("Hack Nerd Font");
    const symbols = chain.indexOf('"Terax Terminal Symbols"');
    expect(symbols).toBeGreaterThan(chain.indexOf('"JetBrains Mono"'));
    expect(chain.indexOf('"Terax Terminal Symbols MDI"')).toBeGreaterThan(
      symbols,
    );
    expect(chain.indexOf("SFMono-Regular")).toBeGreaterThan(symbols);
    expect(chain.endsWith("monospace")).toBe(true);
  });
});
