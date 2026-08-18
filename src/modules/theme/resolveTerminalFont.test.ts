import { describe, expect, it } from "vitest";
import { resolveTerminalFont, type TerminalFont } from "./resolveTerminalFont";
import type { Theme } from "./types";

const preferences: TerminalFont = {
  fontFamily: "JetBrains Mono",
  fontWeight: "normal",
  fontSize: 14,
};

describe("resolveTerminalFont", () => {
  it("uses theme values ahead of global preferences field by field", () => {
    const theme: Theme = {
      id: "custom-theme",
      name: "Custom",
      variants: {
        dark: {
          terminal: {
            fontFamily: "Iosevka",
            fontSize: 16,
          },
        },
      },
    };

    expect(resolveTerminalFont(preferences, theme, "dark")).toEqual({
      fontFamily: "Iosevka",
      fontWeight: "normal",
      fontSize: 16,
    });
  });

  it("restores global preferences when the theme has no font values", () => {
    const theme: Theme = {
      id: "colors-only",
      name: "Colors only",
      variants: { dark: { terminal: { foreground: "#ffffff" } } },
    };

    expect(resolveTerminalFont(preferences, theme, "dark")).toEqual(
      preferences,
    );
  });

  it("uses the same variant fallback order as theme colors", () => {
    const theme: Theme = {
      id: "dark-only",
      name: "Dark only",
      variants: {
        dark: { terminal: { fontWeight: "bold" } },
      },
    };

    expect(resolveTerminalFont(preferences, theme, "light").fontWeight).toBe(
      "bold",
    );
  });
});
