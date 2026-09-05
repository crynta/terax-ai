import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectMonoFontFamily,
  resetDetectedMonoFontFamily,
  resolveFontFamily,
} from "./fonts";

const FALLBACK = '"JetBrains Mono", SFMono-Regular, Menlo, monospace';

describe("resolveFontFamily", () => {
  beforeEach(() => {
    resetDetectedMonoFontFamily();
  });

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

describe("detectMonoFontFamily", () => {
  beforeEach(() => {
    resetDetectedMonoFontFamily();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetDetectedMonoFontFamily();
  });

  it("uses document.fonts.check when it reports a Nerd Font", () => {
    vi.stubGlobal("document", {
      fonts: {
        check: (spec: string) => spec.includes("MesloLGS NF"),
      },
      createElement: () => {
        throw new Error("canvas should not be needed when check hits");
      },
    });

    expect(detectMonoFontFamily()).toBe(`"MesloLGS NF", ${FALLBACK}`);
  });

  it("falls back to canvas measureText when fonts.check is false (WKWebView)", () => {
    let currentFont = "";
    const measureText = vi.fn(() => ({
      width: currentFont.includes("MesloLGS NF") ? 120 : 100,
    }));
    vi.stubGlobal("document", {
      fonts: {
        check: () => false,
      },
      createElement: (tag: string) => {
        if (tag !== "canvas") throw new Error(`unexpected ${tag}`);
        return {
          getContext: () => ({
            set font(value: string) {
              currentFont = value;
            },
            get font() {
              return currentFont;
            },
            measureText,
          }),
        };
      },
    });

    expect(detectMonoFontFamily()).toBe(`"MesloLGS NF", ${FALLBACK}`);
    expect(measureText).toHaveBeenCalled();
  });

  it("returns the mono fallback when neither check nor canvas finds a font", () => {
    vi.stubGlobal("document", {
      fonts: {
        check: () => false,
      },
      createElement: () => ({
        getContext: () => ({
          font: "",
          measureText: () => ({ width: 42 }),
        }),
      }),
    });

    expect(detectMonoFontFamily()).toBe(FALLBACK);
  });

  it("memoizes the first detection result", () => {
    const check = vi.fn(() => false);
    vi.stubGlobal("document", {
      fonts: { check },
      createElement: () => ({
        getContext: () => ({
          font: "",
          measureText: () => ({ width: 42 }),
        }),
      }),
    });

    expect(detectMonoFontFamily()).toBe(FALLBACK);
    const firstPass = check.mock.calls.length;
    expect(firstPass).toBeGreaterThan(0);
    expect(detectMonoFontFamily()).toBe(FALLBACK);
    expect(check.mock.calls.length).toBe(firstPass);
  });
});