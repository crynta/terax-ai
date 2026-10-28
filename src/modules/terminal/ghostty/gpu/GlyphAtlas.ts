import { isBuiltinGlyph } from "./BuiltinGlyphs";
import { GlyphRasterizer } from "./GlyphRasterizer";
import { SkylineAtlasAllocator } from "./SkylineAtlasAllocator";
import type { TerminalFontMetrics } from "./terminalVisuals";

/** Words per `glyph_table` entry: rect xy, size wh, bearing xy, flags. */
export const GLYPH_ENTRY_WORDS = 4;
const GLYPH_ENTRY_BYTES = GLYPH_ENTRY_WORDS * 4;
export const GLYPH_ENTRY_FLAG_COLOR = 1;
/** Coverage is final (cell-exact shapes): the shader applies no contrast. */
export const GLYPH_ENTRY_FLAG_EXACT = 2;
/** `resolve()` result when nothing more fits even at the largest atlas. */
export const ATLAS_FULL = -1;

const COVERAGE_SIZES = [1_024, 2_048, 4_096] as const;
const COLOR_SIZES = [512, 1_024, 2_048] as const;
const MIN_TABLE_ENTRIES = 1_024;
const MAX_TABLE_ENTRIES = 65_536;

type Retired = {
  readonly resource: { destroy(): void };
  readonly bytes: number;
};

type Plane = {
  readonly format: "r8unorm" | "rgba8unorm";
  readonly sizes: readonly number[];
  step: number;
  texture: GPUTexture;
  view: GPUTextureView;
  readonly allocator: SkylineAtlasAllocator;
};

/**
 * A glyph atlas shared by every surface that uses one font at one device pixel
 * ratio. Pixels live only on the GPU: glyphs are written with `writeTexture`
 * when rasterized and the textures grow 1024^2 -> 2048^2 -> 4096^2 (colour:
 * 512^2 -> 2048^2) by a GPU copy before anything is evicted. When the largest
 * atlas is full the owner calls `flush()` between frames: the epoch advances,
 * every index is invalid, and each surface re-rasterizes what it shows.
 */
export class GlyphAtlas {
  private readonly rasterizer: GlyphRasterizer;
  private coverage: Plane | null = null;
  private color: Plane | null = null;
  private placeholder: GPUTexture | null = null;
  private placeholderView: GPUTextureView | null = null;
  private table: GPUBuffer | null = null;
  private tableData = new Uint32Array(0);
  private tableDirtyStart = Number.POSITIVE_INFINITY;
  private tableDirtyEnd = -1;
  private readonly simple = new Map<number, number>();
  private readonly complex = new Map<string, number>();
  private count = 0;
  private retired: Retired[] = [];
  private retiredBytesValue = 0;
  private epochValue = 1;
  private generationValue = 1;
  private uploadCountValue = 0;
  private uploadedBytesValue = 0;
  private flushCountValue = 0;
  private growthCountValue = 0;
  private capacityFailureCountValue = 0;
  private gpuActive = false;
  private disposed = false;

  constructor(
    private device: GPUDevice,
    readonly metrics: TerminalFontMetrics,
  ) {
    this.rasterizer = new GlyphRasterizer(metrics);
    this.activate();
  }

  /** Increments when every atlas index becomes invalid (flush or resume). */
  get epoch(): number {
    return this.epochValue;
  }

  /** Increments when a texture or the table buffer is replaced (rebind). */
  get generation(): number {
    return this.generationValue;
  }

  get active(): boolean {
    return this.gpuActive && !this.disposed;
  }

  get glyphCount(): number {
    return this.count;
  }

  get coverageTextureView(): GPUTextureView {
    return this.requirePlane(this.coverage).view;
  }

  get colorTextureView(): GPUTextureView {
    return this.color?.view ?? (this.placeholderView as GPUTextureView);
  }

  get tableBuffer(): GPUBuffer {
    if (!this.table) throw new Error("Glyph atlas is not active");
    return this.table;
  }

  get byteSize(): number {
    if (!this.gpuActive || this.disposed) return 0;
    const coverage = this.coverage ? this.coverage.allocator.width ** 2 : 0;
    const color = this.color ? this.color.allocator.width ** 2 * 4 : 4;
    return coverage + color + (this.table?.size ?? 0);
  }

  get cpuByteSize(): number {
    return this.tableData.byteLength + this.rasterizer.cpuBytes;
  }

  get uploadCount(): number {
    return this.uploadCountValue;
  }

  get uploadedBytes(): number {
    return this.uploadedBytesValue;
  }

  get flushCount(): number {
    return this.flushCountValue;
  }

  get growthCount(): number {
    return this.growthCountValue;
  }

  get capacityFailureCount(): number {
    return this.capacityFailureCountValue;
  }

  /** Replaced GPU resources not yet destroyed (waiting for a submission). */
  get retiredBytes(): number {
    return this.retiredBytesValue;
  }

  get coverageSize(): number {
    return this.coverage?.allocator.width ?? 0;
  }

  /**
   * Returns the table index for `text` in `style`, rasterizing on first use.
   * `ATLAS_FULL` means even the largest atlas is exhausted; the caller flushes
   * between frames and tries again.
   */
  resolve(text: string, style: number): number {
    this.assertActive();
    const codepoint = text.codePointAt(0) ?? 0;
    const single = text.length === (codepoint > 0xffff ? 2 : 1);
    // Procedural glyphs ignore bold and italic, so all four styles share one.
    const keyStyle = single && isBuiltinGlyph(codepoint) ? 0 : style & 3;
    const simpleKey = codepoint * 4 + keyStyle;
    const complexKey = single ? "" : `${keyStyle}\u0000${text}`;
    const cached = single
      ? this.simple.get(simpleKey)
      : this.complex.get(complexKey);
    if (cached !== undefined) return cached;
    if (this.count >= MAX_TABLE_ENTRIES) {
      this.capacityFailureCountValue += 1;
      return ATLAS_FULL;
    }

    const glyph = this.rasterizer.rasterize(text, style);
    const plane = glyph.intrinsicColor
      ? (this.color ?? this.createColorPlane())
      : this.requirePlane(this.coverage);
    let region = plane.allocator.allocate(glyph.width, glyph.height);
    while (!region && this.growPlane(plane)) {
      region = plane.allocator.allocate(glyph.width, glyph.height);
    }
    if (!region) {
      this.capacityFailureCountValue += 1;
      return ATLAS_FULL;
    }

    const bytesPerPixel = glyph.intrinsicColor ? 4 : 1;
    this.device.queue.writeTexture(
      { texture: plane.texture, origin: [region.x, region.y, 0] },
      glyph.pixels,
      { bytesPerRow: glyph.width * bytesPerPixel, rowsPerImage: glyph.height },
      [glyph.width, glyph.height, 1],
    );
    this.uploadCountValue += 1;
    this.uploadedBytesValue += glyph.width * glyph.height * bytesPerPixel;

    const index = this.count;
    this.ensureTableCapacity(index + 1);
    const base = index * GLYPH_ENTRY_WORDS;
    this.tableData[base] = region.x | (region.y << 16);
    this.tableData[base + 1] = glyph.width | (glyph.height << 16);
    this.tableData[base + 2] =
      (glyph.bearingX & 0xffff) | ((glyph.bearingY & 0xffff) << 16);
    this.tableData[base + 3] =
      (glyph.intrinsicColor ? GLYPH_ENTRY_FLAG_COLOR : 0) |
      (glyph.exact ? GLYPH_ENTRY_FLAG_EXACT : 0);
    this.tableDirtyStart = Math.min(this.tableDirtyStart, index);
    this.tableDirtyEnd = Math.max(this.tableDirtyEnd, index);
    this.count += 1;
    if (single) this.simple.set(simpleKey, index);
    else this.complex.set(complexKey, index);
    return index;
  }

  /** Uploads table entries written since the last commit. */
  commit(): void {
    if (this.tableDirtyEnd < 0 || !this.table) return;
    const start = this.tableDirtyStart * GLYPH_ENTRY_WORDS;
    const end = (this.tableDirtyEnd + 1) * GLYPH_ENTRY_WORDS;
    this.device.queue.writeBuffer(
      this.table,
      start * 4,
      this.tableData,
      start,
      end - start,
    );
    this.uploadCountValue += 1;
    this.uploadedBytesValue += (end - start) * 4;
    this.tableDirtyStart = Number.POSITIVE_INFINITY;
    this.tableDirtyEnd = -1;
  }

  /**
   * Starts a new epoch: all indices are invalid and the full atlas area is
   * free again. Texture sizes are kept; stale pixels are overwritten as
   * glyphs claim their regions. Call only between frames, never while a
   * surface has already encoded draws that read the old indices.
   */
  flush(): void {
    this.assertActive();
    this.coverage?.allocator.reset();
    this.color?.allocator.reset();
    this.simple.clear();
    this.complex.clear();
    this.count = 0;
    this.tableDirtyStart = Number.POSITIVE_INFINITY;
    this.tableDirtyEnd = -1;
    this.flushCountValue += 1;
    this.epochValue += 1;
  }

  /**
   * Retired textures and buffers may still be referenced by commands recorded
   * this frame. Destroy them once the frame's submission has completed, or at
   * once when nothing was submitted.
   */
  releaseRetired(completion: Promise<unknown> | null): void {
    if (this.retired.length === 0) return;
    const resources = this.retired;
    this.retired = [];
    const destroy = () => {
      for (const { resource, bytes } of resources) {
        resource.destroy();
        this.retiredBytesValue = Math.max(0, this.retiredBytesValue - bytes);
      }
    };
    if (!completion) destroy();
    else void completion.then(destroy, destroy);
  }

  get hasRetired(): boolean {
    return this.retired.length > 0;
  }

  suspend(): void {
    if (this.disposed || !this.gpuActive) return;
    this.gpuActive = false;
    this.destroyGpu();
    this.rasterizer.dispose();
    this.simple.clear();
    this.complex.clear();
    this.count = 0;
    this.tableData = new Uint32Array(0);
    this.tableDirtyStart = Number.POSITIVE_INFINITY;
    this.tableDirtyEnd = -1;
    this.epochValue += 1;
  }

  resume(device: GPUDevice): void {
    this.assertLive();
    if (this.gpuActive && this.device === device) return;
    this.suspend();
    this.device = device;
    this.activate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.suspend();
    this.disposed = true;
  }

  private activate(): void {
    const coverage = this.createPlane("r8unorm", COVERAGE_SIZES, "coverage");
    this.coverage = coverage;
    try {
      this.placeholder = this.device.createTexture({
        label: "Terax terminal color glyph placeholder",
        size: [1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.placeholderView = this.placeholder.createView();
      this.tableData = new Uint32Array(MIN_TABLE_ENTRIES * GLYPH_ENTRY_WORDS);
      this.table = this.createTable(MIN_TABLE_ENTRIES);
    } catch (error) {
      this.destroyGpu();
      throw error;
    }
    this.gpuActive = true;
    this.generationValue += 1;
  }

  private destroyGpu(): void {
    this.coverage?.texture.destroy();
    this.color?.texture.destroy();
    this.placeholder?.destroy();
    this.table?.destroy();
    for (const { resource, bytes } of this.retired) {
      resource.destroy();
      this.retiredBytesValue = Math.max(0, this.retiredBytesValue - bytes);
    }
    this.retired = [];
    this.coverage = null;
    this.color = null;
    this.placeholder = null;
    this.placeholderView = null;
    this.table = null;
  }

  private createPlane(
    format: Plane["format"],
    allSizes: readonly number[],
    label: string,
  ): Plane {
    const limit = this.device.limits?.maxTextureDimension2D ?? 8_192;
    const sizes = allSizes.filter((size) => size <= limit);
    const size = sizes[0] ?? allSizes[0];
    const texture = this.device.createTexture({
      label: `Terax terminal glyph ${label} atlas`,
      size: [size, size],
      format,
      usage:
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.TEXTURE_BINDING,
    });
    try {
      return {
        format,
        sizes: sizes.length > 0 ? sizes : [size],
        step: 0,
        texture,
        view: texture.createView(),
        allocator: new SkylineAtlasAllocator(size, size),
      };
    } catch (error) {
      texture.destroy();
      throw error;
    }
  }

  private createColorPlane(): Plane {
    const plane = this.createPlane("rgba8unorm", COLOR_SIZES, "color");
    this.color = plane;
    this.generationValue += 1;
    return plane;
  }

  private growPlane(plane: Plane): boolean {
    if (plane.step + 1 >= plane.sizes.length) return false;
    const previousSize = plane.allocator.width;
    const size = plane.sizes[plane.step + 1];
    const texture = this.device.createTexture({
      label: `Terax terminal glyph ${plane.format === "r8unorm" ? "coverage" : "color"} atlas`,
      size: [size, size],
      format: plane.format,
      usage:
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.TEXTURE_BINDING,
    });
    let view: GPUTextureView;
    try {
      view = texture.createView();
      // Submitted on its own so it runs after every earlier writeTexture and
      // before any glyph written into the larger texture afterwards.
      const encoder = this.device.createCommandEncoder({
        label: "Terax terminal glyph atlas growth",
      });
      encoder.copyTextureToTexture({ texture: plane.texture }, { texture }, [
        previousSize,
        previousSize,
        1,
      ]);
      this.device.queue.submit([encoder.finish()]);
    } catch (error) {
      texture.destroy();
      throw error;
    }
    this.retire(
      plane.texture,
      previousSize * previousSize * bytesPerTexel(plane),
    );
    plane.texture = texture;
    plane.view = view;
    plane.step += 1;
    plane.allocator.grow(size, size);
    this.growthCountValue += 1;
    this.generationValue += 1;
    return true;
  }

  private createTable(entries: number): GPUBuffer {
    return this.device.createBuffer({
      label: "Terax terminal glyph table",
      size: entries * GLYPH_ENTRY_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  private ensureTableCapacity(entries: number): void {
    const capacity = this.tableData.length / GLYPH_ENTRY_WORDS;
    if (entries <= capacity) return;
    let next = capacity;
    while (next < entries) next *= 2;
    const data = new Uint32Array(next * GLYPH_ENTRY_WORDS);
    data.set(this.tableData);
    const table = this.createTable(next);
    if (this.table) this.retire(this.table, this.table.size);
    this.table = table;
    this.tableData = data;
    // The replacement starts empty: everything written so far is dirty.
    this.tableDirtyStart = 0;
    this.tableDirtyEnd = Math.max(this.tableDirtyEnd, entries - 1);
    this.generationValue += 1;
  }

  private retire(resource: { destroy(): void }, bytes: number): void {
    this.retired.push({ resource, bytes });
    this.retiredBytesValue += bytes;
  }

  private requirePlane(plane: Plane | null): Plane {
    if (!plane) throw new Error("Glyph atlas is not active");
    return plane;
  }

  private assertActive(): void {
    this.assertLive();
    if (!this.gpuActive) throw new Error("Glyph atlas is suspended");
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("Glyph atlas is disposed");
  }
}

function bytesPerTexel(plane: Plane): number {
  return plane.format === "r8unorm" ? 1 : 4;
}
