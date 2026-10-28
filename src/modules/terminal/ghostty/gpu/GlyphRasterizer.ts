import {
  BuiltinGlyphRenderer,
  builtinGlyphSpec,
  isBuiltinGlyph,
} from "./BuiltinGlyphs";
import { hasIntrinsicColor } from "./glyphColor";
import { fontCss, type TerminalFontMetrics } from "./terminalVisuals";

const RASTER_SIZE = 256;
const GLYPH_PADDING = 2;
const CLEAR_MARGIN = 8;

export const GLYPH_STYLE_BOLD = 1;
export const GLYPH_STYLE_ITALIC = 2;

export type RasterizedGlyph = {
  readonly width: number;
  readonly height: number;
  /** Offset of the bitmap's top-left from the cell's top-left, device pixels. */
  readonly bearingX: number;
  readonly bearingY: number;
  readonly intrinsicColor: boolean;
  /**
   * The coverage is final: procedurally drawn cell shapes whose partial values
   * (shades, anti-aliased edges) are intended, so no text contrast adjustment
   * may reshape them.
   */
  readonly exact: boolean;
  /**
   * `width * height` coverage bytes, or `width * height * 4` RGBA bytes for an
   * intrinsic-colour glyph. Borrowed scratch memory: valid until the next call.
   */
  readonly pixels: Uint8Array;
};

/**
 * Rasterizes single glyphs with the 2D canvas at `font.size * scale`. The
 * canvas is allocated lazily, sized once, and released on `dispose` so an idle
 * atlas holds no bitmap. Only the area the previous glyph touched is cleared,
 * and `context.font` is assigned only when the style changes.
 *
 * Box drawing, blocks, braille and powerline separators skip the font: they are
 * drawn at exactly the cell size with no bearing (see `BuiltinGlyphs.ts`), so
 * neighbouring cells join without gaps, and bold or italic never alters them.
 */
export class GlyphRasterizer {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private readonly fonts: string[];
  private activeStyle = -1;
  private dirtyWidth = RASTER_SIZE;
  private dirtyHeight = RASTER_SIZE;
  private readonly coverage = new Uint8Array(RASTER_SIZE * RASTER_SIZE);
  private builtin: BuiltinGlyphRenderer | null = null;

  constructor(private readonly metrics: TerminalFontMetrics) {
    const font = {
      ...metrics.font,
      size: metrics.font.size * metrics.scale,
    };
    this.fonts = [0, 1, 2, 3].map((style) =>
      fontCss(
        font,
        (style & GLYPH_STYLE_BOLD) !== 0,
        (style & GLYPH_STYLE_ITALIC) !== 0,
      ),
    );
  }

  get cpuBytes(): number {
    return (
      (this.canvas ? RASTER_SIZE * RASTER_SIZE * 5 : 0) +
      (this.builtin?.byteSize ?? 0)
    );
  }

  rasterize(text: string, style: number): RasterizedGlyph {
    const builtin = this.rasterizeBuiltin(text);
    if (builtin) return builtin;
    const context = this.ensureContext();
    const fontStyle = style & (GLYPH_STYLE_BOLD | GLYPH_STYLE_ITALIC);
    if (fontStyle !== this.activeStyle) {
      context.font = this.fonts[fontStyle];
      this.activeStyle = fontStyle;
    }
    context.clearRect(0, 0, this.dirtyWidth, this.dirtyHeight);

    const { deviceCellWidth, deviceCellHeight, deviceBaseline } = this.metrics;
    const measurement = context.measureText(text);
    const left = Math.max(0, Math.ceil(measurement.actualBoundingBoxLeft || 0));
    const right = Math.ceil(
      measurement.actualBoundingBoxRight || deviceCellWidth,
    );
    const ascent = Math.ceil(
      measurement.actualBoundingBoxAscent || deviceBaseline,
    );
    const descent = Math.ceil(
      measurement.actualBoundingBoxDescent || deviceCellHeight - deviceBaseline,
    );
    const width = Math.min(
      RASTER_SIZE,
      Math.max(1, left + right + GLYPH_PADDING * 2),
    );
    const height = Math.min(
      RASTER_SIZE,
      Math.max(1, ascent + descent + GLYPH_PADDING * 2),
    );
    context.fillText(text, GLYPH_PADDING + left, GLYPH_PADDING + ascent);
    this.dirtyWidth = Math.min(RASTER_SIZE, width + CLEAR_MARGIN);
    this.dirtyHeight = Math.min(RASTER_SIZE, height + CLEAR_MARGIN);

    const rgba = context.getImageData(0, 0, width, height).data;
    const intrinsicColor = hasIntrinsicColor(rgba);
    let pixels: Uint8Array;
    if (intrinsicColor) {
      pixels = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    } else {
      const count = width * height;
      pixels = this.coverage.subarray(0, count);
      for (let index = 0, source = 3; index < count; index += 1, source += 4) {
        pixels[index] = rgba[source];
      }
    }
    return {
      width,
      height,
      bearingX: -left - GLYPH_PADDING,
      bearingY: deviceBaseline - ascent - GLYPH_PADDING,
      intrinsicColor,
      exact: false,
      pixels,
    };
  }

  /** A procedurally drawn cell-sized glyph, or null when `text` is not one. */
  private rasterizeBuiltin(text: string): RasterizedGlyph | null {
    const codepoint = text.codePointAt(0) ?? 0;
    if (!isBuiltinGlyph(codepoint)) return null;
    if (text.length !== (codepoint > 0xffff ? 2 : 1)) return null;
    this.builtin ??= new BuiltinGlyphRenderer(builtinGlyphSpec(this.metrics));
    const pixels = this.builtin.render(codepoint);
    if (!pixels) return null;
    return {
      width: this.builtin.spec.width,
      height: this.builtin.spec.height,
      bearingX: 0,
      bearingY: 0,
      intrinsicColor: false,
      exact: true,
      pixels,
    };
  }

  dispose(): void {
    if (this.canvas) {
      this.canvas.width = 1;
      this.canvas.height = 1;
    }
    this.canvas = null;
    this.context = null;
    this.builtin = null;
    this.activeStyle = -1;
  }

  private ensureContext(): CanvasRenderingContext2D {
    if (this.context) return this.context;
    const canvas = document.createElement("canvas");
    canvas.width = RASTER_SIZE;
    canvas.height = RASTER_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Glyph rasterization is unavailable");
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillStyle = "white";
    this.canvas = canvas;
    this.context = context;
    this.activeStyle = -1;
    this.dirtyWidth = RASTER_SIZE;
    this.dirtyHeight = RASTER_SIZE;
    return context;
  }
}
