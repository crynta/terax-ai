import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveFontFamily } from "./fonts";

const FALLBACK =
  '"JetBrains Mono", "Terax Terminal Symbols", SFMono-Regular, Menlo, monospace';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("terminal font availability", () => {
  it("does not accept an absent font when FontFaceSet.check returns true", async () => {
    const context = {
      font: "",
      measureText: () => ({
        width:
          context.font.endsWith("serif") && !context.font.endsWith("monospace")
            ? 110
            : 100,
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
    const context = {
      font: "",
      measureText: vi.fn(() => ({
        width: context.font.includes('"Hack Nerd Font"')
          ? 130
          : context.font.endsWith(", serif") || context.font === "16px serif"
            ? 110
            : 100,
      })),
    };
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => context }),
    });
    const { detectMonoFontFamily } = await import("./fonts");
    expect(detectMonoFontFamily()).toBe(`"Hack Nerd Font", ${FALLBACK}`);
    const calls = context.measureText.mock.calls.length;
    detectMonoFontFamily();
    expect(context.measureText).toHaveBeenCalledTimes(calls);
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
      "\ue0a0\ue718\u{f024b}",
    );
    expect(load).toHaveBeenCalledTimes(3);
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
