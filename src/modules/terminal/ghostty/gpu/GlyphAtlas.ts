import { CellFlags } from "@terax/ghostty-core/protocol";
import { hasIntrinsicColor } from "./glyphColor";
import { SkylineAtlasAllocator } from "./SkylineAtlasAllocator";
import { fontCss, type TerminalFontMetrics } from "./terminalVisuals";

const COVERAGE_ATLAS_SIZE = 1_024;
const COLOR_ATLAS_SIZE = 512;
const RASTER_SIZE = 256;
const GLYPH_PADDING = 2;
const COPY_BYTES_PER_ROW_ALIGNMENT = 256;

export type GlyphEntry = {
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

type TextureUpload = {
  readonly texture: GPUTexture;
  readonly source: Uint8Array;
  readonly atlasWidth: number;
  readonly bytesPerPixel: number;
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
  readonly rowBytes: number;
  readonly bytesPerRow: number;
  readonly byteLength: number;
};

const NULL_GLYPH: GlyphEntry = {
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

export class GlyphAtlasCapacityError extends Error {
  constructor(
    readonly atlasKind: "coverage" | "color",
    readonly glyphWidth: number,
    readonly glyphHeight: number,
  ) {
    const size = atlasKind === "color" ? COLOR_ATLAS_SIZE : COVERAGE_ATLAS_SIZE;
    super(
      `The ${size}px ${atlasKind} glyph atlas cannot fit a ${glyphWidth}x${glyphHeight}px glyph`,
    );
    this.name = "GlyphAtlasCapacityError";
  }
}

/** A shared, fixed-budget WebGPU atlas keyed by font metrics and scale. */
export class GlyphAtlas {
  readonly coverageInRed = true;

  private readonly coverageAllocator = new SkylineAtlasAllocator(
    COVERAGE_ATLAS_SIZE,
    COVERAGE_ATLAS_SIZE,
  );
  private readonly colorAllocator = new SkylineAtlasAllocator(
    COLOR_ATLAS_SIZE,
    COLOR_ATLAS_SIZE,
  );
  private readonly simpleGlyphs = new Map<number, GlyphEntry>();
  private readonly complexGlyphs = new Map<number, Map<string, GlyphEntry>>();
  private coveragePixels = new Uint8Array(
    COVERAGE_ATLAS_SIZE * COVERAGE_ATLAS_SIZE,
  );
  private colorPixels: Uint8Array | null = null;
  private readonly rasterCanvas = document.createElement("canvas");
  private readonly rasterContext: CanvasRenderingContext2D;
  private coverageTexture: GPUTexture;
  private coverageView: GPUTextureView;
  private colorTexture: GPUTexture;
  private colorView: GPUTextureView;
  private coverageDirty: DirtyRectangle | null = null;
  private colorDirty: DirtyRectangle | null = null;
  private coverageUsed: DirtyRectangle | null = null;
  private colorUsed: DirtyRectangle | null = null;
  private readonly encodedUploadBuffers: GPUBuffer[] = [];
  private readonly submittedUploadBuffers = new Set<GPUBuffer>();
  private readonly retiredTextures: GPUTexture[] = [];
  private readonly submittedTextures = new Set<GPUTexture>();
  private uploadCountValue = 0;
  private uploadedBytesValue = 0;
  private resetCountValue = 0;
  private capacityFailureCountValue = 0;
  private generationValue = 1;
  private gpuActive = true;
  private disposed = false;

  constructor(
    private device: GPUDevice,
    private readonly metrics: TerminalFontMetrics,
    private readonly scale: number,
    private readonly onReset: () => void,
  ) {
    this.rasterCanvas.width = RASTER_SIZE;
    this.rasterCanvas.height = RASTER_SIZE;
    const context = this.rasterCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!context) throw new Error("Glyph rasterization is unavailable");
    this.rasterContext = context;
    [
      this.coverageTexture,
      this.coverageView,
      this.colorTexture,
      this.colorView,
    ] = this.allocateTextures();
  }

  get byteSize(): number {
    if (!this.gpuActive || this.disposed) return 0;
    let retiredBytes = 0;
    for (const texture of this.retiredTextures)
      retiredBytes += textureBytes(texture);
    for (const texture of this.submittedTextures)
      retiredBytes += textureBytes(texture);
    return (
      retiredBytes +
      COVERAGE_ATLAS_SIZE * COVERAGE_ATLAS_SIZE +
      (this.colorPixels ? COLOR_ATLAS_SIZE * COLOR_ATLAS_SIZE * 4 : 4)
    );
  }

  get cpuByteSize(): number {
    return (
      this.coveragePixels.byteLength +
      (this.colorPixels?.byteLength ?? 0) +
      (this.disposed || !this.gpuActive ? 0 : RASTER_SIZE * RASTER_SIZE * 4)
    );
  }

  get stagingBytes(): number {
    let total = 0;
    for (const buffer of this.encodedUploadBuffers) total += buffer.size;
    for (const buffer of this.submittedUploadBuffers) total += buffer.size;
    return total;
  }

  get generation(): number {
    return this.generationValue;
  }

  get coverageTextureView(): GPUTextureView {
    return this.coverageView;
  }

  get colorTextureView(): GPUTextureView {
    return this.colorView;
  }

  get glyphCount(): number {
    let complexCount = 0;
    for (const glyphs of this.complexGlyphs.values()) {
      complexCount += glyphs.size;
    }
    return this.simpleGlyphs.size + complexCount;
  }

  get uploadCount(): number {
    return this.uploadCountValue;
  }

  get uploadedBytes(): number {
    return this.uploadedBytesValue;
  }

  get resetCount(): number {
    return this.resetCountValue;
  }

  get capacityFailureCount(): number {
    return this.capacityFailureCountValue;
  }

  get hasEncodedUploads(): boolean {
    return (
      this.encodedUploadBuffers.length > 0 || this.retiredTextures.length > 0
    );
  }

  suspend(): void {
    if (this.disposed || !this.gpuActive) return;
    this.gpuActive = false;
    this.coverageTexture.destroy();
    this.colorTexture.destroy();
    this.releaseUploads();
    this.rasterCanvas.width = 1;
    this.rasterCanvas.height = 1;
  }

  resume(device: GPUDevice): void {
    this.assertLive();
    if (this.gpuActive && this.device === device) return;
    this.suspend();
    this.device = device;
    [
      this.coverageTexture,
      this.coverageView,
      this.colorTexture,
      this.colorView,
    ] = this.allocateTextures();
    this.gpuActive = true;
    this.rasterCanvas.width = RASTER_SIZE;
    this.rasterCanvas.height = RASTER_SIZE;
    this.coverageDirty = this.coverageUsed ? { ...this.coverageUsed } : null;
    this.colorDirty = this.colorUsed ? { ...this.colorUsed } : null;
    this.bumpGeneration();
  }

  glyph(codepoint: number, grapheme: string | null, flags: number): GlyphEntry {
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

    let styledGlyphs = this.complexGlyphs.get(style);
    const cached = styledGlyphs?.get(grapheme);
    if (cached) return cached;
    const entry = this.rasterize(grapheme, flags);
    if (!styledGlyphs) {
      styledGlyphs = new Map();
      this.complexGlyphs.set(style, styledGlyphs);
    }
    styledGlyphs.set(grapheme, entry);
    return entry;
  }

  encodePendingUploads(encoder: GPUCommandEncoder): void {
    this.assertLive();
    const uploads: TextureUpload[] = [];
    if (this.coverageDirty) {
      uploads.push(
        createTextureUpload(
          this.coverageTexture,
          this.coveragePixels,
          COVERAGE_ATLAS_SIZE,
          1,
          this.coverageDirty,
        ),
      );
    }
    if (this.colorDirty && this.colorPixels) {
      uploads.push(
        createTextureUpload(
          this.colorTexture,
          this.colorPixels,
          COLOR_ATLAS_SIZE,
          4,
          this.colorDirty,
        ),
      );
    }
    if (uploads.length === 0) return;

    const offsets: number[] = [];
    let totalBytes = 0;
    for (const upload of uploads) {
      offsets.push(totalBytes);
      totalBytes += upload.byteLength;
    }
    const staging = this.device.createBuffer({
      label: "Terax terminal glyph upload staging",
      size: totalBytes,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
    this.encodedUploadBuffers.push(staging);
    const mapped = new Uint8Array(staging.getMappedRange());
    for (let index = 0; index < uploads.length; index += 1) {
      writeTextureUpload(mapped, offsets[index], uploads[index]);
    }
    staging.unmap();

    for (let index = 0; index < uploads.length; index += 1) {
      const upload = uploads[index];
      encoder.copyBufferToTexture(
        {
          buffer: staging,
          offset: offsets[index],
          bytesPerRow: upload.bytesPerRow,
          rowsPerImage: upload.height,
        },
        {
          texture: upload.texture,
          origin: [upload.originX, upload.originY, 0],
        },
        [upload.width, upload.height, 1],
      );
    }
    this.uploadCountValue += uploads.length;
    this.uploadedBytesValue += totalBytes;
    this.coverageDirty = null;
    this.colorDirty = null;
  }

  completeSubmission(
    completion = this.device.queue.onSubmittedWorkDone(),
  ): void {
    if (!this.hasEncodedUploads) return;
    const textures = this.retiredTextures.splice(0);
    for (const texture of textures) this.submittedTextures.add(texture);
    const buffers = this.encodedUploadBuffers.splice(0);
    for (const buffer of buffers) this.submittedUploadBuffers.add(buffer);
    void completion
      .catch(() => undefined)
      .then(() => {
        for (const texture of textures) {
          if (this.submittedTextures.delete(texture)) texture.destroy();
        }
        for (const buffer of buffers) {
          if (this.submittedUploadBuffers.delete(buffer)) buffer.destroy();
        }
      });
  }

  /**
   * Discards cold glyphs before rebuilding one surface's complete visible set.
   * Callers must not reset an atlas that is still shared by another surface.
   */
  resetForRebuild(): void {
    this.assertLive();
    this.resetCountValue += 1;
    this.reset();
  }

  dispose(): void {
    if (this.disposed) return;
    this.suspend();
    this.disposed = true;
    this.simpleGlyphs.clear();
    this.complexGlyphs.clear();
    this.coverageDirty = null;
    this.colorDirty = null;
    this.colorPixels = null;
    this.coveragePixels = new Uint8Array(0);
  }

  private releaseUploads(): void {
    for (const texture of this.retiredTextures) texture.destroy();
    this.retiredTextures.length = 0;
    for (const texture of this.submittedTextures) texture.destroy();
    this.submittedTextures.clear();
    for (const buffer of this.encodedUploadBuffers) buffer.destroy();
    this.encodedUploadBuffers.length = 0;
    for (const buffer of this.submittedUploadBuffers) buffer.destroy();
    this.submittedUploadBuffers.clear();
  }

  private rasterize(text: string, flags: number): GlyphEntry {
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
    const region = allocator.allocate(width, height);
    if (!region) {
      this.capacityFailureCountValue += 1;
      throw new GlyphAtlasCapacityError(
        intrinsicColor ? "color" : "coverage",
        width,
        height,
      );
    }

    if (intrinsicColor) {
      const colorPixels = this.colorPixels as Uint8Array;
      for (let row = 0; row < height; row += 1) {
        const source = row * width * 4;
        const target = ((region.y + row) * COLOR_ATLAS_SIZE + region.x) * 4;
        colorPixels.set(rgba.subarray(source, source + width * 4), target);
      }
      this.colorUsed = mergeDirty(
        this.colorUsed,
        region.x,
        region.y,
        width,
        height,
      );
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
        let target = (region.y + row) * COVERAGE_ATLAS_SIZE + region.x;
        for (let column = 0; column < width; column += 1) {
          this.coveragePixels[target] = rgba[source];
          source += 4;
          target += 1;
        }
      }
      this.coverageUsed = mergeDirty(
        this.coverageUsed,
        region.x,
        region.y,
        width,
        height,
      );
      this.coverageDirty = mergeDirty(
        this.coverageDirty,
        region.x,
        region.y,
        width,
        height,
      );
    }

    const atlasSize = intrinsicColor ? COLOR_ATLAS_SIZE : COVERAGE_ATLAS_SIZE;
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
    const texture = this.createColorTexture();
    let view: GPUTextureView;
    try {
      view = texture.createView();
    } catch (error) {
      texture.destroy();
      throw error;
    }
    this.colorPixels = new Uint8Array(COLOR_ATLAS_SIZE * COLOR_ATLAS_SIZE * 4);
    this.retiredTextures.push(this.colorTexture);
    this.colorTexture = texture;
    this.colorView = view;
    this.bumpGeneration();
  }

  private reset(): void {
    const textures = this.allocateTextures();
    this.retiredTextures.push(this.coverageTexture, this.colorTexture);
    [
      this.coverageTexture,
      this.coverageView,
      this.colorTexture,
      this.colorView,
    ] = textures;
    this.coverageAllocator.reset();
    this.colorAllocator.reset();
    this.simpleGlyphs.clear();
    this.complexGlyphs.clear();
    this.coveragePixels.fill(0);
    this.colorPixels?.fill(0);
    this.coverageDirty = null;
    this.colorDirty = null;
    this.coverageUsed = null;
    this.colorUsed = null;
    this.bumpGeneration();
  }

  private bumpGeneration(): void {
    this.generationValue += 1;
    this.onReset();
  }

  private allocateTextures(): [
    GPUTexture,
    GPUTextureView,
    GPUTexture,
    GPUTextureView,
  ] {
    const coverage = this.createCoverageTexture();
    let color: GPUTexture | null = null;
    try {
      const coverageView = coverage.createView();
      color = this.colorPixels
        ? this.createColorTexture()
        : this.createPlaceholderColorTexture();
      return [coverage, coverageView, color, color.createView()];
    } catch (error) {
      coverage.destroy();
      color?.destroy();
      throw error;
    }
  }

  private createCoverageTexture(): GPUTexture {
    return this.device.createTexture({
      label: "Terax terminal glyph coverage atlas",
      size: [COVERAGE_ATLAS_SIZE, COVERAGE_ATLAS_SIZE],
      format: "r8unorm",
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  private createColorTexture(): GPUTexture {
    return this.device.createTexture({
      label: "Terax terminal color glyph atlas",
      size: [COLOR_ATLAS_SIZE, COLOR_ATLAS_SIZE],
      format: "rgba8unorm",
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  private createPlaceholderColorTexture(): GPUTexture {
    return this.device.createTexture({
      label: "Terax terminal color glyph placeholder",
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("Glyph atlas is disposed");
  }
}

function createTextureUpload(
  texture: GPUTexture,
  source: Uint8Array,
  atlasWidth: number,
  bytesPerPixel: number,
  dirty: DirtyRectangle,
): TextureUpload {
  const width = dirty.right - dirty.left;
  const height = dirty.bottom - dirty.top;
  const rowBytes = width * bytesPerPixel;
  const bytesPerRow = align(rowBytes, COPY_BYTES_PER_ROW_ALIGNMENT);
  return {
    texture,
    source,
    atlasWidth,
    bytesPerPixel,
    originX: dirty.left,
    originY: dirty.top,
    width,
    height,
    rowBytes,
    bytesPerRow,
    byteLength: bytesPerRow * height,
  };
}

function writeTextureUpload(
  target: Uint8Array,
  targetOffset: number,
  upload: TextureUpload,
): void {
  for (let row = 0; row < upload.height; row += 1) {
    const sourceOffset =
      ((upload.originY + row) * upload.atlasWidth + upload.originX) *
      upload.bytesPerPixel;
    target.set(
      upload.source.subarray(sourceOffset, sourceOffset + upload.rowBytes),
      targetOffset + row * upload.bytesPerRow,
    );
  }
}

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

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function textureBytes(texture: GPUTexture): number {
  return (
    texture.width * texture.height * (texture.format === "r8unorm" ? 1 : 4)
  );
}
