import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID } from "../types";
import { validateTheme } from "../validateTheme";
import { getBuiltinTheme, getDefaultTheme, listBuiltinThemes } from "./index";

describe("builtin theme registry", () => {
  it("lists more than one builtin theme", () => {
    expect(listBuiltinThemes().length).toBeGreaterThan(1);
  });

  it("includes the default theme id in the listing", () => {
    const ids = listBuiltinThemes().map((t) => t.id);
    expect(ids).toContain(DEFAULT_THEME_ID);
  });

  it("has no duplicate ids", () => {
    const ids = listBuiltinThemes().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("looks up a known theme by id", () => {
    const theme = getBuiltinTheme(DEFAULT_THEME_ID);
    expect(theme?.id).toBe(DEFAULT_THEME_ID);
  });

  it("returns undefined for an unknown id", () => {
    expect(getBuiltinTheme("does-not-exist")).toBeUndefined();
    expect(getBuiltinTheme("")).toBeUndefined();
  });

  it("resolves the default theme to the terax-default entry", () => {
    expect(getDefaultTheme().id).toBe(DEFAULT_THEME_ID);
  });

  it("returns the same instance from list, lookup, and default helpers", () => {
    const fromDefault = getDefaultTheme();
    const fromLookup = getBuiltinTheme(DEFAULT_THEME_ID);
    const fromList = listBuiltinThemes().find((t) => t.id === DEFAULT_THEME_ID);
    expect(fromDefault).toBe(fromLookup);
    expect(fromDefault).toBe(fromList);
  });

  it("ships only themes that pass validateTheme", () => {
    for (const theme of listBuiltinThemes()) {
      const res = validateTheme(theme);
      expect(res.ok, `theme "${theme.id}" failed validation`).toBe(true);
    }
  });

  it("gives every builtin theme a non-empty name and id", () => {
    for (const theme of listBuiltinThemes()) {
      expect(theme.id.length).toBeGreaterThan(0);
      expect(theme.name.trim().length).toBeGreaterThan(0);
    }
  });
});
