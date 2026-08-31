/**
 * Adapted from xterm.js's GlyphRenderer, RectangleRenderer, and WebglRenderer.
 * Copyright (c) 2018 The xterm.js authors. MIT licensed.
 */

import type { TerminalDamage } from "@/modules/terminal/backend/contracts";
import { CellFlags } from "@terax/ghostty-core/protocol";
import type { Rgb, TerminalCellReader } from "../core/packedCells";
import type { GhosttyTerminalModelApi } from "../GhosttyTerminalModel";
import { CanvasBackingStore } from "../gpu/CanvasBackingStore";
import type {
  TerminalFontMetrics,
  TerminalGpuTheme,
} from "../gpu/terminalVisuals";
import { WebGlGlyphAtlas, type WebGlGlyphEntry } from "./WebGlGlyphAtlas";

const GLYPH_FLOATS = 15;
const GLYPH_POSITION_OFFSET = 13;
const RECTANGLE_FLOATS = 9;
const INITIAL_RECTANGLE_CAPACITY = 64;
const MAX_SURFACE_CELLS = 262_144;
const CELL_CAPACITY_ALIGNMENT = 256;
const MIN_CELL_CAPACITY = 1_024;
const CONTEXT_RESTORE_TIMEOUT_MS = 3_000;
const SEARCH_MATCH_BACKGROUND = 0x515c6a;
const SEARCH_ACTIVE_MATCH_BACKGROUND = 0xd18616;

const PROJECTION_MATRIX = new Float32Array([
  2, 0, 0, 0, 0, -2, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1,
]);

export type WebGlRendererProfile = {
  readonly metrics: TerminalFontMetrics;
  readonly theme: TerminalGpuTheme;
  readonly scale: number;
};

export type WebGlRendererFrame = {
  readonly model: GhosttyTerminalModelApi;
  readonly damage: TerminalDamage;
  readonly cursorVisible: boolean;
  readonly textBlinkVisible: boolean;
  readonly hasSelection: boolean;
  readonly selectionContains: (line: number, column: number) => boolean;
  readonly searchMatchAt: (row: number, column: number) => 0 | 1 | 2;
};

export type XtermWebGlRendererStats = {
  readonly cells: number;
  readonly cellCapacity: number;
  readonly backingStoreResizes: number;
  readonly glyphs: number;
  readonly atlasBytes: number;
  readonly atlasUploads: number;
  readonly atlasUploadedBytes: number;
  readonly cpuBufferBytes: number;
  readonly frames: number;
  readonly uploads: number;
  readonly uploadedGlyphBytes: number;
  readonly contextRecoveries: number;
};

type Program = {
  readonly value: WebGLProgram;
  readonly projection: WebGLUniformLocation;
};

type GlyphProgram = Program & {
  readonly resolution: WebGLUniformLocation;
  readonly atlas: WebGLUniformLocation;
  readonly colorAtlas: WebGLUniformLocation;
  readonly textBlinkVisible: WebGLUniformLocation;
};

type RectangleVertices = {
  attributes: Float32Array;
  count: number;
};

type RendererResources = {
  readonly colorProgram: Program;
  readonly glyphProgram: GlyphProgram;
  readonly backgroundVao: WebGLVertexArrayObject;
  readonly cursorVao: WebGLVertexArrayObject;
  readonly glyphVao: WebGLVertexArrayObject;
  readonly backgroundBuffer: WebGLBuffer;
  readonly cursorBuffer: WebGLBuffer;
  readonly glyphBuffer: WebGLBuffer;
  readonly buffers: readonly WebGLBuffer[];
  readonly vaos: readonly WebGLVertexArrayObject[];
  readonly programs: readonly WebGLProgram[];
};

export class XtermWebGlRenderer {
  readonly canvas = document.createElement("canvas");

  private readonly backingStore = new CanvasBackingStore(this.canvas);
  private readonly gl: WebGL2RenderingContext;
  private resources: RendererResources | null = null;
  private profile: WebGlRendererProfile | null = null;
  private atlas: WebGlGlyphAtlas | null = null;
  private glyphAttributes = new Float32Array(0);
  private backgrounds = new Uint32Array(0);
  private foregrounds = new Uint32Array(0);
  private underlineColors = new Uint32Array(0);
  private flags = new Uint8Array(0);
  private decorations = new Uint8Array(0);
  private blinkingRows = new Uint8Array(0);
  private readonly backgroundVertices: RectangleVertices = {
    attributes: new Float32Array(INITIAL_RECTANGLE_CAPACITY * RECTANGLE_FLOATS),
    count: 0,
  };
  private readonly cursorVertices: RectangleVertices = {
    attributes: new Float32Array(RECTANGLE_FLOATS * 4),
    count: 0,
  };
  private glyphInstanceCount = 0;
  private cellCapacity = 0;
  private rowCapacity = 0;
  private cols = 0;
  private rows = 0;
  private forceFullRedraw = true;
  private contextLost = false;
  private viewportDirty = true;
  private contextRestoreTimer: number | null = null;
  private frameCount = 0;
  private uploadCount = 0;
  private uploadedGlyphBytes = 0;
  private contextRecoveryCount = 0;
  private backingStoreResizeCount = 0;
  private blinkingRowCount = 0;
  private disposed = false;
  private onContextRestored: (() => void) | null = null;
  private onContextFailure: ((error: Error) => void) | null = null;

  constructor() {
    this.canvas.className = "block";
    this.canvas.setAttribute("aria-hidden", "true");
    const context = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      desynchronized: true,
      failIfMajorPerformanceCaveat: true,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
      stencil: false,
    });
    if (!context) throw new Error("WebGL2 is unavailable in this webview");
    this.gl = context;
    this.resources = this.createResources();
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.addEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
    );
  }

  configure(
    profile: WebGlRendererProfile,
    onContextRestored: () => void,
    onContextFailure: (error: Error) => void,
  ): void {
    this.assertLive();
    this.onContextRestored = onContextRestored;
    this.onContextFailure = onContextFailure;
    const fontChanged =
      !this.profile ||
      rendererProfileKey(this.profile) !== rendererProfileKey(profile);
    this.profile = profile;
    if (fontChanged && !this.contextLost) {
      this.atlas?.dispose();
      this.atlas = new WebGlGlyphAtlas(this.gl, profile.metrics, profile.scale);
      this.forceFullRedraw = true;
    }
  }

  attach(host: HTMLElement): void {
    this.assertLive();
    if (this.canvas.parentElement === host) return;
    this.canvas.remove();
    host.prepend(this.canvas);
    this.forceFullRedraw = true;
  }

  detach(): void {
    this.canvas.remove();
    this.onContextRestored = null;
    this.onContextFailure = null;
  }

  resize(cols: number, rows: number): boolean {
    this.assertLive();
    if (!this.profile) throw new Error("WebGL renderer is not configured");
    if (cols * rows > MAX_SURFACE_CELLS) {
      throw new RangeError(
        `Terminal surface exceeds ${MAX_SURFACE_CELLS} visible cells`,
      );
    }

    const changed = cols !== this.cols || rows !== this.rows;
    this.cols = cols;
    this.rows = rows;
    const width = Math.max(
      1,
      Math.round(cols * this.profile.metrics.cellWidth * this.profile.scale),
    );
    const height = Math.max(
      1,
      Math.round(rows * this.profile.metrics.cellHeight * this.profile.scale),
    );
    const backingStoreChanged = this.backingStore.stage(
      width,
      height,
      cols * this.profile.metrics.cellWidth,
      rows * this.profile.metrics.cellHeight,
    );
    if (backingStoreChanged) this.viewportDirty = true;
    if (changed) this.resizeModel(cols, rows);
    if (changed || backingStoreChanged) this.forceFullRedraw = true;
    return changed || backingStoreChanged;
  }

  render(frame: WebGlRendererFrame): boolean {
    this.assertLive();
    if (
      this.contextLost ||
      !this.resources ||
      !this.profile ||
      !this.atlas ||
      this.cols < 1 ||
      this.rows < 1
    ) {
      return false;
    }
    const backingStoreChanged = this.backingStore.commit();
    if (backingStoreChanged) this.backingStoreResizeCount += 1;
    if (backingStoreChanged || this.viewportDirty) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.viewportDirty = false;
      this.forceFullRedraw = true;
    }

    const damage = this.forceFullRedraw
      ? { kind: "full" as const }
      : frame.damage;
    if (damage.kind !== "none") this.updateModel(frame, damage);
    this.updateCursor(frame);
    this.draw(frame.textBlinkVisible);
    this.forceFullRedraw = false;
    this.frameCount += 1;
    return true;
  }

  resetModel(): void {
    this.forceFullRedraw = true;
    resetGlyphGrid(this.glyphAttributes, this.cols, this.rows);
    const cells = this.cols * this.rows;
    this.backgrounds.fill(0, 0, cells);
    this.foregrounds.fill(0, 0, cells);
    this.underlineColors.fill(0, 0, cells);
    this.flags.fill(0, 0, cells);
    this.decorations.fill(0, 0, cells);
    this.blinkingRows.fill(0, 0, this.rows);
    this.blinkingRowCount = 0;
    this.glyphInstanceCount = 0;
  }

  diagnostics(): XtermWebGlRendererStats {
    return {
      cells: this.cols * this.rows,
      cellCapacity: this.cellCapacity,
      backingStoreResizes: this.backingStoreResizeCount,
      glyphs: this.atlas?.glyphCount ?? 0,
      atlasBytes: this.atlas?.byteSize ?? 0,
      atlasUploads: this.atlas?.uploadCount ?? 0,
      atlasUploadedBytes: this.atlas?.uploadedBytes ?? 0,
      cpuBufferBytes:
        this.glyphAttributes.byteLength +
        this.backgrounds.byteLength +
        this.foregrounds.byteLength +
        this.underlineColors.byteLength +
        this.flags.byteLength +
        this.decorations.byteLength +
        this.backgroundVertices.attributes.byteLength +
        this.cursorVertices.attributes.byteLength,
      frames: this.frameCount,
      uploads: this.uploadCount,
      uploadedGlyphBytes: this.uploadedGlyphBytes,
      contextRecoveries: this.contextRecoveryCount,
    };
  }

  get hasBlinkingCells(): boolean {
    return this.blinkingRowCount > 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearContextRestoreTimer();
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
    );
    this.canvas.remove();
    this.atlas?.dispose();
    this.atlas = null;
    this.deleteResources();
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.onContextRestored = null;
    this.onContextFailure = null;
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.clearContextRestoreTimer();
    this.contextRestoreTimer = window.setTimeout(() => {
      this.contextRestoreTimer = null;
      this.onContextFailure?.(
        new Error("WebGL context was not restored within 3 seconds"),
      );
    }, CONTEXT_RESTORE_TIMEOUT_MS);
  };

  private readonly handleContextRestored = (): void => {
    if (this.disposed) return;
    this.clearContextRestoreTimer();
    this.contextLost = false;
    this.atlas = null;
    this.resources = this.createResources();
    if (this.profile) {
      this.atlas = new WebGlGlyphAtlas(
        this.gl,
        this.profile.metrics,
        this.profile.scale,
      );
    }
    this.contextRecoveryCount += 1;
    this.viewportDirty = true;
    this.forceFullRedraw = true;
    this.onContextRestored?.();
  };

  private updateModel(frame: WebGlRendererFrame, damage: TerminalDamage): void {
    const cells = frame.model.renderCells();
    const expected = this.cols * this.rows;
    if (cells.length !== expected) {
      throw new Error(
        `Ghostty viewport mismatch: expected ${expected}, received ${cells.length}`,
      );
    }

    let ranges =
      damage.kind === "rows"
        ? damage.ranges
        : [{ start: 0, end: this.rows - 1 }];
    let stable = false;
    for (let attempt = 0; attempt < 3 && !stable; attempt += 1) {
      const generation = this.atlas?.generation ?? 0;
      for (const range of ranges) {
        this.buildRows(frame, cells, range.start, range.end);
      }
      stable = generation === this.atlas?.generation;
      if (!stable) ranges = [{ start: 0, end: this.rows - 1 }];
    }
    if (!stable) throw new Error("Visible glyphs exceed the atlas budget");
    this.buildBackgrounds();
    this.uploadGlyphs(ranges);
  }

  private buildRows(
    frame: WebGlRendererFrame,
    cells: TerminalCellReader,
    firstRow: number,
    lastRow: number,
  ): void {
    if (!this.profile || !this.atlas) return;
    const first = Math.max(0, firstRow);
    const last = Math.min(this.rows - 1, lastRow);
    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    const viewportOrigin = frame.model.viewportOriginLine();

    for (let row = first; row <= last; row += 1) {
      let rowHasBlinkingCell = false;
      let previousBackground = this.packRgb(this.profile.theme.background);
      for (let column = 0; column < this.cols; column += 1) {
        const cellIndex = row * this.cols + column;
        const glyphIndex = cellIndex * GLYPH_FLOATS;
        const width = cells.width(cellIndex);
        this.clearGlyph(glyphIndex);
        if (width === 0) {
          this.backgrounds[cellIndex] = previousBackground;
          this.foregrounds[cellIndex] = 0;
          this.underlineColors[cellIndex] = 0;
          this.flags[cellIndex] = 0;
          this.decorations[cellIndex] = 0;
          continue;
        }

        const flags = cells.flags(cellIndex);
        rowHasBlinkingCell ||= (flags & CellFlags.BLINK) !== 0;
        let foreground = cells.foregroundPacked(cellIndex);
        let background = cells.backgroundPacked(cellIndex);
        if ((flags & CellFlags.INVERSE) !== 0) {
          [foreground, background] = [background, foreground];
        }
        const searchMatch = frame.searchMatchAt(row, column);
        if (searchMatch !== 0) {
          background =
            searchMatch === 2
              ? SEARCH_ACTIVE_MATCH_BACKGROUND
              : SEARCH_MATCH_BACKGROUND;
        }
        if (
          frame.hasSelection &&
          frame.selectionContains(viewportOrigin + row, column)
        ) {
          background = blendPackedRgb(
            background,
            this.packRgb(this.profile.theme.selection.color),
            this.profile.theme.selection.alpha,
          );
        }
        this.backgrounds[cellIndex] = background;
        this.foregrounds[cellIndex] = foreground;
        this.underlineColors[cellIndex] = cells.underlineColorPacked(cellIndex);
        this.flags[cellIndex] = flags;
        this.decorations[cellIndex] =
          cells.underlineStyle(cellIndex) | (cells.overline(cellIndex) ? 8 : 0);

        const codepoint = cells.codepoint(cellIndex);
        if (
          codepoint !== 0 &&
          codepoint !== 32 &&
          (flags & CellFlags.INVISIBLE) === 0
        ) {
          const grapheme =
            cells.graphemeLength(cellIndex) > 0
              ? frame.model.grapheme(row, column)
              : null;
          const glyph = this.atlas.glyph(codepoint, grapheme, flags);
          this.writeGlyph(
            glyphIndex,
            glyph,
            foreground,
            ((flags & CellFlags.FAINT) !== 0 ? 0.5 : 1) *
              ((flags & CellFlags.BLINK) !== 0 ? -1 : 1),
            previousBackground !== background,
            canvasWidth,
            canvasHeight,
          );
        }
        previousBackground = background;
      }
      const hadBlinkingCell = this.blinkingRows[row] !== 0;
      if (hadBlinkingCell !== rowHasBlinkingCell) {
        this.blinkingRowCount += rowHasBlinkingCell ? 1 : -1;
        this.blinkingRows[row] = rowHasBlinkingCell ? 1 : 0;
      }
    }
  }

  private writeGlyph(
    index: number,
    glyph: WebGlGlyphEntry,
    foreground: number,
    alpha: number,
    clipLeft: boolean,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    let offsetX = glyph.originOffsetX;
    let width = glyph.width;
    let uvMinX = glyph.uvMinX;
    const uvMaxX = glyph.uvMaxX;
    const leftPadding = Math.max(
      0,
      Math.floor(
        ((this.profile?.metrics.font.letterSpacing ?? 0) *
          (this.profile?.scale ?? 1)) /
          2,
      ),
    );
    if (clipLeft && offsetX < -leftPadding) {
      const clipped = Math.min(width, -leftPadding - offsetX);
      offsetX += clipped;
      width -= clipped;
      const uvWidth = glyph.uvMaxX - glyph.uvMinX;
      uvMinX += uvWidth * (clipped / glyph.width);
    }

    this.glyphAttributes[index] = offsetX;
    this.glyphAttributes[index + 1] = glyph.originOffsetY;
    this.glyphAttributes[index + 2] = width / canvasWidth;
    this.glyphAttributes[index + 3] = glyph.height / canvasHeight;
    this.glyphAttributes[index + 4] = uvMinX;
    this.glyphAttributes[index + 5] = glyph.uvMinY;
    this.glyphAttributes[index + 6] = uvMaxX - uvMinX;
    this.glyphAttributes[index + 7] = glyph.uvMaxY - glyph.uvMinY;
    writeNormalizedPackedColor(
      this.glyphAttributes,
      index + 8,
      foreground,
      alpha,
    );
    this.glyphAttributes[index + 12] = glyph.intrinsicColor ? 1 : 0;
  }

  private clearGlyph(index: number): void {
    this.glyphAttributes.fill(0, index, index + GLYPH_POSITION_OFFSET);
  }

  private buildBackgrounds(): void {
    if (!this.profile) return;
    const vertices = this.backgroundVertices;
    const defaultBackground = this.packRgb(this.profile.theme.background);
    let count = 0;

    for (let row = 0; row < this.rows; row += 1) {
      let runStart = -1;
      let runColor = defaultBackground;
      for (let column = 0; column <= this.cols; column += 1) {
        const index = row * this.cols + column;
        const color =
          column < this.cols ? this.backgrounds[index] : defaultBackground;
        if (color === runColor) continue;
        if (runStart >= 0 && runColor !== defaultBackground) {
          this.writeRectangle(
            vertices,
            count++,
            runStart,
            row,
            column - runStart,
            1,
            runColor,
            1,
          );
        }
        runStart = column;
        runColor = color;
      }

      for (let column = 0; column < this.cols; column += 1) {
        const index = row * this.cols + column;
        const flags = this.flags[index];
        const decoration = this.decorations[index];
        const underlineStyle = decoration & 7;
        if (underlineStyle !== 0) {
          const pixelLine =
            1 / (this.profile.metrics.cellHeight * this.profile.scale);
          const patterned = underlineStyle >= 2;
          this.writeRectangle(
            vertices,
            count++,
            column,
            row + (patterned ? 0.78 : 0.88),
            1,
            Math.max(pixelLine, patterned ? 0.2 : 0.05),
            this.underlineColors[index],
            1,
            underlineStyle,
          );
        }
        if ((flags & CellFlags.STRIKETHROUGH) !== 0) {
          this.writeRectangle(
            vertices,
            count++,
            column,
            row + 0.5,
            1,
            Math.max(
              1 / (this.profile.metrics.cellHeight * this.profile.scale),
              0.05,
            ),
            this.foregrounds[index],
            1,
          );
        }
        if ((decoration & 8) !== 0) {
          this.writeRectangle(
            vertices,
            count++,
            column,
            row + 0.08,
            1,
            Math.max(
              1 / (this.profile.metrics.cellHeight * this.profile.scale),
              0.05,
            ),
            this.foregrounds[index],
            1,
          );
        }
      }
    }
    vertices.count = count;
    this.uploadRectangles(vertices, this.resources?.backgroundBuffer ?? null);
  }

  private updateCursor(frame: WebGlRendererFrame): void {
    const vertices = this.cursorVertices;
    vertices.count = 0;
    if (!this.profile || !frame.cursorVisible) {
      this.uploadRectangles(vertices, this.resources?.cursorBuffer ?? null);
      return;
    }
    const cursor = frame.model.cursor();
    if (
      !cursor.visible ||
      cursor.x < 0 ||
      cursor.x >= this.cols ||
      cursor.y < 0 ||
      cursor.y >= this.rows
    ) {
      this.uploadRectangles(vertices, this.resources?.cursorBuffer ?? null);
      return;
    }

    const color = this.packRgb(this.profile.theme.cursor);
    if (cursor.style === "bar") {
      this.writeRectangle(vertices, 0, cursor.x, cursor.y, 0.12, 1, color, 1);
    } else if (cursor.style === "underline") {
      this.writeRectangle(
        vertices,
        0,
        cursor.x,
        cursor.y + 0.88,
        1,
        0.12,
        color,
        1,
      );
    } else {
      this.writeRectangle(vertices, 0, cursor.x, cursor.y, 1, 1, color, 1);
    }
    vertices.count = 1;
    this.uploadRectangles(vertices, this.resources?.cursorBuffer ?? null);
  }

  private uploadGlyphs(
    ranges: readonly { readonly start: number; readonly end: number }[],
  ): void {
    const resources = this.resources;
    if (!resources) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.glyphBuffer);
    const full =
      ranges.length === 1 &&
      ranges[0].start === 0 &&
      ranges[0].end === this.rows - 1;
    if (full) {
      const active = this.glyphAttributes.subarray(
        0,
        this.cols * this.rows * GLYPH_FLOATS,
      );
      gl.bufferData(gl.ARRAY_BUFFER, active, gl.DYNAMIC_DRAW);
      this.uploadCount += 1;
      this.uploadedGlyphBytes += active.byteLength;
    } else {
      for (const range of ranges) {
        const start = range.start * this.cols * GLYPH_FLOATS;
        const end = (range.end + 1) * this.cols * GLYPH_FLOATS;
        const bytes = this.glyphAttributes.subarray(start, end);
        gl.bufferSubData(gl.ARRAY_BUFFER, start * 4, bytes);
        this.uploadCount += 1;
        this.uploadedGlyphBytes += bytes.byteLength;
      }
    }
    this.glyphInstanceCount = this.cols * this.rows;
  }

  private uploadRectangles(
    vertices: RectangleVertices,
    buffer: WebGLBuffer | null,
  ): void {
    if (!buffer) return;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      vertices.attributes.subarray(0, vertices.count * RECTANGLE_FLOATS),
      this.gl.DYNAMIC_DRAW,
    );
  }

  private draw(textBlinkVisible: boolean): void {
    const resources = this.resources;
    const profile = this.profile;
    const atlas = this.atlas;
    if (!resources || !profile || !atlas) return;
    const gl = this.gl;
    const background = profile.theme.background;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.clearColor(
      background[0] / 255,
      background[1] / 255,
      background[2] / 255,
      1,
    );
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.disable(gl.BLEND);
    this.drawRectangles(
      resources.colorProgram,
      resources.backgroundVao,
      this.backgroundVertices.count,
    );
    this.drawRectangles(
      resources.colorProgram,
      resources.cursorVao,
      this.cursorVertices.count,
    );

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL method, not a React hook.
    gl.useProgram(resources.glyphProgram.value);
    gl.bindVertexArray(resources.glyphVao);
    gl.uniformMatrix4fv(
      resources.glyphProgram.projection,
      false,
      PROJECTION_MATRIX,
    );
    gl.uniform2f(
      resources.glyphProgram.resolution,
      this.canvas.width,
      this.canvas.height,
    );
    atlas.bindAndUpload();
    gl.uniform1i(resources.glyphProgram.atlas, 0);
    gl.uniform1i(resources.glyphProgram.colorAtlas, 1);
    gl.uniform1i(
      resources.glyphProgram.textBlinkVisible,
      textBlinkVisible ? 1 : 0,
    );
    gl.drawElementsInstanced(
      gl.TRIANGLE_STRIP,
      4,
      gl.UNSIGNED_BYTE,
      0,
      this.glyphInstanceCount,
    );
  }

  private drawRectangles(
    program: Program,
    vao: WebGLVertexArrayObject,
    count: number,
  ): void {
    if (count === 0) return;
    const gl = this.gl;
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL method, not a React hook.
    gl.useProgram(program.value);
    gl.bindVertexArray(vao);
    gl.uniformMatrix4fv(program.projection, false, PROJECTION_MATRIX);
    gl.drawElementsInstanced(gl.TRIANGLE_STRIP, 4, gl.UNSIGNED_BYTE, 0, count);
  }

  private writeRectangle(
    vertices: RectangleVertices,
    rectangle: number,
    x: number,
    y: number,
    width: number,
    height: number,
    color: number,
    alpha: number,
    decorationStyle = 0,
  ): void {
    const offset = rectangle * RECTANGLE_FLOATS;
    if (vertices.attributes.length < offset + RECTANGLE_FLOATS) {
      const capacity = nextPowerOfTwo(rectangle + 1);
      const expanded = new Float32Array(capacity * RECTANGLE_FLOATS);
      expanded.set(vertices.attributes);
      vertices.attributes = expanded;
    }
    vertices.attributes[offset] = x / this.cols;
    vertices.attributes[offset + 1] = y / this.rows;
    vertices.attributes[offset + 2] = width / this.cols;
    vertices.attributes[offset + 3] = height / this.rows;
    writeNormalizedPackedColor(vertices.attributes, offset + 4, color, alpha);
    vertices.attributes[offset + 8] = decorationStyle;
  }

  private resizeModel(cols: number, rows: number): void {
    const cells = cols * rows;
    if (cells > this.cellCapacity) {
      this.cellCapacity = nextWebGlCellCapacity(this.cellCapacity, cells);
      this.glyphAttributes = new Float32Array(this.cellCapacity * GLYPH_FLOATS);
      this.backgrounds = new Uint32Array(this.cellCapacity);
      this.foregrounds = new Uint32Array(this.cellCapacity);
      this.underlineColors = new Uint32Array(this.cellCapacity);
      this.flags = new Uint8Array(this.cellCapacity);
      this.decorations = new Uint8Array(this.cellCapacity);
    }
    if (rows > this.rowCapacity) {
      this.rowCapacity = nextPowerOfTwo(rows);
      this.blinkingRows = new Uint8Array(this.rowCapacity);
    } else {
      this.blinkingRows.fill(0, 0, rows);
    }
    this.blinkingRowCount = 0;

    resetGlyphGrid(this.glyphAttributes, cols, rows);
  }

  private createResources(): RendererResources {
    const gl = this.gl;
    const colorProgramValue = createProgram(
      gl,
      COLOR_VERTEX_SHADER,
      COLOR_FRAGMENT_SHADER,
    );
    const glyphProgramValue = createProgram(
      gl,
      GLYPH_VERTEX_SHADER,
      GLYPH_FRAGMENT_SHADER,
    );
    const colorProjection = requiredUniform(
      gl,
      colorProgramValue,
      "u_projection",
    );
    const glyphProjection = requiredUniform(
      gl,
      glyphProgramValue,
      "u_projection",
    );
    const glyphResolution = requiredUniform(
      gl,
      glyphProgramValue,
      "u_resolution",
    );
    const glyphAtlas = requiredUniform(gl, glyphProgramValue, "u_atlas");
    const glyphColorAtlas = requiredUniform(
      gl,
      glyphProgramValue,
      "u_color_atlas",
    );
    const glyphTextBlinkVisible = requiredUniform(
      gl,
      glyphProgramValue,
      "u_text_blink_visible",
    );

    const backgroundBuffer = requiredBuffer(gl);
    const cursorBuffer = requiredBuffer(gl);
    const glyphBuffer = requiredBuffer(gl);
    const unitQuadBuffer = requiredBuffer(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, unitQuadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const elementBuffer = requiredBuffer(gl);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint8Array([0, 1, 2, 3]),
      gl.STATIC_DRAW,
    );
    const backgroundVao = createRectangleVao(
      gl,
      backgroundBuffer,
      unitQuadBuffer,
      elementBuffer,
    );
    const cursorVao = createRectangleVao(
      gl,
      cursorBuffer,
      unitQuadBuffer,
      elementBuffer,
    );
    const glyphVao = createGlyphVao(
      gl,
      glyphBuffer,
      unitQuadBuffer,
      elementBuffer,
    );

    return {
      colorProgram: {
        value: colorProgramValue,
        projection: colorProjection,
      },
      glyphProgram: {
        value: glyphProgramValue,
        projection: glyphProjection,
        resolution: glyphResolution,
        atlas: glyphAtlas,
        colorAtlas: glyphColorAtlas,
        textBlinkVisible: glyphTextBlinkVisible,
      },
      backgroundVao,
      cursorVao,
      glyphVao,
      backgroundBuffer,
      cursorBuffer,
      glyphBuffer,
      buffers: [
        backgroundBuffer,
        cursorBuffer,
        glyphBuffer,
        unitQuadBuffer,
        elementBuffer,
      ],
      vaos: [backgroundVao, cursorVao, glyphVao],
      programs: [colorProgramValue, glyphProgramValue],
    };
  }

  private deleteResources(): void {
    const resources = this.resources;
    this.resources = null;
    if (!resources || this.contextLost) return;
    for (const vao of resources.vaos) this.gl.deleteVertexArray(vao);
    for (const buffer of resources.buffers) this.gl.deleteBuffer(buffer);
    for (const program of resources.programs) this.gl.deleteProgram(program);
  }

  private clearContextRestoreTimer(): void {
    if (this.contextRestoreTimer !== null) {
      window.clearTimeout(this.contextRestoreTimer);
    }
    this.contextRestoreTimer = null;
  }

  private packRgb(color: Rgb): number {
    return (color[0] << 16) | (color[1] << 8) | color[2];
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("WebGL renderer is disposed");
  }
}

export function rendererProfileKey(profile: WebGlRendererProfile): string {
  const font = profile.metrics.font;
  return [
    font.family,
    font.size,
    font.weight,
    font.lineHeight,
    font.letterSpacing,
    profile.metrics.cellWidth,
    profile.metrics.cellHeight,
    profile.metrics.baseline,
    profile.scale,
  ].join("|");
}

export function resetGlyphGrid(
  attributes: Float32Array,
  cols: number,
  rows: number,
): void {
  const expectedLength = cols * rows * GLYPH_FLOATS;
  if (attributes.length < expectedLength) {
    throw new RangeError(
      `Glyph grid is too small: expected at least ${expectedLength}, received ${attributes.length}`,
    );
  }
  attributes.fill(0, 0, expectedLength);
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      attributes[index + GLYPH_POSITION_OFFSET] = column / cols;
      attributes[index + GLYPH_POSITION_OFFSET + 1] = row / rows;
      index += GLYPH_FLOATS;
    }
  }
}

function createRectangleVao(
  gl: WebGL2RenderingContext,
  attributesBuffer: WebGLBuffer,
  unitQuadBuffer: WebGLBuffer,
  elementBuffer: WebGLBuffer,
): WebGLVertexArrayObject {
  const vao = requiredVertexArray(gl);
  gl.bindVertexArray(vao);
  bindUnitQuad(gl, unitQuadBuffer, elementBuffer, 4);
  gl.bindBuffer(gl.ARRAY_BUFFER, attributesBuffer);
  configureAttribute(gl, 0, 2, RECTANGLE_FLOATS, 0);
  configureAttribute(gl, 1, 2, RECTANGLE_FLOATS, 2);
  configureAttribute(gl, 2, 4, RECTANGLE_FLOATS, 4);
  configureAttribute(gl, 3, 1, RECTANGLE_FLOATS, 8);
  return vao;
}

function createGlyphVao(
  gl: WebGL2RenderingContext,
  attributesBuffer: WebGLBuffer,
  unitQuadBuffer: WebGLBuffer,
  elementBuffer: WebGLBuffer,
): WebGLVertexArrayObject {
  const vao = requiredVertexArray(gl);
  gl.bindVertexArray(vao);
  bindUnitQuad(gl, unitQuadBuffer, elementBuffer, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, attributesBuffer);
  configureAttribute(gl, 1, 2, GLYPH_FLOATS, 0);
  configureAttribute(gl, 2, 2, GLYPH_FLOATS, 2);
  configureAttribute(gl, 3, 2, GLYPH_FLOATS, 4);
  configureAttribute(gl, 4, 2, GLYPH_FLOATS, 6);
  configureAttribute(gl, 5, 4, GLYPH_FLOATS, 8);
  configureAttribute(gl, 6, 1, GLYPH_FLOATS, 12);
  configureAttribute(gl, 7, 2, GLYPH_FLOATS, 13);
  return vao;
}

function bindUnitQuad(
  gl: WebGL2RenderingContext,
  vertices: WebGLBuffer,
  indices: WebGLBuffer,
  location: number,
): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
}

function configureAttribute(
  gl: WebGL2RenderingContext,
  location: number,
  size: number,
  stride: number,
  offset: number,
): void {
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(
    location,
    size,
    gl.FLOAT,
    false,
    stride * Float32Array.BYTES_PER_ELEMENT,
    offset * Float32Array.BYTES_PER_ELEMENT,
  );
  gl.vertexAttribDivisor(location, 1);
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to allocate a WebGL program");
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const detail = gl.getProgramInfoLog(program) || "unknown link error";
    gl.deleteProgram(program);
    throw new Error(`Failed to link the WebGL terminal program: ${detail}`);
  }
  return program;
}

function createShader(
  gl: WebGL2RenderingContext,
  kind: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(kind);
  if (!shader) throw new Error("Failed to allocate a WebGL shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) || "unknown compile error";
    gl.deleteShader(shader);
    throw new Error(`Failed to compile a WebGL terminal shader: ${detail}`);
  }
  return shader;
}

function requiredUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) throw new Error(`Missing WebGL uniform ${name}`);
  return location;
}

function requiredBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("Failed to allocate a WebGL buffer");
  return buffer;
}

function requiredVertexArray(
  gl: WebGL2RenderingContext,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("Failed to allocate a WebGL vertex array");
  return vao;
}

function writeNormalizedPackedColor(
  target: Float32Array,
  offset: number,
  color: number,
  alpha: number,
): void {
  target[offset] = ((color >> 16) & 0xff) / 255;
  target[offset + 1] = ((color >> 8) & 0xff) / 255;
  target[offset + 2] = (color & 0xff) / 255;
  target[offset + 3] = alpha;
}

function blendPackedRgb(
  background: number,
  foreground: number,
  alpha: number,
): number {
  const amount = Math.max(0, Math.min(1, alpha));
  const inverse = 1 - amount;
  const red = Math.round(
    ((background >> 16) & 0xff) * inverse +
      ((foreground >> 16) & 0xff) * amount,
  );
  const green = Math.round(
    ((background >> 8) & 0xff) * inverse + ((foreground >> 8) & 0xff) * amount,
  );
  const blue = Math.round(
    (background & 0xff) * inverse + (foreground & 0xff) * amount,
  );
  return (red << 16) | (green << 8) | blue;
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

export function nextWebGlCellCapacity(
  current: number,
  required: number,
): number {
  if (!Number.isInteger(required) || required < 0) {
    throw new RangeError("WebGL cell capacity must be a non-negative integer");
  }
  if (required > MAX_SURFACE_CELLS) {
    throw new RangeError(
      `Terminal surface exceeds ${MAX_SURFACE_CELLS} visible cells`,
    );
  }
  if (required <= current) return current;
  const target =
    current > 0
      ? Math.max(required, Math.ceil(current * 1.5))
      : Math.max(MIN_CELL_CAPACITY, Math.ceil(required * 1.125));
  return Math.min(
    MAX_SURFACE_CELLS,
    Math.ceil(target / CELL_CAPACITY_ALIGNMENT) * CELL_CAPACITY_ALIGNMENT,
  );
}

const COLOR_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_size;
layout(location = 2) in vec4 a_color;
layout(location = 3) in float a_decoration;
layout(location = 4) in vec2 a_unitquad;
uniform mat4 u_projection;
out vec4 v_color;
out vec2 v_unitquad;
flat out float v_decoration;
void main() {
  vec2 zeroToOne = a_position + a_unitquad * a_size;
  gl_Position = u_projection * vec4(zeroToOne, 0.0, 1.0);
  v_color = a_color;
  v_unitquad = a_unitquad;
  v_decoration = a_decoration;
}`;

const COLOR_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 v_color;
in vec2 v_unitquad;
flat in float v_decoration;
out vec4 outColor;
void main() {
  int style = int(v_decoration + 0.5);
  if (style == 2 && v_unitquad.y > 0.28 && v_unitquad.y < 0.72) discard;
  if (style == 3) {
    float wave = 0.5 + sin(v_unitquad.x * 12.5663706) * 0.27;
    if (abs(v_unitquad.y - wave) > 0.18) discard;
  }
  if (style == 4 && fract(v_unitquad.x * 4.0) > 0.42) discard;
  if (style == 5 && fract(v_unitquad.x * 2.0) > 0.68) discard;
  outColor = v_color;
}`;

const GLYPH_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_unitquad;
layout(location = 1) in vec2 a_offset;
layout(location = 2) in vec2 a_size;
layout(location = 3) in vec2 a_texcoord;
layout(location = 4) in vec2 a_texsize;
layout(location = 5) in vec4 a_color;
layout(location = 6) in float a_intrinsic_color;
layout(location = 7) in vec2 a_cellpos;
uniform mat4 u_projection;
uniform vec2 u_resolution;
out vec2 v_texcoord;
out vec4 v_color;
flat out float v_intrinsic_color;
void main() {
  vec2 zeroToOne = (a_offset / u_resolution) + a_cellpos + a_unitquad * a_size;
  gl_Position = u_projection * vec4(zeroToOne, 0.0, 1.0);
  v_texcoord = a_texcoord + a_unitquad * a_texsize;
  v_color = a_color;
  v_intrinsic_color = a_intrinsic_color;
}`;

const GLYPH_FRAGMENT_SHADER = `#version 300 es
precision lowp float;
uniform sampler2D u_atlas;
uniform sampler2D u_color_atlas;
uniform bool u_text_blink_visible;
in vec2 v_texcoord;
in vec4 v_color;
flat in float v_intrinsic_color;
out vec4 outColor;
void main() {
  float alpha = abs(v_color.a);
  if (v_color.a < 0.0 && !u_text_blink_visible) alpha = 0.0;
  if (v_intrinsic_color > 0.5) {
    vec4 color = texture(u_color_atlas, v_texcoord);
    outColor = vec4(color.rgb, alpha * color.a);
  } else {
    float coverage = texture(u_atlas, v_texcoord).r;
    outColor = vec4(v_color.rgb, alpha * coverage);
  }
}`;
