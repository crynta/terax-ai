import { describe, expect, it } from "vitest";
import type { Rgb } from "../core/packedCells";
import {
  blockCursorSpan,
  contrastRatio,
  resolveCursorText,
} from "./cursorText";

const LIGHT_CURSOR: Rgb = [232, 232, 234];
const DARK_BACKGROUND: Rgb = [13, 13, 16];

describe("resolveCursorText", () => {
  it("uses the theme's cursor accent when it reads against the cursor", () => {
    expect(
      resolveCursorText(LIGHT_CURSOR, [20, 30, 40], DARK_BACKGROUND),
    ).toEqual([20, 30, 40]);
  });

  it("falls back to the terminal background when the accent matches the cursor", () => {
    expect(
      resolveCursorText(LIGHT_CURSOR, LIGHT_CURSOR, DARK_BACKGROUND),
    ).toEqual(DARK_BACKGROUND);
    expect(resolveCursorText(LIGHT_CURSOR, null, DARK_BACKGROUND)).toEqual(
      DARK_BACKGROUND,
    );
  });

  it("picks black or white when neither theme colour reads against the cursor", () => {
    const cursor: Rgb = [128, 128, 128];
    const text = resolveCursorText(cursor, [130, 130, 130], [126, 126, 126]);
    expect(contrastRatio(text, cursor)).toBeGreaterThanOrEqual(3);
    expect(
      resolveCursorText([250, 250, 250], [250, 250, 250], [255, 255, 255]),
    ).toEqual([0, 0, 0]);
    expect(resolveCursorText([5, 5, 5], [5, 5, 5], [0, 0, 0])).toEqual([
      255, 255, 255,
    ]);
  });

  it("never returns a colour the cursor hides", () => {
    for (const cursor of [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [0, 255, 0],
      [60, 60, 200],
      [128, 128, 128],
    ] as Rgb[]) {
      const text = resolveCursorText(cursor, cursor, cursor);
      expect(
        contrastRatio(text, cursor),
        String(cursor),
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("blockCursorSpan", () => {
  it("covers one cell on a narrow character", () => {
    expect(blockCursorSpan(4, 1, 80, 1)).toEqual({ start: 4, count: 1 });
  });

  it("covers both cells of a wide character from its lead", () => {
    expect(blockCursorSpan(4, 2, 80, 1)).toEqual({ start: 4, count: 2 });
  });

  it("moves a cursor on the trailing spacer back onto the wide lead before it", () => {
    expect(blockCursorSpan(5, 0, 80, 2)).toEqual({ start: 4, count: 2 });
  });

  it("leaves a cursor on a wrap spacer head alone: no wide lead before it, nothing to back onto", () => {
    // A five-column row holding "abcd" with the wide character wrapped to the next row: the
    // last cell is a spacer head and the cell before it is the narrow "d".
    expect(blockCursorSpan(4, 0, 5, 1)).toEqual({ start: 4, count: 1 });
  });

  it("never reaches past the grid", () => {
    expect(blockCursorSpan(79, 2, 80, 1)).toEqual({ start: 79, count: 1 });
    expect(blockCursorSpan(0, 0, 80, 1)).toEqual({ start: 0, count: 1 });
  });
});
