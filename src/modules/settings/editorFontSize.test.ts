import { describe, expect, it } from "vitest";
import {
  clampEditorFontSize,
  EDITOR_FONT_SIZE_DEFAULT,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
} from "./store";

describe("clampEditorFontSize", () => {
  it("rounds and clamps valid values", () => {
    expect(clampEditorFontSize(14.6)).toBe(15);
    expect(clampEditorFontSize(EDITOR_FONT_SIZE_MIN - 1)).toBe(
      EDITOR_FONT_SIZE_MIN,
    );
    expect(clampEditorFontSize(EDITOR_FONT_SIZE_MAX + 1)).toBe(
      EDITOR_FONT_SIZE_MAX,
    );
  });

  it("falls back for non-finite values", () => {
    expect(clampEditorFontSize(Number.NaN)).toBe(EDITOR_FONT_SIZE_DEFAULT);
    expect(clampEditorFontSize(Number.POSITIVE_INFINITY)).toBe(
      EDITOR_FONT_SIZE_DEFAULT,
    );
  });
});
