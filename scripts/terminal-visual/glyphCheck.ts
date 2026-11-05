/*
 * Pixel checks for the `colors`, `icons` and `cursor` patterns (`glyphPattern.ts`). They read
 * the captured frame only, so they run unchanged on either renderer and any revision.
 */
import type { ColorCase, CursorTarget, IconCase, Rgb } from "./glyphPattern";

export type Capture = {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
};

export type Geometry = { readonly cellWidth: number; readonly cellHeight: number };

export type Report = { readonly ok: boolean; readonly checked: number; readonly failures: string[] };

const INK_THRESHOLD = 40;

function pixel(frame: Capture, x: number, y: number): Rgb {
  const at = (y * frame.width + x) * 4;
  return [frame.rgba[at], frame.rgba[at + 1], frame.rgba[at + 2]];
}

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function cellBox(geometry: Geometry, row: number, col: number, span = 1) {
  return {
    x0: col * geometry.cellWidth,
    y0: row * geometry.cellHeight,
    x1: (col + span) * geometry.cellWidth,
    y1: (row + 1) * geometry.cellHeight,
  };
}

function each(
  frame: Capture,
  box: { x0: number; y0: number; x1: number; y1: number },
  visit: (color: Rgb, x: number, y: number) => void,
) {
  for (let y = Math.max(0, box.y0); y < Math.min(frame.height, box.y1); y += 1) {
    for (let x = Math.max(0, box.x0); x < Math.min(frame.width, box.x1); x += 1) {
      visit(pixel(frame, x, y), x, y);
    }
  }
}

function inkCount(frame: Capture, box: ReturnType<typeof cellBox>, background: Rgb): number {
  let count = 0;
  each(frame, box, (color) => {
    if (distance(color, background) > INK_THRESHOLD) count += 1;
  });
  return count;
}

/**
 * The most saturated ink of a cell must lean toward the expected foreground. Anti-aliased
 * text never reaches the full colour, so the test is direction (cosine) and a share of the
 * distance, not equality. A foreground that collapsed to the default colour fails it.
 */
export function checkColors(
  frame: Capture,
  cases: readonly ColorCase[],
  geometry: Geometry,
  background: Rgb,
  foreground: Rgb,
): Report {
  const failures: string[] = [];
  let checked = 0;
  for (const item of cases) {
    const target: Rgb = [
      item.expected[0] - background[0],
      item.expected[1] - background[1],
      item.expected[2] - background[2],
    ];
    const reach = Math.hypot(...target);
    // A colour too close to the background (ANSI black) has no direction to test.
    if (reach < 60) continue;
    checked += 1;
    let best: Rgb | null = null;
    let bestDistance = 0;
    each(frame, cellBox(geometry, item.row, item.col), (color) => {
      const d = distance(color, background);
      if (d > bestDistance) {
        bestDistance = d;
        best = color;
      }
    });
    if (!best) {
      failures.push(`${item.label}: no ink`);
      continue;
    }
    const found = best as Rgb;
    const vector: Rgb = [
      found[0] - background[0],
      found[1] - background[1],
      found[2] - background[2],
    ];
    const cosine =
      (vector[0] * target[0] + vector[1] * target[1] + vector[2] * target[2]) /
      (Math.hypot(...vector) * reach);
    const asDefault = distance(found, foreground) < 12 && distance(item.expected, foreground) > 60;
    if (cosine < 0.97 || Math.hypot(...vector) < reach * 0.5 || asDefault) {
      failures.push(
        `${item.label}: drew rgb(${found.join(",")}) for rgb(${item.expected.join(",")}), cosine ${cosine.toFixed(3)}`,
      );
    }
  }
  return { ok: failures.length === 0, checked, failures };
}

/**
 * Every icon draws something, a private-use icon stays inside its own cell (no ink in the
 * cells on either side), and a wide glyph stays within its two cells plus a half-cell margin.
 */
export function checkIcons(
  frame: Capture,
  cases: readonly IconCase[],
  geometry: Geometry,
  background: Rgb,
): Report {
  const failures: string[] = [];
  for (const item of cases) {
    const own = cellBox(geometry, item.row, item.col, item.span);
    if (inkCount(frame, own, background) < 4) {
      failures.push(`${item.label}: nothing drawn`);
      continue;
    }
    if (item.privateUse) {
      const left = cellBox(geometry, item.row, item.col - 1);
      const right = cellBox(geometry, item.row, item.col + item.span);
      const leaked = inkCount(frame, left, background) + inkCount(frame, right, background);
      if (leaked > 0) failures.push(`${item.label}: ${leaked} px overflow into the neighbouring cells`);
    } else {
      const margin = Math.round(geometry.cellWidth / 2);
      const beyond = { ...own, x0: own.x1 + margin, x1: own.x1 + 3 * margin };
      if (inkCount(frame, beyond, background) > 0) {
        failures.push(`${item.label}: ink beyond ${item.span} cells`);
      }
    }
  }
  return { ok: failures.length === 0, checked: cases.length, failures };
}

/**
 * A block cursor paints its cells in the cursor colour and the character in the cursor text
 * colour (never the cell's own foreground); bar and underline cursors leave the character
 * alone. `span` is 2 over a wide character.
 */
export function checkCursor(
  frame: Capture,
  geometry: Geometry,
  target: CursorTarget,
  span: number,
  style: "block" | "bar" | "underline",
  colors: { cursor: Rgb; cursorText: Rgb; foreground: Rgb; background: Rgb },
): Report {
  const failures: string[] = [];
  const box = cellBox(geometry, target.row, target.col, span);
  let cursorPixels = 0;
  let textPixels = 0;
  let foregroundPixels = 0;
  each(frame, box, (color) => {
    if (distance(color, colors.cursor) < 12) cursorPixels += 1;
    if (distance(color, colors.cursorText) < 40) textPixels += 1;
    if (distance(color, colors.foreground) < 24) foregroundPixels += 1;
  });
  const area = (box.x1 - box.x0) * (box.y1 - box.y0);
  if (style === "block") {
    if (cursorPixels < area * 0.25) failures.push(`block covers only ${cursorPixels}/${area} px`);
    if (textPixels < 3) failures.push("the character under the block is not drawn in the cursor text colour");
    if (foregroundPixels > 0) failures.push(`${foregroundPixels} px kept the foreground colour under the block`);
    if (span === 2) {
      const tail = cellBox(geometry, target.row, target.col + 1);
      let tailCursor = 0;
      each(frame, tail, (color) => {
        if (distance(color, colors.cursor) < 12) tailCursor += 1;
      });
      if (tailCursor < (tail.x1 - tail.x0) * (tail.y1 - tail.y0) * 0.2) {
        failures.push("the block does not cover the second cell of the wide character");
      }
    }
  } else {
    if (cursorPixels === 0) failures.push(`${style} cursor not drawn`);
    if (textPixels > 0) failures.push(`${textPixels} px recoloured under a ${style} cursor`);
  }
  return { ok: failures.length === 0, checked: 1, failures };
}
