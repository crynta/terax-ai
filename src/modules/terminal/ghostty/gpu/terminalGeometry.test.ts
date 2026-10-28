import { describe, expect, it } from "vitest";
import {
  normalizeSelectionBounds,
  selectionBoundsContain,
} from "../selection/TerminalSelectionController";
import {
  cursorRect,
  cursorThickness,
  decorationMetrics,
  leftOverhangPadding,
  NO_SELECTION,
  selectionUniform,
  selectionUniformContains,
  selectionUniformEqual,
} from "./terminalGeometry";
import { deriveFontMetrics } from "./terminalVisuals";

const FONT = {
  family: "monospace",
  size: 14,
  lineHeight: 1.2,
  letterSpacing: 0,
  weight: "400",
} as const;

function metrics(scale: number) {
  return deriveFontMetrics(FONT, scale, {
    advance: 8.4 * scale,
    ascent: 11 * scale,
    descent: 3 * scale,
  });
}

function bounds(
  anchor: [number, number],
  focus: [number, number],
  rectangular = false,
) {
  return normalizeSelectionBounds({
    anchor: { line: anchor[0], column: anchor[1] },
    focus: { line: focus[0], column: focus[1] },
    rectangular,
  });
}

describe("selectionUniform", () => {
  it("is inactive without a selection or when it lies outside the viewport", () => {
    expect(selectionUniform(null, 100, 24)).toBe(NO_SELECTION);
    expect(selectionUniform(bounds([10, 0], [12, 5]), 100, 24)).toBe(
      NO_SELECTION,
    );
    expect(selectionUniform(bounds([130, 0], [140, 5]), 100, 24)).toBe(
      NO_SELECTION,
    );
  });

  it("is viewport relative and changes when the viewport origin shifts", () => {
    const selection = bounds([105, 3], [108, 9]);
    const first = selectionUniform(selection, 100, 24);
    const scrolled = selectionUniform(selection, 102, 24);
    expect(first).toMatchObject({
      active: true,
      startLine: 5,
      endLine: 8,
      startColumn: 3,
      endColumn: 9,
    });
    expect(scrolled).toMatchObject({ startLine: 3, endLine: 6 });
    expect(selectionUniformEqual(first, scrolled)).toBe(false);
    expect(
      selectionUniformEqual(first, selectionUniform(selection, 100, 24)),
    ).toBe(true);
  });

  it("keeps a selection that starts above or ends below the viewport", () => {
    const selection = bounds([90, 4], [200, 2]);
    const uniform = selectionUniform(selection, 100, 24);
    expect(uniform.active).toBe(true);
    expect(uniform.startLine).toBe(-10);
    expect(selectionUniformContains(uniform, 0, 0)).toBe(true);
    expect(selectionUniformContains(uniform, 23, 79)).toBe(true);
  });

  it("matches the legacy selectionBoundsContain rules for every cell", () => {
    let seed = 7;
    const random = (limit: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % limit;
    };
    for (let trial = 0; trial < 300; trial += 1) {
      const origin = random(40);
      const selection = bounds(
        [origin + random(30) - 3, random(20)],
        [origin + random(30) - 3, random(20)],
        random(4) === 0,
      );
      const uniform = selectionUniform(selection, origin, 24);
      for (let row = 0; row < 24; row += 1) {
        for (let column = 0; column < 20; column += 1) {
          expect(selectionUniformContains(uniform, row, column)).toBe(
            selectionBoundsContain(selection, origin + row, column),
          );
        }
      }
    }
  });

  it("selects a wide character only through its lead column, as the previous renderer did", () => {
    // Columns 2 and 3 hold one wide glyph. The shader maps the trailing half
    // to its lead, so a selection beginning on the trailing half selects nothing
    // of it while one ending on the lead selects both halves.
    const startsOnTail = selectionUniform(bounds([0, 3], [0, 9]), 0, 4);
    expect(selectionUniformContains(startsOnTail, 0, 2)).toBe(false);
    const endsOnLead = selectionUniform(bounds([0, 0], [0, 2]), 0, 4);
    expect(selectionUniformContains(endsOnLead, 0, 2)).toBe(true);
    expect(selectionUniformContains(endsOnLead, 0, 3)).toBe(false);
  });
});

describe("cursor and decoration geometry", () => {
  it.each([1, 1.25, 1.5, 2, 3])(
    "draws integer cursor shapes at %s",
    (scale) => {
      const m = metrics(scale);
      const block = cursorRect({ x: 3, y: 2 }, "block", m);
      expect(block).toEqual({
        x: 3 * m.deviceCellWidth,
        y: 2 * m.deviceCellHeight,
        width: m.deviceCellWidth,
        height: m.deviceCellHeight,
      });
      const bar = cursorRect({ x: 3, y: 2 }, "bar", m);
      expect(bar.width).toBe(cursorThickness(scale));
      expect(bar.height).toBe(m.deviceCellHeight);
      const underline = cursorRect({ x: 3, y: 2 }, "underline", m);
      expect(underline.y + underline.height).toBe(3 * m.deviceCellHeight);
      expect(underline.width).toBe(m.deviceCellWidth);
      for (const rect of [block, bar, underline]) {
        for (const value of Object.values(rect)) {
          expect(Number.isInteger(value)).toBe(true);
        }
      }
    },
  );

  it("uses integer stroke widths of at least one device pixel", () => {
    expect(cursorThickness(1)).toBe(2);
    expect(cursorThickness(2)).toBe(2);
    expect(cursorThickness(3)).toBe(3);
    expect(decorationMetrics(metrics(1)).thickness).toBe(1);
    expect(decorationMetrics(metrics(1.25)).thickness).toBe(1);
    expect(decorationMetrics(metrics(1.5)).thickness).toBe(2);
    expect(decorationMetrics(metrics(2)).thickness).toBe(2);
    const m = metrics(2);
    expect(decorationMetrics(m).baseline).toBe(m.deviceBaseline);
    expect(decorationMetrics(m).strikeY).toBe(
      Math.floor(m.deviceCellHeight * 0.52),
    );
  });

  it("scales the left overhang tolerance with letter spacing", () => {
    expect(leftOverhangPadding(0, 2)).toBe(0);
    expect(leftOverhangPadding(1, 2)).toBe(1);
    expect(leftOverhangPadding(3, 1.5)).toBe(2);
  });
});
