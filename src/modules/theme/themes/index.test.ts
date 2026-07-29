import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID } from "../types";
import { getBuiltinTheme, getDefaultTheme, listBuiltinThemes } from "./index";

describe("builtin theme registry", () => {
  it("exposes a non-empty list of themes", () => {
    expect(listBuiltinThemes().length).toBeGreaterThan(0);
  });

  it("has a unique id per theme", () => {
    const ids = listBuiltinThemes().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves every listed theme by its id", () => {
    for (const theme of listBuiltinThemes()) {
      expect(getBuiltinTheme(theme.id)).toBe(theme);
    }
  });

  it("returns undefined for an unknown id", () => {
    expect(getBuiltinTheme("no-such-theme")).toBeUndefined();
  });

  it("resolves the default theme to a registered theme, not the fallback", () => {
    const ids = listBuiltinThemes().map((t) => t.id);
    expect(ids).toContain(DEFAULT_THEME_ID);
    expect(getDefaultTheme().id).toBe(DEFAULT_THEME_ID);
  });
});
