/**
 * Adapted from xterm.js's TextureAtlas.
 * Copyright (c) 2017-2019 The xterm.js authors. MIT licensed.
 */

import { CellFlags } from "@terax/ghostty-core/protocol";
import { hasIntrinsicColor } from "../gpu/glyphColor";
import { SkylineAtlasAllocator } from "../gpu/SkylineAtlasAllocator";
import { fontCss, type TerminalFontMetrics } from "../gpu/terminalVisuals";

const ATLAS_SIZE = 1_024;
const COLOR_ATLAS_SIZE = 512;
const RASTER_SIZE = 256;
const GLYPH_PADDING = 2;

export type WebGlGlyphEntry = {
  readonly originOffsetX: number;
  readonly originOffsetY: number;
  readonly width: number;
  readonly height: number;
  readonly uvMinX: number;
  readonly uvMinY: number;
  readonly uvMaxX: number;
  readonly uvMaxY: number;
  readonly intrinsicColor: boolean;
};

type DirtyRectangle = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const NULL_GLYPH: WebGlGlyphEntry = {
  originOffsetX: 0,
  originOffsetY: 0,
  width: 0,
  height: 0,
  uvMinX: 0,
  uvMinY: 0,
  uvMaxX: 0,
  uvMaxY: 0,
  intrinsicColor: false,
};

/**
 * A compact coverage atlas with a lazy color-glyph companion. Normal text uses
 * one byte of coverage and receives its color in the fragment shader, keeping
 * one cache entry across all ANSI and true-color variants. Native emoji use a
 * bounded RGBA atlas that is allocated only when an intrinsic-color glyph is
 * encountered.
 */
export class WebGlGlyphAtlas {
  private readonly coverageAllocator = new SkylineAtlasAllocator(
    ATLAS_SIZE,
    ATLAS_SIZE,
  );
  private readonly colorAllocator = new SkylineAtlasAllocator(
    COLOR_ATLAS_SIZE,
    COLOR_ATLAS_SIZE,
  );
  private readonly simpleGlyphs = new Map<number, WebGlGlyphEntry>();
  private readonly complexGlyphs = new Map<string, WebGlGlyphEntry>();
  private readonly coverage = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE);
  private colorPixels: Uint8Array | null = null;
  private readonly rasterCanvas = document.createElement("canvas");
  private readonly rasterContext: CanvasRenderingContext2D;
  private readonly coverageTexture: WebGLTexture;
  private readonly colorTexture: WebGLTexture;
  private coverageDirty: DirtyRectangle | null = null;
  private colorDirty: DirtyRectangle | null = null;
  private uploadCountValue = 0;
  private uploadedBytesValue = 0;
  private generationValue = 1;
  private disposed = false;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly metrics: TerminalFontMetrics,
    private readonly scale: number,
  ) {
    this.rasterCanvas.width = RASTER_SIZE;
    this.rasterCanvas.height = RASTER_SIZE;
    const context = this.rasterCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!context) throw new Error("Glyph rasterization is unavailable");
    this.rasterContext = context;

    const coverageTexture = gl.createTexture();
    const colorTexture = gl.createTexture();
    if (!coverageTexture || !colorTexture) {
      throw new Error("Failed to allocate the WebGL glyph atlas");
    }
    this.coverageTexture = coverageTexture;
    this.colorTexture = colorTexture;
    gl.bindTexture(gl.TEXTURE_2D, coverageTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      ATLAS_SIZE,
      ATLAS_SIZE,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(4),
    );
  }

  get byteSize(): number {
    return (
      ATLAS_SIZE * ATLAS_SIZE +
      (this.colorPixels ? COLOR_ATLAS_SIZE * COLOR_ATLAS_SIZE * 4 : 4)
    );
  }

  get generation(): number {
    return this.generationValue;
  }

  get glyphCount(): number {
    return this.simpleGlyphs.size + this.complexGlyphs.size;
  }

  get uploadCount(): number {
    return this.uploadCountValue;
  }

  get uploadedBytes(): number {
    return this.uploadedBytesValue;
  }

  glyph(
    codepoint: number,
    grapheme: string | null,
    flags: number,
  ): WebGlGlyphEntry {
    this.assertLive();
    if (codepoint === 0 || codepoint === 32) return NULL_GLYPH;
    const style = flags & (CellFlags.BOLD | CellFlags.ITALIC);
    if (grapheme === null) {
      const key = codepoint * 4 + style;
      const cached = this.simpleGlyphs.get(key);
      if (cached) return cached;
      const entry = this.rasterize(String.fromCodePoint(codepoint), flags);
      this.simpleGlyphs.set(key, entry);
      return entry;
    }

    const key = `${style}:${grapheme}`;
    const cached = this.complexGlyphs.get(key);
    if (cached) return cached;
    const entry = this.rasterize(grapheme, flags);
    this.complexGlyphs.set(key, entry);
    return entry;
  }

  bindAndUpload(): void {
    this.assertLive();
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.coverageTexture);
    const coverageDirty = this.coverageDirty;
    if (coverageDirty) {
      const width = coverageDirty.right - coverageDirty.left;
      const height = coverageDirty.bottom - coverageDirty.top;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, ATLAS_SIZE);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, coverageDirty.left);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, coverageDirty.top);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        coverageDirty.left,
        coverageDirty.top,
        width,
        height,
        gl.RED,
        gl.UNSIGNED_BYTE,
        this.coverage,
      );
      this.uploadCountValue += 1;
      this.uploadedBytesValue += width * height;
      this.coverageDirty = null;
    }

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    const colorDirty = this.colorDirty;
    const colorPixels = this.colorPixels;
    if (!colorDirty || !colorPixels) {
      this.resetUnpackState();
      return;
    }
    const width = colorDirty.right - colorDirty.left;
    const height = colorDirty.bottom - colorDirty.top;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, COLOR_ATLAS_SIZE);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, colorDirty.left);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, colorDirty.top);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      colorDirty.left,
      colorDirty.top,
      width,
      height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      colorPixels,
    );
    this.uploadCountValue += 1;
    this.uploadedBytesValue += width * height * 4;
    this.colorDirty = null;
    this.resetUnpackState();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gl.deleteTexture(this.coverageTexture);
    this.gl.deleteTexture(this.colorTexture);
    this.simpleGlyphs.clear();
    this.complexGlyphs.clear();
    this.coverage.fill(0);
    this.colorPixels = null;
    this.coverageDirty = null;
    this.colorDirty = null;
  }

  private rasterize(text: string, flags: number): WebGlGlyphEntry {
    const context = this.rasterContext;
    const bold = (flags & CellFlags.BOLD) !== 0;
    const italic = (flags & CellFlags.ITALIC) !== 0;
    context.clearRect(0, 0, RASTER_SIZE, RASTER_SIZE);
    context.font = fontCss(
      {
        ...this.metrics.font,
        size: this.metrics.font.size * this.scale,
      },
      bold,
      italic,
    );
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillStyle = "white";

    const measurement = context.measureText(text);
    const left = Math.max(0, Math.ceil(measurement.actualBoundingBoxLeft || 0));
    const right = Math.ceil(
      measurement.actualBoundingBoxRight || this.metrics.cellWidth * this.scale,
    );
    const ascent = Math.ceil(
      measurement.actualBoundingBoxAscent || this.metrics.baseline * this.scale,
    );
    const descent = Math.ceil(
      measurement.actualBoundingBoxDescent ||
        (this.metrics.cellHeight - this.metrics.baseline) * this.scale,
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

    const rgba = context.getImageData(0, 0, width, height).data;
    const intrinsicColor = hasIntrinsicColor(rgba);
    if (intrinsicColor) this.ensureColorAtlas();
    const allocator = intrinsicColor
      ? this.colorAllocator
      : this.coverageAllocator;
    let region = allocator.allocate(width, height);
    if (!region) {
      this.reset();
      if (intrinsicColor) this.ensureColorAtlas();
      region = allocator.allocate(width, height);
    }
    if (!region) {
      const size = intrinsicColor ? COLOR_ATLAS_SIZE : ATLAS_SIZE;
      throw new Error(`Glyph exceeds the ${size}px atlas budget`);
    }

    if (intrinsicColor) {
      const colorPixels = this.colorPixels as Uint8Array;
      for (let row = 0; row < height; row += 1) {
        const source = row * width * 4;
        const target = ((region.y + row) * COLOR_ATLAS_SIZE + region.x) * 4;
        colorPixels.set(rgba.subarray(source, source + width * 4), target);
      }
      this.colorDirty = mergeDirty(
        this.colorDirty,
        region.x,
        region.y,
        width,
        height,
      );
    } else {
      for (let row = 0; row < height; row += 1) {
        let source = row * width * 4 + 3;
        let target = (region.y + row) * ATLAS_SIZE + region.x;
        for (let column = 0; column < width; column += 1) {
          this.coverage[target] = rgba[source];
          source += 4;
          target += 1;
        }
      }
      this.coverageDirty = mergeDirty(
        this.coverageDirty,
        region.x,
        region.y,
        width,
        height,
      );
    }

    const atlasSize = intrinsicColor ? COLOR_ATLAS_SIZE : ATLAS_SIZE;

    return {
      originOffsetX: -left - GLYPH_PADDING,
      originOffsetY:
        this.metrics.baseline * this.scale - ascent - GLYPH_PADDING,
      width,
      height,
      uvMinX: region.x / atlasSize,
      uvMinY: region.y / atlasSize,
      uvMaxX: (region.x + width) / atlasSize,
      uvMaxY: (region.y + height) / atlasSize,
      intrinsicColor,
    };
  }

  private ensureColorAtlas(): void {
    if (this.colorPixels) return;
    this.colorPixels = new Uint8Array(COLOR_ATLAS_SIZE * COLOR_ATLAS_SIZE * 4);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.colorTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      COLOR_ATLAS_SIZE,
      COLOR_ATLAS_SIZE,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      null,
    );
  }

  private reset(): void {
    this.coverageAllocator.reset();
    this.colorAllocator.reset();
    this.simpleGlyphs.clear();
    this.complexGlyphs.clear();
    this.coverage.fill(0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.coverageTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.R8,
      ATLAS_SIZE,
      ATLAS_SIZE,
      0,
      this.gl.RED,
      this.gl.UNSIGNED_BYTE,
      null,
    );
    if (this.colorPixels) {
      this.colorPixels.fill(0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.colorTexture);
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        COLOR_ATLAS_SIZE,
        COLOR_ATLAS_SIZE,
        0,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        null,
      );
    }
    this.coverageDirty = null;
    this.colorDirty = null;
    this.generationValue += 1;
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("WebGL glyph atlas is disposed");
  }

  private resetUnpackState(): void {
    this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, 0);
    this.gl.pixelStorei(this.gl.UNPACK_SKIP_PIXELS, 0);
    this.gl.pixelStorei(this.gl.UNPACK_SKIP_ROWS, 0);
  }
}

export { hasIntrinsicColor } from "../gpu/glyphColor";

function mergeDirty(
  current: DirtyRectangle | null,
  x: number,
  y: number,
  width: number,
  height: number,
): DirtyRectangle {
  if (!current) {
    return { left: x, top: y, right: x + width, bottom: y + height };
  }
  current.left = Math.min(current.left, x);
  current.top = Math.min(current.top, y);
  current.right = Math.max(current.right, x + width);
  current.bottom = Math.max(current.bottom, y + height);
  return current;
}
