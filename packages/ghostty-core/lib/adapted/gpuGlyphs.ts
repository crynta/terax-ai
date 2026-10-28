import type {
  TeraxGhosttyGpuGlyph,
  TeraxGhosttyGpuGlyphBatch,
} from "./types";

const MAX_GLYPH_CODEPOINTS = 1_024;

/**
 * Iterates `[id][style][codepoint_count][codepoints...]` records. Records are
 * validated as they are decoded so a corrupted stream throws instead of
 * reading past the batch.
 */
export class GpuGlyphBatch implements TeraxGhosttyGpuGlyphBatch {
  constructor(readonly words: Uint32Array) {}

  get isEmpty(): boolean {
    return this.words.length === 0;
  }

  *[Symbol.iterator](): Iterator<TeraxGhosttyGpuGlyph> {
    const words = this.words;
    let offset = 0;
    while (offset < words.length) {
      if (words.length - offset < 3) {
        throw new RangeError("Truncated Ghostty glyph record header");
      }
      const id = words[offset];
      const style = words[offset + 1];
      const count = words[offset + 2];
      const end = offset + 3 + count;
      if (count === 0 || count > MAX_GLYPH_CODEPOINTS || end > words.length) {
        throw new RangeError("Invalid Ghostty glyph record");
      }
      yield {
        id,
        style,
        text:
          count === 1
            ? String.fromCodePoint(words[offset + 3])
            : String.fromCodePoint(...words.subarray(offset + 3, end)),
      };
      offset = end;
    }
  }

  toArray(): TeraxGhosttyGpuGlyph[] {
    return Array.from(this);
  }
}
