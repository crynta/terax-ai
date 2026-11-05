/*
 * Pixel checks for the `colors`, `icons` and `cursor` patterns (`glyphPattern.ts`). They read
 * the captured frame only, so they run unchanged on either renderer and any revision.
 */
import type { ColorCase, CursorTarget, EqualCase, IconCase, Rgb } from "./glyphPattern";

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
 * Every glyph draws. An icon never reaches into the cell on its left and stays within two
 * cells (the blank one after it is its overflow). A stretched Powerline glyph fills its
 * cell box exactly: its ink touches all four edges and nothing falls outside, so
 * neighbouring cells join without a seam and no shape floats small. A wide glyph stays
 * within its two cells plus a half-cell margin.
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
    if (item.kind === "stretch") {
      const around = {
        x0: own.x0 - geometry.cellWidth,
        x1: own.x1 + geometry.cellWidth,
        y0: own.y0,
        y1: own.y1,
      };
      let minX = Number.POSITIVE_INFINITY;
      let maxX = -1;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = -1;
      let outside = 0;
      each(frame, around, (color, x, y) => {
        if (distance(color, background) <= INK_THRESHOLD) return;
        if (x < own.x0 || x >= own.x1) outside += 1;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      });
      if (outside > 0) failures.push(`${item.label}: ${outside} px outside its ${item.span} cells`);
      if (minX > own.x0 + 1 || maxX < own.x1 - 2) {
        failures.push(`${item.label}: ink spans x ${minX}..${maxX}, not the cell box ${own.x0}..${own.x1 - 1}`);
      }
      if (minY > own.y0 + 1 || maxY < own.y1 - 2) {
        failures.push(`${item.label}: ink spans y ${minY}..${maxY}, not the cell box ${own.y0}..${own.y1 - 1}`);
      }
    } else if (item.kind === "icon") {
      // A pixel or two of left bearing is the font's own.
      const left = { ...cellBox(geometry, item.row, item.col - 1), x1: own.x0 - 2 };
      const beyond = {
        ...own,
        x0: own.x0 + 2 * geometry.cellWidth,
        x1: own.x0 + 4 * geometry.cellWidth - 2,
      };
      const leaked = inkCount(frame, left, background) + inkCount(frame, beyond, background);
      if (leaked > 0) failures.push(`${item.label}: ${leaked} px left of its cell or beyond two cells`);
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

/** Each pair of cells must hold identical pixels (a glyph form, or a letter nothing painted over). */
export function checkEqualCells(
  frame: Capture,
  pairs: readonly EqualCase[],
  geometry: Geometry,
): Report {
  const failures: string[] = [];
  for (const pair of pairs) {
    const a = cellBox(geometry, pair.a.row, pair.a.col);
    const b = cellBox(geometry, pair.b.row, pair.b.col);
    let differing = 0;
    let ink = 0;
    for (let y = 0; y < geometry.cellHeight; y += 1) {
      for (let x = 0; x < geometry.cellWidth; x += 1) {
        const left = pixel(frame, a.x0 + x, a.y0 + y);
        const right = pixel(frame, b.x0 + x, b.y0 + y);
        if (distance(left, right) > 1) differing += 1;
        if (distance(right, [0x16, 0x18, 0x1b]) > INK_THRESHOLD) ink += 1;
      }
    }
    if (ink < 4) failures.push(`${pair.label}: the reference cell is blank`);
    else if (differing > 0) failures.push(`${pair.label}: ${differing} px differ from the reference`);
  }
  return { ok: failures.length === 0, checked: pairs.length, failures };
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
  overhang = false,
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
    // A solid glyph (a flame) leaves little of the block's own colour showing, so it counts too.
    const covered = overhang ? cursorPixels + textPixels : cursorPixels;
    if (covered < area * 0.25) failures.push(`block covers only ${covered}/${area} px`);
    if (textPixels < 3) failures.push("the character under the block is not drawn in the cursor text colour");
    if (foregroundPixels > 0) failures.push(`${foregroundPixels} px kept the foreground colour under the block`);
    if (overhang) {
      // A glyph reaching past the block keeps its own colour there: no recolour, no cursor.
      const next = cellBox(geometry, target.row, target.col + 1);
      let kept = 0;
      let recoloured = 0;
      let painted = 0;
      each(frame, next, (color) => {
        if (distance(color, colors.foreground) < 24) kept += 1;
        if (distance(color, colors.cursorText) < 40) recoloured += 1;
        if (distance(color, colors.cursor) < 12) painted += 1;
      });
      if (kept < 3) failures.push("the part of the glyph past the block lost its colour");
      if (recoloured > 0) failures.push(`${recoloured} px past the block took the cursor text colour`);
      if (painted > 0) failures.push(`${painted} px past the block are cursor coloured`);
    }
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
