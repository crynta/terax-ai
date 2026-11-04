import type { Rgb } from "../core/packedCells";

/** Smallest contrast ratio at which text on the cursor block stays readable. */
const MIN_CURSOR_TEXT_CONTRAST = 3;

/**
 * The colour of the character under a block cursor (Ghostty's `cursor-text`):
 * the theme's cursor accent, else the terminal background, else black or white,
 * whichever reads against the cursor. A theme whose accent equals the cursor
 * colour must never make the character vanish.
 */
export function resolveCursorText(
  cursor: Rgb,
  accent: Rgb | null,
  background: Rgb,
): Rgb {
  if (accent && contrastRatio(accent, cursor) >= MIN_CURSOR_TEXT_CONTRAST) {
    return accent;
  }
  if (contrastRatio(background, cursor) >= MIN_CURSOR_TEXT_CONTRAST) {
    return background;
  }
  const black: Rgb = [0, 0, 0];
  const white: Rgb = [255, 255, 255];
  return contrastRatio(black, cursor) >= contrastRatio(white, cursor)
    ? black
    : white;
}

export function contrastRatio(first: Rgb, second: Rgb): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function relativeLuminance(color: Rgb): number {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * The cells a block cursor covers. A cursor on a wide character covers both
 * cells, whether it sits on the lead or (after explicit movement) on the
 * trailing spacer. `width` is the renderer's per-cell width: 0 for a spacer
 * tail, 2 for a wide lead, 1 otherwise.
 */
export function blockCursorSpan(
  column: number,
  width: number,
  columns: number,
): { readonly start: number; readonly count: 1 | 2 } {
  if (width === 0 && column > 0) return { start: column - 1, count: 2 };
  if (width === 2 && column + 1 < columns) return { start: column, count: 2 };
  return { start: column, count: 1 };
}
