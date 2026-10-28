/*
 * Pixel checks for the `pattern=sprites` capture (see `spritePattern.ts`).
 *
 * `checkSeams` needs only the captured image: it compares the pixel lines on
 * either side of every cell boundary that two line characters share, so it works
 * on any renderer, including a revision that draws these characters from the
 * font.
 *
 * `checkExpected` rebuilds the frame from the procedural glyph generator, cell
 * by cell, and counts the pixels that differ from the capture.
 */
import {
  DEFAULT_BACKGROUND,
  DEFAULT_FOREGROUND,
  type Rgb,
  type SpriteRow,
} from "./spritePattern";

export type Capture = {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
};

export type Geometry = {
  readonly cellWidth: number;
  readonly cellHeight: number;
};

type Cell = { readonly char: string; readonly fg: Rgb; readonly bg: Rgb };

function grid(rows: readonly SpriteRow[]): Cell[][] {
  return rows.map((row) => {
    const cells: Cell[] = [];
    for (const item of row) {
      for (const char of item.text) {
        cells.push({
          char,
          fg: item.fg ?? DEFAULT_FOREGROUND,
          bg: item.bg ?? DEFAULT_BACKGROUND,
        });
      }
    }
    return cells;
  });
}

const RIGHT_ARM = new Set(
  [..."─━═┌┍┎┏├┝┞┟┠┡┢┣┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╒╓╔╘╙╚╞╟╠╤╥╦╧╨╩╪╫╬╶╺╼╾"],
);
const LEFT_ARM = new Set(
  [..."─━═┐┑┒┓┘┙┚┛┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╕╖╗╛╜╝╡╢╣╤╥╦╧╨╩╪╫╬╴╸╼╾"],
);
const DOWN_ARM = new Set(
  [..."│┃║┌┍┎┏┐┑┒┓├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╒╓╔╕╖╗╞╟╠╡╢╣╤╥╦╪╫╬╷╻╽╿"],
);
const UP_ARM = new Set(
  [..."│┃║└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┴┵┶┷┸┹┺┻┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╘╙╚╛╜╝╞╟╠╡╢╣╧╨╩╪╫╬╵╹╽╿"],
);

export type SeamReport = {
  /** Cell boundaries where both cells have an arm toward each other. */
  readonly boundaries: number;
  /** Boundaries where the two edge pixel lines are not the same, or are blank. */
  readonly brokenBoundaries: number;
  /** Edge pixels that are inked on one side of a boundary and not the other. */
  readonly seamPixels: number;
  readonly worst: readonly string[];
};

function inkAt(capture: Capture, x: number, y: number, cell: Cell): boolean {
  const offset = (y * capture.width + x) * 4;
  let along = 0;
  let span = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    const axis = cell.fg[channel] - cell.bg[channel];
    along += (capture.rgba[offset + channel] - cell.bg[channel]) * axis;
    span += axis * axis;
  }
  return span === 0 ? false : along / span >= 0.5;
}

/**
 * Looks at every boundary between two cells whose line characters point at each
 * other, ink-wise: the last pixel column of the left cell and the first of the
 * right cell (or the last and first pixel rows, vertically) must be inked on
 * exactly the same pixels, and not be blank. A renderer that leaves a gap at a
 * cell boundary, or draws the two halves a pixel apart, reports it here.
 */
export function checkSeams(
  capture: Capture,
  rows: readonly SpriteRow[],
  geometry: Geometry,
): SeamReport {
  const { cellWidth, cellHeight } = geometry;
  const cells = grid(rows);
  let boundaries = 0;
  let brokenBoundaries = 0;
  let seamPixels = 0;
  const worst: string[] = [];
  const compare = (
    label: string,
    length: number,
    first: (index: number) => boolean,
    second: (index: number) => boolean,
  ) => {
    boundaries += 1;
    let inked = 0;
    let differing = 0;
    for (let index = 0; index < length; index += 1) {
      const a = first(index);
      const b = second(index);
      if (a) inked += 1;
      if (a !== b) differing += 1;
    }
    if (inked === 0 || differing > 0) {
      brokenBoundaries += 1;
      seamPixels += differing + (inked === 0 ? 1 : 0);
      if (worst.length < 12) {
        worst.push(`${label}: ${inked} inked, ${differing} differ`);
      }
    }
  };

  for (let row = 0; row < cells.length; row += 1) {
    for (let column = 0; column + 1 < cells[row].length; column += 1) {
      const left = cells[row][column];
      const right = cells[row][column + 1];
      if (!RIGHT_ARM.has(left.char) || !LEFT_ARM.has(right.char)) continue;
      const x = (column + 1) * cellWidth;
      compare(
        `h row ${row} between cols ${column} and ${column + 1}`,
        cellHeight,
        (index) => inkAt(capture, x - 1, row * cellHeight + index, left),
        (index) => inkAt(capture, x, row * cellHeight + index, right),
      );
    }
  }
  for (let row = 0; row + 1 < cells.length; row += 1) {
    for (let column = 0; column < cells[row].length; column += 1) {
      const upper = cells[row][column];
      const lower = cells[row + 1][column];
      if (!lower || !DOWN_ARM.has(upper.char) || !UP_ARM.has(lower.char)) {
        continue;
      }
      const y = (row + 1) * cellHeight;
      compare(
        `v col ${column} between rows ${row} and ${row + 1}`,
        cellWidth,
        (index) => inkAt(capture, column * cellWidth + index, y - 1, upper),
        (index) => inkAt(capture, column * cellWidth + index, y, lower),
      );
    }
  }
  return { boundaries, brokenBoundaries, seamPixels, worst };
}

export type ExpectedReport = {
  readonly cells: number;
  readonly pixels: number;
  readonly mismatched: number;
  readonly maxDelta: number;
  readonly first: readonly string[];
};

/**
 * Compares every cell that holds a procedural glyph or a space with the frame
 * the generator predicts: `background + (foreground - background) * coverage`.
 * Cells holding text are skipped. `tolerance` absorbs 8-bit blending.
 */
export function checkExpected(
  capture: Capture,
  rows: readonly SpriteRow[],
  geometry: Geometry,
  render: (codepoint: number) => Uint8Array | null,
  tolerance = 2,
): ExpectedReport {
  const { cellWidth, cellHeight } = geometry;
  const cells = grid(rows);
  let compared = 0;
  let pixels = 0;
  let mismatched = 0;
  let maxDelta = 0;
  const first: string[] = [];
  for (let row = 0; row < cells.length; row += 1) {
    for (let column = 0; column < cells[row].length; column += 1) {
      const cell = cells[row][column];
      const codepoint = cell.char.codePointAt(0) ?? 32;
      const mask = codepoint === 32 ? null : render(codepoint);
      if (codepoint !== 32 && !mask) continue;
      compared += 1;
      for (let y = 0; y < cellHeight; y += 1) {
        for (let x = 0; x < cellWidth; x += 1) {
          const coverage = mask ? mask[y * cellWidth + x] / 255 : 0;
          const offset =
            ((row * cellHeight + y) * capture.width + column * cellWidth + x) * 4;
          pixels += 1;
          let delta = 0;
          for (let channel = 0; channel < 3; channel += 1) {
            const expected =
              cell.bg[channel] + (cell.fg[channel] - cell.bg[channel]) * coverage;
            delta = Math.max(delta, Math.abs(capture.rgba[offset + channel] - expected));
          }
          maxDelta = Math.max(maxDelta, delta);
          if (delta > tolerance) {
            mismatched += 1;
            if (first.length < 12) {
              first.push(
                `U+${codepoint.toString(16)} cell ${column},${row} px ${x},${y} off by ${delta.toFixed(1)}`,
              );
            }
          }
        }
      }
    }
  }
  return { cells: compared, pixels, mismatched, maxDelta, first };
}
