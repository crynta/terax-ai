import { describe, expect, it } from "vitest";
import { clampAutoSaveDelay, isEditorThemeId } from "./store";

describe("clampAutoSaveDelay", () => {
  it("clamps to the 100ms..60s bounds", () => {
    expect(clampAutoSaveDelay(50)).toBe(100);
    expect(clampAutoSaveDelay(100)).toBe(100);
    expect(clampAutoSaveDelay(1500)).toBe(1500);
    expect(clampAutoSaveDelay(60000)).toBe(60000);
    expect(clampAutoSaveDelay(120000)).toBe(60000);
  });

  it("rounds fractional values and maps non-finite input to the default", () => {
    expect(clampAutoSaveDelay(250.6)).toBe(251);
    expect(clampAutoSaveDelay(Number.NaN)).toBe(1000);
    expect(clampAutoSaveDelay(Number.POSITIVE_INFINITY)).toBe(1000);
  });
});

describe("isEditorThemeId", () => {
  it("accepts known editor theme ids and rejects everything else", () => {
    expect(isEditorThemeId("kanagawa")).toBe(true);
    expect(isEditorThemeId("kanagawa-lotus")).toBe(true);
    expect(isEditorThemeId("made-up-theme")).toBe(false);
    expect(isEditorThemeId("")).toBe(false);
    expect(isEditorThemeId(null)).toBe(false);
    expect(isEditorThemeId(42)).toBe(false);
  });

  it("rejects the auto sentinel, which is not a concrete theme id", () => {
    expect(isEditorThemeId("auto")).toBe(false);
  });
});
