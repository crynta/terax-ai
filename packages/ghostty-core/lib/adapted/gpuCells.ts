/**
 * GPU cell record layout produced by `updateGpuRenderState()`.
 *
 * One record per cell, row-major, four little-endian u32 words (16 bytes):
 *
 * ```
 * word0  bits  0..23  glyph id (0 = draw no glyph)
 *        bits 24..26  underline style: 0 none, 1 single, 2 double, 3 curly,
 *                     4 dotted, 5 dashed
 *        bit  27      strikethrough
 *        bit  28      overline
 *        bit  29      blink (the glyph blinks; decorations do not)
 *        bit  30      wide lead (the glyph spans this cell and the next)
 *        bit  31      reserved, always 0
 * word1  foreground RGBA8: inverse applied, alpha 255 (128 when faint)
 * word2  background RGBA8: inverse applied, alpha 255
 * word3  underline  RGBA8: alpha 255 (falls back to the displayed foreground)
 * ```
 *
 * Each RGBA word holds the bytes `[r, g, b, a]` in memory order, which is the
 * layout WGSL `unpack4x8unorm(word)` expects (`.x == r`, `.w == a`). A glyph id
 * of 0 means nothing is drawn for the cell: blank, invisible text, the spacer
 * tail of a wide character, or a Kitty placeholder. Spacer tails copy the
 * lead's colors and decoration bits (underline, strikethrough, overline) so a
 * two-cell glyph's background and decorations cover both cells; a spacer head
 * at the end of a wrapped row draws nothing with the default colors.
 */
export const GPU_CELL_BYTES = 16;
export const GPU_CELL_WORDS = 4;
export const GPU_GLYPH_ID_MASK = 0x00ff_ffff;
export const GPU_ATTR_SHIFT = 24;
export const GPU_ATTR_UNDERLINE_MASK = 0x7;
export const GPU_ATTR_STRIKETHROUGH = 1 << 3;
export const GPU_ATTR_OVERLINE = 1 << 4;
export const GPU_ATTR_BLINK = 1 << 5;
export const GPU_ATTR_WIDE_LEAD = 1 << 6;

/** Glyph style bits (`TeraxGhosttyGpuGlyph.style`). */
export const GPU_GLYPH_BOLD = 1 << 0;
export const GPU_GLYPH_ITALIC = 1 << 1;

/** Decoded view of one record, for tests and diagnostics (not a hot path). */
export type TeraxGhosttyGpuCell = {
  readonly glyphId: number;
  readonly underlineStyle: number;
  readonly strikethrough: boolean;
  readonly overline: boolean;
  readonly blink: boolean;
  readonly wideLead: boolean;
  /** `[r, g, b, a]` */
  readonly foreground: readonly [number, number, number, number];
  readonly background: readonly [number, number, number, number];
  readonly underline: readonly [number, number, number, number];
};

export function decodeGpuCell(
  words: Uint32Array,
  cellIndex: number,
): TeraxGhosttyGpuCell {
  const base = cellIndex * GPU_CELL_WORDS;
  const word0 = words[base];
  const attrs = word0 >>> GPU_ATTR_SHIFT;
  return {
    glyphId: word0 & GPU_GLYPH_ID_MASK,
    underlineStyle: attrs & GPU_ATTR_UNDERLINE_MASK,
    strikethrough: (attrs & GPU_ATTR_STRIKETHROUGH) !== 0,
    overline: (attrs & GPU_ATTR_OVERLINE) !== 0,
    blink: (attrs & GPU_ATTR_BLINK) !== 0,
    wideLead: (attrs & GPU_ATTR_WIDE_LEAD) !== 0,
    foreground: unpackRgba(words[base + 1]),
    background: unpackRgba(words[base + 2]),
    underline: unpackRgba(words[base + 3]),
  };
}

function unpackRgba(word: number): [number, number, number, number] {
  return [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, word >>> 24];
}
