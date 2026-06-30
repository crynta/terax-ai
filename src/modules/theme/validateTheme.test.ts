import { describe, expect, it } from "vitest";
import type { Theme } from "./types";
import { validateTheme } from "./validateTheme";

function expectError(raw: unknown): string {
  const res = validateTheme(raw);
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("expected validation to fail");
  return res.error;
}

function expectOk(raw: unknown): Theme {
  const res = validateTheme(raw);
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(`expected validation to pass: ${res.error}`);
  return res.theme;
}

const minimal = {
  id: "my-theme",
  name: "My Theme",
  variants: { dark: { colors: { background: "#000" } } },
};

describe("validateTheme", () => {
  describe("top-level shape", () => {
    it("rejects non-object roots", () => {
      expect(expectError(null)).toBe("Theme must be a JSON object");
      expect(expectError(undefined)).toBe("Theme must be a JSON object");
      expect(expectError("string")).toBe("Theme must be a JSON object");
      expect(expectError(42)).toBe("Theme must be a JSON object");
      expect(expectError([])).toBe("Theme must be a JSON object");
    });

    it("accepts a minimal valid theme", () => {
      const theme = expectOk(minimal);
      expect(theme.id).toBe("my-theme");
      expect(theme.name).toBe("My Theme");
      expect(theme.variants.dark?.colors).toEqual({ background: "#000" });
    });
  });

  describe("id validation", () => {
    it("requires a kebab-case id", () => {
      const msg = "id must be a kebab-case string (a-z, 0-9, -)";
      expect(expectError({ ...minimal, id: undefined })).toBe(msg);
      expect(expectError({ ...minimal, id: 123 })).toBe(msg);
      expect(expectError({ ...minimal, id: "Has Caps" })).toBe(msg);
      expect(expectError({ ...minimal, id: "UPPER" })).toBe(msg);
      expect(expectError({ ...minimal, id: "has_underscore" })).toBe(msg);
      expect(expectError({ ...minimal, id: "trailing space " })).toBe(msg);
    });

    it("rejects single-character ids (min length is 2)", () => {
      // ID_RE requires at least 2 chars: [a-z0-9][a-z0-9-]{1,63}
      expect(validateTheme({ ...minimal, id: "a" }).ok).toBe(false);
    });

    it("rejects ids that start with a hyphen", () => {
      expect(validateTheme({ ...minimal, id: "-leading" }).ok).toBe(false);
    });

    it("accepts ids with digits and internal hyphens", () => {
      expect(expectOk({ ...minimal, id: "theme-01-dark" }).id).toBe(
        "theme-01-dark",
      );
    });

    it("rejects ids longer than 64 characters", () => {
      const tooLong = `a${"b".repeat(64)}`; // 65 chars
      expect(validateTheme({ ...minimal, id: tooLong }).ok).toBe(false);
      const maxLen = `a${"b".repeat(63)}`; // 64 chars
      expect(validateTheme({ ...minimal, id: maxLen }).ok).toBe(true);
    });
  });

  describe("name validation", () => {
    it("requires a non-empty name", () => {
      const msg = "name must be a non-empty string";
      expect(expectError({ ...minimal, name: undefined })).toBe(msg);
      expect(expectError({ ...minimal, name: "" })).toBe(msg);
      expect(expectError({ ...minimal, name: "   " })).toBe(msg);
      expect(expectError({ ...minimal, name: 7 })).toBe(msg);
    });

    it("trims surrounding whitespace from the name", () => {
      expect(expectOk({ ...minimal, name: "  Padded  " }).name).toBe("Padded");
    });
  });

  describe("variants validation", () => {
    it("requires variants to be an object", () => {
      expect(expectError({ ...minimal, variants: undefined })).toBe(
        "variants must be an object",
      );
      expect(expectError({ ...minimal, variants: "x" })).toBe(
        "variants must be an object",
      );
    });

    it("requires at least one of light or dark", () => {
      expect(expectError({ ...minimal, variants: {} })).toBe(
        "variants must contain at least one of: light, dark",
      );
    });

    it("accepts a light-only theme", () => {
      const theme = expectOk({
        ...minimal,
        variants: { light: { colors: { foreground: "#fff" } } },
      });
      expect(theme.variants.light?.colors).toEqual({ foreground: "#fff" });
      expect(theme.variants.dark).toBeUndefined();
    });

    it("accepts both light and dark variants", () => {
      const theme = expectOk({
        ...minimal,
        variants: {
          light: { colors: { background: "#fff" } },
          dark: { colors: { background: "#000" } },
        },
      });
      expect(theme.variants.light).toBeDefined();
      expect(theme.variants.dark).toBeDefined();
    });

    it("rejects a non-object variant", () => {
      expect(expectError({ ...minimal, variants: { dark: 5 } })).toBe(
        "variants.dark must be an object",
      );
    });

    it("allows an empty variant object (no colors, no terminal)", () => {
      const theme = expectOk({ ...minimal, variants: { dark: {} } });
      expect(theme.variants.dark).toEqual({ colors: {}, terminal: {} });
    });
  });

  describe("colors validation", () => {
    it("rejects colors that are not an object", () => {
      expect(
        expectError({ ...minimal, variants: { dark: { colors: [] } } }),
      ).toBe("variants.dark.colors must be an object");
    });

    it("rejects unrecognized color keys", () => {
      expect(
        expectError({
          ...minimal,
          variants: { dark: { colors: { notAColor: "#000" } } },
        }),
      ).toBe("variants.dark.colors.notAColor is not a recognized color key");
    });

    it("rejects empty-string color values", () => {
      expect(
        expectError({
          ...minimal,
          variants: { dark: { colors: { background: "" } } },
        }),
      ).toBe("variants.dark.colors.background must be a non-empty string");
    });

    it("rejects non-string color values", () => {
      expect(
        expectError({
          ...minimal,
          variants: { dark: { colors: { background: 16 } } },
        }),
      ).toBe("variants.dark.colors.background must be a non-empty string");
    });

    it("accepts every recognized color key", () => {
      const colors: Record<string, string> = {};
      for (const key of [
        "background",
        "foreground",
        "card",
        "cardForeground",
        "popover",
        "popoverForeground",
        "primary",
        "primaryForeground",
        "secondary",
        "secondaryForeground",
        "muted",
        "mutedForeground",
        "accent",
        "accentForeground",
        "destructive",
        "border",
        "input",
        "ring",
        "sidebar",
        "sidebarForeground",
        "sidebarPrimary",
        "sidebarPrimaryForeground",
        "sidebarAccent",
        "sidebarAccentForeground",
        "sidebarBorder",
        "sidebarRing",
        "radius",
      ]) {
        colors[key] = "#abcabc";
      }
      const theme = expectOk({ ...minimal, variants: { dark: { colors } } });
      expect(Object.keys(theme.variants.dark?.colors ?? {})).toHaveLength(27);
    });
  });

  describe("terminal validation", () => {
    it("rejects terminal that is not an object", () => {
      expect(
        expectError({ ...minimal, variants: { dark: { terminal: "x" } } }),
      ).toBe("variants.dark.terminal must be an object");
    });

    it("rejects non-string scalar terminal fields", () => {
      expect(
        expectError({
          ...minimal,
          variants: { dark: { terminal: { cursor: 1 } } },
        }),
      ).toBe("variants.dark.terminal.cursor must be a string");
    });

    it("accepts all scalar terminal fields", () => {
      const theme = expectOk({
        ...minimal,
        variants: {
          dark: {
            terminal: {
              background: "#000",
              foreground: "#fff",
              cursor: "#0f0",
              cursorAccent: "#00f",
              selection: "rgba(0,0,0,0.2)",
            },
          },
        },
      });
      expect(theme.variants.dark?.terminal).toMatchObject({
        background: "#000",
        selection: "rgba(0,0,0,0.2)",
      });
    });

    it("requires the ansi palette to have exactly 16 entries", () => {
      const msg = "variants.dark.terminal.ansi must be an array of 16 strings";
      expect(
        expectError({
          ...minimal,
          variants: { dark: { terminal: { ansi: [] } } },
        }),
      ).toBe(msg);
      expect(
        expectError({
          ...minimal,
          variants: {
            dark: { terminal: { ansi: new Array(15).fill("#000") } },
          },
        }),
      ).toBe(msg);
      expect(
        expectError({
          ...minimal,
          variants: { dark: { terminal: { ansi: "not-array" } } },
        }),
      ).toBe(msg);
    });

    it("rejects a non-string entry in the ansi palette", () => {
      const ansi: unknown[] = new Array(16).fill("#000");
      ansi[7] = 123;
      expect(
        expectError({
          ...minimal,
          variants: { dark: { terminal: { ansi } } },
        }),
      ).toBe("variants.dark.terminal.ansi[7] must be a string");
    });

    it("accepts a complete 16-color ansi palette", () => {
      const ansi = new Array(16).fill(0).map((_, i) => `#0000${i % 10}0`);
      const theme = expectOk({
        ...minimal,
        variants: { dark: { terminal: { ansi } } },
      });
      expect(theme.variants.dark?.terminal?.ansi).toHaveLength(16);
    });
  });

  describe("optional metadata", () => {
    it("captures author and description when they are strings", () => {
      const theme = expectOk({
        ...minimal,
        author: "Ada",
        description: "A nice theme",
      });
      expect(theme.author).toBe("Ada");
      expect(theme.description).toBe("A nice theme");
    });

    it("ignores non-string author and description", () => {
      const theme = expectOk({ ...minimal, author: 5, description: {} });
      expect(theme.author).toBeUndefined();
      expect(theme.description).toBeUndefined();
    });

    it("captures editorTheme light and dark slugs", () => {
      const theme = expectOk({
        ...minimal,
        editorTheme: { light: "github-light", dark: "dracula" },
      });
      expect(theme.editorTheme).toEqual({
        light: "github-light",
        dark: "dracula",
      });
    });

    it("keeps only the string slugs in editorTheme", () => {
      const theme = expectOk({
        ...minimal,
        editorTheme: { light: "github-light", dark: 9 },
      });
      expect(theme.editorTheme).toEqual({ light: "github-light" });
    });

    it("drops editorTheme entirely when neither slug is a string", () => {
      const theme = expectOk({
        ...minimal,
        editorTheme: { light: 1, dark: 2 },
      });
      expect(theme.editorTheme).toBeUndefined();
    });

    it("ignores a non-object editorTheme", () => {
      const theme = expectOk({ ...minimal, editorTheme: "dracula" });
      expect(theme.editorTheme).toBeUndefined();
    });
  });

  describe("output normalization", () => {
    it("does not leak unknown top-level keys into the result", () => {
      const theme = expectOk({ ...minimal, extraneous: "drop me" });
      expect(theme).not.toHaveProperty("extraneous");
    });
  });
});
