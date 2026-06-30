/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, clearTheme } from "./applyTheme";
import type { Theme } from "./types";

function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

function makeTheme(overrides: Partial<Theme> = {}): Theme {
  return {
    id: "test-theme",
    name: "Test Theme",
    variants: {},
    ...overrides,
  };
}

afterEach(() => {
  // Ensure module-level state and the root element are reset between tests.
  applyTheme(
    makeTheme({ variants: { dark: { colors: { background: "#000" } } } }),
    "dark",
  );
  clearTheme();
});

describe("applyTheme", () => {
  it("maps color keys to their CSS custom properties", () => {
    applyTheme(
      makeTheme({
        variants: {
          dark: {
            colors: {
              background: "#101010",
              cardForeground: "#eeeeee",
              sidebarPrimaryForeground: "#abcdef",
              radius: "0.5rem",
            },
          },
        },
      }),
      "dark",
    );
    expect(cssVar("--background")).toBe("#101010");
    expect(cssVar("--card-foreground")).toBe("#eeeeee");
    expect(cssVar("--sidebar-primary-foreground")).toBe("#abcdef");
    expect(cssVar("--radius")).toBe("0.5rem");
  });

  it("falls back to the dark variant when the requested mode is missing", () => {
    applyTheme(
      makeTheme({
        variants: { dark: { colors: { background: "#222" } } },
      }),
      "light",
    );
    expect(cssVar("--background")).toBe("#222");
  });

  it("falls back to the light variant when dark is also missing", () => {
    applyTheme(
      makeTheme({
        variants: { light: { colors: { background: "#fafafa" } } },
      }),
      "dark",
    );
    expect(cssVar("--background")).toBe("#fafafa");
  });

  it("prefers the requested mode when both variants exist", () => {
    applyTheme(
      makeTheme({
        variants: {
          light: { colors: { background: "#ffffff" } },
          dark: { colors: { background: "#000000" } },
        },
      }),
      "light",
    );
    expect(cssVar("--background")).toBe("#ffffff");
  });

  it("clears all theme variables when no usable variant exists", () => {
    applyTheme(
      makeTheme({ variants: { dark: { colors: { background: "#333" } } } }),
      "dark",
    );
    expect(cssVar("--background")).toBe("#333");

    // A theme with empty variants resolves to no variant and clears.
    applyTheme(makeTheme({ variants: {} }), "dark");
    expect(cssVar("--background")).toBe("");
  });

  it("removes stale variables from a previous theme before applying", () => {
    applyTheme(
      makeTheme({ variants: { dark: { colors: { primary: "#0f0" } } } }),
      "dark",
    );
    expect(cssVar("--primary")).toBe("#0f0");

    applyTheme(
      makeTheme({ variants: { dark: { colors: { background: "#111" } } } }),
      "dark",
    );
    expect(cssVar("--primary")).toBe("");
    expect(cssVar("--background")).toBe("#111");
  });

  it("writes scalar terminal palette fields", () => {
    applyTheme(
      makeTheme({
        variants: {
          dark: {
            terminal: {
              background: "#001",
              foreground: "#fff",
              cursor: "#0ff",
              cursorAccent: "#f0f",
              selection: "rgba(0,0,0,0.3)",
            },
          },
        },
      }),
      "dark",
    );
    expect(cssVar("--terminal-background")).toBe("#001");
    expect(cssVar("--terminal-foreground")).toBe("#fff");
    expect(cssVar("--terminal-cursor")).toBe("#0ff");
    expect(cssVar("--terminal-cursor-accent")).toBe("#f0f");
    expect(cssVar("--terminal-selection")).toBe("rgba(0,0,0,0.3)");
  });

  it("maps the 16-entry ansi palette to ordered ansi variables", () => {
    const ansi = Array.from({ length: 16 }, (_, i) => `#0000${i % 10}0`) as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    applyTheme(
      makeTheme({ variants: { dark: { terminal: { ansi } } } }),
      "dark",
    );
    expect(cssVar("--terminal-ansi-black")).toBe(ansi[0]);
    expect(cssVar("--terminal-ansi-white")).toBe(ansi[7]);
    expect(cssVar("--terminal-ansi-bright-black")).toBe(ansi[8]);
    expect(cssVar("--terminal-ansi-bright-white")).toBe(ansi[15]);
  });
});

describe("clearTheme", () => {
  it("removes all applied theme variables", () => {
    applyTheme(
      makeTheme({
        variants: {
          dark: {
            colors: { background: "#123", primary: "#456" },
            terminal: { cursor: "#789" },
          },
        },
      }),
      "dark",
    );
    expect(cssVar("--background")).toBe("#123");

    clearTheme();
    expect(cssVar("--background")).toBe("");
    expect(cssVar("--primary")).toBe("");
    expect(cssVar("--terminal-cursor")).toBe("");
  });

  it("is a no-op when nothing has been applied", () => {
    // After the prior clear, calling again must not throw and stays empty.
    clearTheme();
    clearTheme();
    expect(cssVar("--background")).toBe("");
  });
});
