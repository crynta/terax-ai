/** The cell a builtin glyph fills, in whole device pixels. */
export type SpriteSpec = {
  readonly width: number;
  readonly height: number;
  /** Light line weight in device pixels; heavy lines are twice this. */
  readonly thickness: number;
};

/**
 * Underline thickness of the bundled font (JetBrains Mono: 50 of 1000 units)
 * as a fraction of the font size. Ghostty draws box lines at the font's own
 * underline thickness rounded up to whole pixels; the canvas cannot report it,
 * so the bundled font's value stands in for every font.
 */
const LINE_WEIGHT_PER_EM = 0.05;

/**
 * Light line weight for a font drawn at `fontPixels` device pixels per em: at
 least one pixel, rounded up so lines never look thinner than the text.
 */
export function builtinLineThickness(fontPixels: number): number {
  return Math.max(1, Math.ceil(fontPixels * LINE_WEIGHT_PER_EM - 0.001));
}
