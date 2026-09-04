import { describe, expect, it } from "vitest";
import {
  clampEditorWordWrapColumn,
  EDITOR_WORD_WRAP_COLUMN_DEFAULT,
  EDITOR_WORD_WRAP_COLUMN_MAX,
  EDITOR_WORD_WRAP_COLUMN_MIN,
} from "./store";

describe("clampEditorWordWrapColumn", () => {
  it("rounds and clamps valid values", () => {
    expect(clampEditorWordWrapColumn(79.6)).toBe(80);
    expect(clampEditorWordWrapColumn(EDITOR_WORD_WRAP_COLUMN_MIN - 1)).toBe(
      EDITOR_WORD_WRAP_COLUMN_MIN,
    );
    expect(clampEditorWordWrapColumn(EDITOR_WORD_WRAP_COLUMN_MAX + 1)).toBe(
      EDITOR_WORD_WRAP_COLUMN_MAX,
    );
  });

  it("falls back for non-finite values", () => {
    expect(clampEditorWordWrapColumn(Number.NaN)).toBe(
      EDITOR_WORD_WRAP_COLUMN_DEFAULT,
    );
    expect(clampEditorWordWrapColumn(Number.POSITIVE_INFINITY)).toBe(
      EDITOR_WORD_WRAP_COLUMN_DEFAULT,
    );
  });
});
