import { afterEach, describe, expect, it, vi } from "vitest";
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

type FakeStyle = {
  id: string;
  textContent: string;
  appendChild: (node: { text: string }) => void;
};

// vitest runs in the node environment (no DOM), so stub a minimal document to
// observe what registerLocalFont injects into the FontFaceSet.
function installFakeDocument() {
  const children: FakeStyle[] = [];
  const loaded: string[] = [];
  const doc = {
    head: {
      appendChild(el: FakeStyle) {
        children.push(el);
      },
    },
    fonts: {
      load(spec: string) {
        loaded.push(spec);
        return Promise.resolve([]);
      },
    },
    getElementById(id: string): FakeStyle | null {
      return children.find((c) => c.id === id) ?? null;
    },
    createElement(_tag: string): FakeStyle {
      const style: FakeStyle = {
        id: "",
        textContent: "",
        appendChild(node) {
          style.textContent += node.text;
        },
      };
      return style;
    },
    createTextNode(text: string) {
      return { text };
    },
  };
  vi.stubGlobal("document", doc);
  return { children, loaded };
}

describe("registerLocalFont", () => {
  // Reset modules between tests so the module-level dedup Set starts empty.
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("injects a local() @font-face for weights 400/700 and loads the family", async () => {
    const { children, loaded } = installFakeDocument();
    const { registerLocalFont } = await import("./fonts");

    await registerLocalFont("ComicShannsMono Nerd Font Mono");

    expect(children).toHaveLength(1);
    const style = children[0];
    expect(style.id).toBe("terax-local-fonts");
    expect(style.textContent).toContain(
      'src:local("ComicShannsMono Nerd Font Mono")',
    );
    expect(style.textContent).toContain("font-weight:400");
    expect(style.textContent).toContain("font-weight:700");
    expect(loaded).toEqual([
      '400 14px "ComicShannsMono Nerd Font Mono"',
      '700 14px "ComicShannsMono Nerd Font Mono"',
    ]);
  });

  it("is a no-op for blank input", async () => {
    const { children, loaded } = installFakeDocument();
    const { registerLocalFont } = await import("./fonts");

    await registerLocalFont("   ");

    expect(children).toHaveLength(0);
    expect(loaded).toHaveLength(0);
  });

  it("is a no-op for a comma-separated stack", async () => {
    const { children, loaded } = installFakeDocument();
    const { registerLocalFont } = await import("./fonts");

    await registerLocalFont("Foo, Bar");

    expect(children).toHaveLength(0);
    expect(loaded).toHaveLength(0);
  });

  it("strips surrounding quotes and registers each family only once", async () => {
    const { children, loaded } = installFakeDocument();
    const { registerLocalFont } = await import("./fonts");

    await registerLocalFont('"Fira Code"');
    await registerLocalFont("Fira Code"); // same family — already registered

    expect(children).toHaveLength(1);
    const style = children[0];
    expect(style.textContent.match(/@font-face/g)).toHaveLength(2);
    expect(style.textContent).toContain('local("Fira Code")');
    // load() still runs for both invocations (a no-op once cached).
    expect(loaded).toHaveLength(4);
  });
});
