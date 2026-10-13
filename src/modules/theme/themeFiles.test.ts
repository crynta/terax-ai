import { describe, expect, it } from "vitest";
import {
  isThemeFilePath,
  parseThemeFile,
  starterTheme,
} from "./themeFiles";

describe("isThemeFilePath", () => {
  it("accepts the terax theme extension in any case", () => {
    expect(isThemeFilePath("/themes/my.terax-theme")).toBe(true);
    expect(isThemeFilePath("/themes/MY.TERAX-THEME")).toBe(true);
    expect(isThemeFilePath("theme.TERAX-Theme")).toBe(true);
  });

  it("refuses other extensions", () => {
    expect(isThemeFilePath("/themes/my.json")).toBe(false);
    expect(isThemeFilePath("/themes/my.terax-themes")).toBe(false);
    expect(isThemeFilePath("mytheme")).toBe(false);
  });
});

describe("parseThemeFile", () => {
  it("maps broken JSON to an error result", () => {
    const r = parseThemeFile("{ not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it("rejects JSON that is not a valid theme", () => {
    expect(parseThemeFile('{"id":true}').ok).toBe(false);
    expect(parseThemeFile("42").ok).toBe(false);
    expect(parseThemeFile("{}").ok).toBe(false);
  });

  it("accepts a serialized starter theme", () => {
    const text = JSON.stringify(starterTheme());
    expect(parseThemeFile(text)).toMatchObject({ ok: true });
  });
});

describe("starterTheme", () => {
  it("uses a namespaced unique id", () => {
    const a = starterTheme();
    const b = starterTheme();
    expect(a.id.startsWith("my-theme-")).toBe(true);
    expect(a.id).not.toBe(b.id);
  });

  it("survives its own round trip through the parser", () => {
    const again = JSON.parse(JSON.stringify(starterTheme()));
    expect(parseThemeFile(JSON.stringify(again))).toMatchObject({ ok: true });
  });
});
