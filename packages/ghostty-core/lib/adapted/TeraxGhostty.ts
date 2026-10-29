import type {
  TeraxGhosttyGpuRenderState,
  TeraxGhosttyLine,
  TeraxGhosttyLoadOptions,
  TeraxGhosttyKeyEvent,
  TeraxGhosttyMemoryStats,
  TeraxGhosttyRenderBase,
  TeraxGhosttyRenderFormat,
  TeraxGhosttyRenderState,
  TeraxGhosttySearchStatus,
  TeraxGhosttySearchViewportSpan,
  TeraxGhosttySelection,
  TeraxGhosttyTerminalOptions,
  TeraxGhosttyTerminalResourceStats,
  TeraxGhosttyWasmExports,
  TypedArray,
  TypedArrayConstructor,
  ViewCacheEntry,
} from "./types";
import { GPU_CELL_BYTES, GPU_CELL_WORDS } from "./gpuCells";
import { GpuGlyphBatch } from "./gpuGlyphs";
import { createViewCacheEntry, getCachedView } from "./viewCache";
import type { GhosttyTerminalEvent } from "../types";

export const ADAPTED_GHOSTTY_COMMIT =
  "ad97d331459a0762f7aea5f56fe86748e03b860f";
export const ADAPTED_RESTTY_COMMIT =
  "7700b14a7643ba9240818209ef1e0aa90d83ad77";
export const ADAPTED_GHOSTTY_WASM_SHA256 =
  "302b7952e0f84d1701b64a4348f597bbe5ab2bc1f2b58c12d6cf775251a895f7";

export const ADAPTED_GHOSTTY_SCALAR_WASM_SHA256 =
  "c9cffe386b771bd1a76b493bf064b30abb30fd5ef3d36d700226b318309c1cad";

let wasmSimdAvailable: boolean | undefined;

export function supportsWasmSimd(): boolean {
  if (wasmSimdAvailable !== undefined) return wasmSimdAvailable;
  try {
    wasmSimdAvailable = WebAssembly.validate(Uint8Array.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60,
      0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x08, 0x01, 0x06, 0x00,
      0x41, 0x00, 0xfd, 0x0f, 0x0b,
    ]));
  } catch {
    wasmSimdAvailable = false;
  }
  return wasmSimdAvailable;
}

const DEFAULT_SCROLLBACK_BYTES = 8 * 1024 * 1024;
const MAX_SCROLLBACK_BYTES = 64 * 1024 * 1024;
const DEFAULT_SCROLLBACK_LINES = 10_000;
const MAX_SCROLLBACK_LINES = 100_000;
const REUSABLE_INPUT_LIMIT = 64 * 1024;
const INPUT_CAPACITY_ALIGNMENT = 4 * 1024;
const MAX_SEARCH_QUERY_BYTES = 4 * 1024;
const MAX_DIMENSION = 4_096;
const MAX_CELLS = 1_048_576;
const CURSOR_BYTES = 16;
const EVENT_HEADER_BYTES = 5;
const SEARCH_STATUS_BYTES = 16;
const SEARCH_VIEWPORT_SPAN_BYTES = 8;
const MAX_EVENT_PAYLOAD_BYTES = 256 * 1024;
const LINE_CHUNK_LINES = 64;
const RECLAIM_DELAY_MS = 250;

const requiredExports = [
  "memory",
  "restty_create_with_limits",
  "restty_destroy",
  "restty_set_scrollback_limits",
  "restty_scrollback_page_bytes",
  "restty_write",
  "restty_resize",
  "restty_set_pixel_size",
  "restty_render_update",
  "restty_render_release",
  "restty_render_compact",
  "restty_cell_capacity",
  "restty_row_capacity",
  "restty_render_reset_count",
  "restty_alloc",
  "restty_free",
  "restty_output_ptr",
  "restty_output_len",
  "restty_output_consume",
  "restty_events_ptr",
  "restty_events_len",
  "restty_events_consume",
  "restty_take_dropped_events",
  "restty_scroll_viewport",
  "restty_scroll_viewport_to",
  "restty_scrollbar_total",
  "restty_scrollbar_offset",
  "restty_scrollbar_len",
  "restty_active_cursor_y",
  "restty_selection_set",
  "restty_semantic_markers_enable",
  "restty_semantic_marker_line",
  "restty_semantic_marker_column",
  "restty_semantic_marker_count",
  "restty_text_range_prepare",
  "restty_selection_clear",
  "restty_selection_active",
  "restty_selection_start_line",
  "restty_selection_start_col",
  "restty_selection_end_line",
  "restty_selection_end_col",
  "restty_selection_rectangular",
  "restty_selection_text_prepare",
  "restty_selection_text_ptr",
  "restty_selection_text_len",
  "restty_set_default_colors",
  "restty_set_palette",
  "restty_reset_palette",
  "restty_mode",
  "restty_mode_bits",
  "restty_set_cursor_options",
  "restty_encode_key",
  "restty_key_output_ptr",
  "restty_key_output_len",
  "restty_search_set_query",
  "restty_search_clear",
  "restty_search_step",
  "restty_search_status_ptr",
  "restty_search_viewport_match_count",
  "restty_search_viewport_matches_ptr",
  "restty_search_select_next",
  "restty_search_select_prev",
  "restty_rows",
  "restty_cols",
  "restty_cell_codepoints_ptr",
  "restty_cell_content_tags_ptr",
  "restty_cell_wide_ptr",
  "restty_cell_flags_ptr",
  "restty_cell_style_flags_ptr",
  "restty_cell_underline_styles_ptr",
  "restty_cell_link_ids_ptr",
  "restty_cell_fg_rgba_ptr",
  "restty_cell_bg_rgba_ptr",
  "restty_cell_ul_rgba_ptr",
  "restty_cell_grapheme_offsets_ptr",
  "restty_cell_grapheme_lengths_ptr",
  "restty_grapheme_buffer_ptr",
  "restty_grapheme_buffer_len",
  "restty_row_selection_start_ptr",
  "restty_row_selection_end_ptr",
  "restty_row_wrapped_ptr",
  "restty_row_dirty_ptr",
  "restty_damage_full",
  "restty_cursor_info_ptr",
  "restty_link_offsets_ptr",
  "restty_link_lengths_ptr",
  "restty_link_buffer_ptr",
  "restty_link_count",
  "restty_link_buffer_len",
  "restty_set_render_format",
  "restty_render_format",
  "restty_gpu_cell_stride",
  "restty_gpu_cells_ptr",
  "restty_gpu_any_dirty",
  "restty_gpu_epoch",
  "restty_gpu_blinking_cells",
  "restty_gpu_glyph_count",
  "restty_gpu_glyph_overflow",
  "restty_gpu_new_glyphs_ptr",
  "restty_gpu_new_glyphs_len",
  "restty_gpu_glyphs_ack",
  "restty_gpu_glyphs_ptr",
  "restty_gpu_glyphs_len",
  "restty_line_cells_prepare",
  "restty_line_cells_ptr",
  "restty_line_cells_len",
  "restty_line_cells_release",
] as const;

const textDecoder = new TextDecoder();
const emptyBytes = new Uint8Array(0);
const emptyUint32 = new Uint32Array(0);
const emptyEvents: GhosttyTerminalEvent[] = [];

type RenderViewCache = {
  readonly codepoints: ViewCacheEntry<Uint32Array>;
  readonly contentTags: ViewCacheEntry<Uint8Array>;
  readonly widths: ViewCacheEntry<Uint8Array>;
  readonly cellFlags: ViewCacheEntry<Uint16Array>;
  readonly styleFlags: ViewCacheEntry<Uint16Array>;
  readonly underlineStyles: ViewCacheEntry<Uint8Array>;
  readonly linkIds: ViewCacheEntry<Uint32Array>;
  readonly foregroundRgba: ViewCacheEntry<Uint8Array>;
  readonly backgroundRgba: ViewCacheEntry<Uint8Array>;
  readonly underlineRgba: ViewCacheEntry<Uint8Array>;
  readonly graphemeOffsets: ViewCacheEntry<Uint32Array>;
  readonly graphemeLengths: ViewCacheEntry<Uint32Array>;
  readonly graphemeCodepoints: ViewCacheEntry<Uint32Array>;
  readonly selectionStarts: ViewCacheEntry<Int16Array>;
  readonly selectionEnds: ViewCacheEntry<Int16Array>;
  readonly rowWrapped: ViewCacheEntry<Uint8Array>;
  readonly dirtyRows: ViewCacheEntry<Uint8Array>;
  readonly linkOffsets: ViewCacheEntry<Uint32Array>;
  readonly linkLengths: ViewCacheEntry<Uint32Array>;
  readonly linkBytes: ViewCacheEntry<Uint8Array>;
  readonly gpuCells: ViewCacheEntry<Uint8Array>;
  readonly gpuCellWords: ViewCacheEntry<Uint32Array>;
  readonly gpuNewGlyphs: ViewCacheEntry<Uint32Array>;
  readonly gpuAllGlyphs: ViewCacheEntry<Uint32Array>;
};

/**
 * A compiled Ghostty module. The module is compiled once and every terminal
 * gets its own instance, hence its own linear memory: WebAssembly memory can
 * grow but never shrink, so a private memory is the only way a closed terminal
 * returns its scrollback to the operating system. Instantiating the compiled
 * module is synchronous and takes about a millisecond or less.
 */
export class TeraxGhostty {
  private readonly live = new Set<TeraxGhosttyInstance>();
  private created = 0;
  private reclaimBytes = 0;
  private reclaimTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    private readonly module: WebAssembly.Module,
    private readonly options: TeraxGhosttyLoadOptions,
  ) {}

  static async load(
    wasmPath?: string,
    options: TeraxGhosttyLoadOptions = {},
  ): Promise<TeraxGhostty> {
    const path =
      wasmPath ?? (supportsWasmSimd()
        ? new URL("../../adapted/ghostty-vt.wasm", import.meta.url).href
        : new URL("../../adapted/ghostty-vt-scalar.wasm", import.meta.url).href);
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch adapted Ghostty WASM: ${response.status} ${response.statusText}`,
      );
    }

    const fallback = response.clone();
    let module: WebAssembly.Module;
    try {
      module = await WebAssembly.compileStreaming(response);
    } catch {
      module = await compileBytes(await fallback.arrayBuffer());
    }
    return TeraxGhostty.fromModule(module, options);
  }

  static async loadBytes(
    bytes: ArrayBuffer,
    options: TeraxGhosttyLoadOptions = {},
  ): Promise<TeraxGhostty> {
    return TeraxGhostty.fromModule(await compileBytes(bytes), options);
  }

  static fromModule(
    module: WebAssembly.Module,
    options: TeraxGhosttyLoadOptions = {},
  ): TeraxGhostty {
    const available = new Set(
      WebAssembly.Module.exports(module).map((entry) => entry.name),
    );
    for (const name of requiredExports) {
      if (!available.has(name)) {
        throw new Error(`Missing adapted Ghostty WASM export: ${name}`);
      }
    }
    return new TeraxGhostty(module, options);
  }

  /** The shared compiled module that every instance is created from. */
  get compiledModule(): WebAssembly.Module {
    return this.module;
  }

  /**
   * A fresh instance with its own linear memory and no terminal. Dispose it to
   * drop the memory; terminals created on it share that memory.
   */
  instantiate(): TeraxGhosttyInstance {
    const holder: MemoryHolder = { current: null };
    const instantiate = this.options.instantiate ?? defaultInstantiate;
    const raw = instantiate(this.module, createImports(holder, this.options));
    const exports = raw.exports as TeraxGhosttyWasmExports;
    if (!(exports.memory instanceof WebAssembly.Memory)) {
      throw new Error("Adapted Ghostty WASM does not export its memory");
    }
    holder.current = exports.memory;
    const instance = new TeraxGhosttyInstance(this, exports, holder);
    this.live.add(instance);
    this.created += 1;
    return instance;
  }

  /**
   * A terminal in a private instance. Disposing the terminal disposes the
   * instance, so nothing of it survives once the caller drops its references.
   */
  createTerminal(
    cols: number,
    rows: number,
    options: TeraxGhosttyTerminalOptions = {},
  ): TeraxGhosttyTerminal {
    validateDimensions(cols, rows);
    const instance = this.instantiate();
    try {
      return new TeraxGhosttyTerminal(instance, cols, rows, options, true);
    } catch (error) {
      instance.dispose();
      throw error;
    }
  }

  /** Linear memory of every live instance, in bytes. */
  getMemoryBytes(): number {
    let total = 0;
    for (const instance of this.live) total += instance.memoryBytes;
    return total;
  }

  memoryStats(): TeraxGhosttyMemoryStats {
    const instanceBytes: number[] = [];
    let totalBytes = 0;
    for (const instance of this.live) {
      const bytes = instance.memoryBytes;
      instanceBytes.push(bytes);
      totalBytes += bytes;
    }
    return {
      instanceCount: instanceBytes.length,
      totalBytes,
      instanceBytes,
      instancesCreated: this.created,
    };
  }

  /** @internal Called by `TeraxGhosttyInstance.dispose`. */
  releaseInstance(instance: TeraxGhosttyInstance, bytes: number): void {
    this.live.delete(instance);
    this.scheduleReclaim(bytes);
  }

  private scheduleReclaim(bytes: number): void {
    const reclaim =
      this.options.reclaim === undefined
        ? hintGarbageCollection
        : this.options.reclaim;
    if (reclaim === null || bytes <= 0) return;
    this.reclaimBytes += bytes;
    if (this.reclaimTimer !== null) return;
    this.reclaimTimer = setTimeout(() => {
      const pending = this.reclaimBytes;
      this.reclaimBytes = 0;
      this.reclaimTimer = null;
      reclaim(pending);
    }, this.options.reclaimDelayMs ?? RECLAIM_DELAY_MS);
    unrefTimer(this.reclaimTimer);
  }
}

type MemoryHolder = { current: WebAssembly.Memory | null };

/**
 * One WebAssembly instance and its linear memory. Dropping every reference to
 * a disposed instance lets the engine free the memory.
 */
export class TeraxGhosttyInstance {
  private liveExports: TeraxGhosttyWasmExports | null;
  private owner: TeraxGhostty | null;
  private holder: MemoryHolder | null;
  private readonly terminals = new Set<TeraxGhosttyTerminal>();

  constructor(
    owner: TeraxGhostty,
    exports: TeraxGhosttyWasmExports,
    holder: MemoryHolder,
  ) {
    this.owner = owner;
    this.liveExports = exports;
    this.holder = holder;
  }

  get disposed(): boolean {
    return this.liveExports === null;
  }

  get exports(): TeraxGhosttyWasmExports {
    if (!this.liveExports) {
      throw new Error("Adapted Ghostty instance has been disposed");
    }
    return this.liveExports;
  }

  /** `memory.buffer.byteLength`, or 0 once disposed. */
  get memoryBytes(): number {
    return this.liveExports ? this.liveExports.memory.buffer.byteLength : 0;
  }

  /** A terminal that shares this instance's linear memory. */
  createTerminal(
    cols: number,
    rows: number,
    options: TeraxGhosttyTerminalOptions = {},
  ): TeraxGhosttyTerminal {
    return new TeraxGhosttyTerminal(this, cols, rows, options, false);
  }

  /** @internal */
  register(terminal: TeraxGhosttyTerminal): void {
    this.terminals.add(terminal);
  }

  /** @internal */
  forget(terminal: TeraxGhosttyTerminal): void {
    this.terminals.delete(terminal);
  }

  /**
   * Invalidates every terminal of the instance and drops its memory. No WASM
   * code runs: the whole linear memory is released at once. Views that outlive
   * the instance are detached and read as empty, but V8 keeps a memory alive
   * while any view of it exists, so callers must not retain them.
   */
  dispose(): void {
    const exports = this.liveExports;
    if (!exports) return;
    const bytes = exports.memory.buffer.byteLength;
    this.liveExports = null;
    for (const terminal of [...this.terminals]) terminal.invalidate();
    this.terminals.clear();
    if (this.holder) this.holder.current = null;
    this.holder = null;
    detachMemoryViews(exports.memory);
    this.owner?.releaseInstance(this, bytes);
    this.owner = null;
  }
}

export class TeraxGhosttyTerminal {
  private readonly cache: RenderViewCache = createRenderViewCache();
  private readonly handle: number;
  private exports: TeraxGhosttyWasmExports;
  private memory: WebAssembly.Memory;
  private instance: TeraxGhosttyInstance;
  private readonly ownsInstance: boolean;
  private inputPointer = 0;
  private inputCapacity = 0;
  private readonly textEncoder = new TextEncoder();
  private format: TeraxGhosttyRenderFormat = "soa";
  private disposed = false;

  constructor(
    instance: TeraxGhosttyInstance,
    cols: number,
    rows: number,
    options: TeraxGhosttyTerminalOptions,
    ownsInstance: boolean,
  ) {
    validateDimensions(cols, rows);
    const maxScrollbackBytes = normalizeLimit(
      options.maxScrollbackBytes,
      DEFAULT_SCROLLBACK_BYTES,
      MAX_SCROLLBACK_BYTES,
    );
    const maxScrollbackLines = normalizeLimit(
      options.maxScrollbackLines,
      DEFAULT_SCROLLBACK_LINES,
      MAX_SCROLLBACK_LINES,
    );
    this.instance = instance;
    this.ownsInstance = ownsInstance;
    this.exports = instance.exports;
    this.memory = this.exports.memory;
    this.handle = this.exports.restty_create_with_limits(
      cols,
      rows,
      maxScrollbackBytes,
      maxScrollbackLines,
    );
    if (!this.handle) {
      throw new Error("Failed to create adapted Ghostty terminal");
    }
    instance.register(this);
  }

  get cols(): number {
    this.assertLive();
    return this.exports.restty_cols(this.handle);
  }

  get rows(): number {
    this.assertLive();
    return this.exports.restty_rows(this.handle);
  }

  write(bytes: Uint8Array): void {
    this.assertLive();
    if (bytes.byteLength === 0) return;

    if (bytes.byteLength > REUSABLE_INPUT_LIMIT) {
      const pointer = this.allocate(bytes.byteLength);
      try {
        new Uint8Array(this.memory.buffer, pointer, bytes.byteLength).set(bytes);
        checkResult(
          this.exports.restty_write(this.handle, pointer, bytes.byteLength),
          "write",
        );
      } finally {
        this.exports.restty_free(pointer, bytes.byteLength);
      }
      return;
    }

    this.ensureInputCapacity(bytes.byteLength);
    new Uint8Array(
      this.memory.buffer,
      this.inputPointer,
      bytes.byteLength,
    ).set(bytes);
    checkResult(
      this.exports.restty_write(
        this.handle,
        this.inputPointer,
        bytes.byteLength,
      ),
      "write",
    );
  }

  resize(cols: number, rows: number): void {
    this.assertLive();
    validateDimensions(cols, rows);
    checkResult(
      this.exports.restty_resize(this.handle, cols, rows),
      "resize",
    );
  }

  setPixelSize(widthPx: number, heightPx: number): void {
    this.assertLive();
    const width = clampInteger(widthPx, 0, 0xffff_ffff);
    const height = clampInteger(heightPx, 0, 0xffff_ffff);
    checkResult(
      this.exports.restty_set_pixel_size(this.handle, width, height),
      "set pixel size",
    );
  }

  /**
   * The linear memory this terminal lives in. `memory.buffer` is replaced (and
   * the old buffer detached) whenever the memory grows; read it again after any
   * call that can allocate. Do not retain it past `dispose()`.
   */
  get wasmMemory(): WebAssembly.Memory {
    this.assertLive();
    return this.memory;
  }

  /** Linear memory of the instance this terminal lives in, in bytes. */
  get instanceMemoryBytes(): number {
    this.assertLive();
    return this.memory.buffer.byteLength;
  }

  /**
   * Bytes of page memory the primary screen holds (scrollback plus the active
   * area). A byte limit below this prunes history; at or above it does not.
   */
  scrollbackPageBytes(): number {
    this.assertLive();
    return this.exports.restty_scrollback_page_bytes(this.handle);
  }

  /**
   * Changes the primary-screen scrollback limits. Lowering prunes complete
   * historical pages immediately; raising only permits growth.
   */
  setScrollbackLimits(maxBytes: number, maxLines: number): void {
    this.assertLive();
    checkResult(
      this.exports.restty_set_scrollback_limits(
        this.handle,
        clampInteger(maxBytes, 1, MAX_SCROLLBACK_BYTES),
        clampInteger(maxLines, 1, MAX_SCROLLBACK_LINES),
      ),
      "set scrollback limits",
    );
  }

  /** The cell format written by the next update. New terminals use `"soa"`. */
  get renderFormat(): TeraxGhosttyRenderFormat {
    return this.format;
  }

  /**
   * Selects the per-cell format. Switching releases the previous format's
   * buffers, invalidates every borrowed view and forces full damage on the
   * next update (and a new glyph epoch when leaving the GPU format).
   */
  setRenderFormat(format: TeraxGhosttyRenderFormat): void {
    this.assertLive();
    if (format === this.format) return;
    checkResult(
      this.exports.restty_set_render_format(
        this.handle,
        format === "gpu" ? 1 : 0,
      ),
      "set render format",
    );
    this.format = format;
  }

  updateRenderState(): TeraxGhosttyRenderState {
    this.assertLive();
    this.assertFormat("soa", "updateRenderState");
    checkResult(
      this.exports.restty_render_update(this.handle),
      "update render state",
    );
    return this.readRenderState();
  }

  /**
   * Updates the render state in the GPU format: one 16-byte record per cell
   * (see `gpuCells.ts`), exact per-row dirtiness and interned glyph ids. The
   * terminal must be in the `"gpu"` format (`setRenderFormat`).
   */
  updateGpuRenderState(): TeraxGhosttyGpuRenderState {
    this.assertLive();
    this.assertFormat("gpu", "updateGpuRenderState");
    checkResult(
      this.exports.restty_render_update(this.handle),
      "update GPU render state",
    );
    return this.readGpuRenderState();
  }

  /**
   * Glyphs interned since the last `acknowledgeGpuGlyphs()`, read now (the
   * `newGlyphs` of an earlier state is a snapshot taken at its update).
   * Borrowed; valid until the next call that can allocate.
   */
  pendingGpuGlyphs(): GpuGlyphBatch {
    this.assertLive();
    return new GpuGlyphBatch(
      this.optionalView(
        this.cache.gpuNewGlyphs,
        this.exports.restty_gpu_new_glyphs_ptr(this.handle),
        this.exports.restty_gpu_new_glyphs_len(this.handle),
        Uint32Array,
        emptyUint32,
      ),
    );
  }

  /** Marks every glyph delivered by `newGlyphs` so far as consumed. */
  acknowledgeGpuGlyphs(): void {
    this.assertLive();
    this.exports.restty_gpu_glyphs_ack(this.handle);
  }

  /**
   * The complete glyph table of the current epoch, for rebuilding an id map
   * (for example after a renderer is attached to an already-running terminal).
   * Borrowed; valid until the next call that can allocate.
   */
  gpuGlyphTable(): GpuGlyphBatch {
    this.assertLive();
    const length = this.exports.restty_gpu_glyphs_len(this.handle);
    return new GpuGlyphBatch(
      this.optionalView(
        this.cache.gpuAllGlyphs,
        this.exports.restty_gpu_glyphs_ptr(this.handle),
        length,
        Uint32Array,
        emptyUint32,
      ),
    );
  }

  /**
   * Reads buffer lines `firstLine..lastLine` (absolute, scrollback included)
   * straight from the screen: the viewport and the render state are left
   * untouched, in either render format. Lines past the end are omitted.
   */
  readLines(firstLine: number, lastLine: number): TeraxGhosttyLine[] {
    this.assertLive();
    if (
      !Number.isSafeInteger(firstLine) ||
      !Number.isSafeInteger(lastLine) ||
      firstLine < 0 ||
      lastLine < firstLine
    ) {
      return [];
    }
    const cols = this.cols;
    const lines: TeraxGhosttyLine[] = [];
    const total = this.scrollbar().total;
    const last = Math.min(lastLine, total - 1);
    for (let first = firstLine; first <= last; first += LINE_CHUNK_LINES) {
      const chunkLast = Math.min(last, first + LINE_CHUNK_LINES - 1);
      checkResult(
        this.exports.restty_line_cells_prepare(this.handle, first, chunkLast),
        "read buffer lines",
      );
      const length = this.exports.restty_line_cells_len(this.handle);
      try {
        if (length === 0) continue;
        const pointer = this.exports.restty_line_cells_ptr(this.handle);
        validateRange(this.memory.buffer, pointer, length * 4);
        decodeLines(
          new Uint32Array(this.memory.buffer, pointer, length),
          cols,
          lines,
        );
      } finally {
        this.exports.restty_line_cells_release(this.handle);
      }
    }
    return lines;
  }

  releaseRenderState(): void {
    this.assertLive();
    this.exports.restty_render_release(this.handle);
  }

  compactRenderState(): void {
    this.assertLive();
    checkResult(
      this.exports.restty_render_compact(this.handle),
      "compact render state",
    );
  }

  resourceStats(): TeraxGhosttyTerminalResourceStats {
    this.assertLive();
    return {
      cellCapacity: this.exports.restty_cell_capacity(this.handle),
      rowCapacity: this.exports.restty_row_capacity(this.handle),
      renderStateResets: this.exports.restty_render_reset_count(this.handle),
      renderFormat: this.format,
      glyphCount: this.exports.restty_gpu_glyph_count(this.handle),
      glyphEpoch: this.exports.restty_gpu_epoch(this.handle),
    };
  }

  drainOutputBytes(): Uint8Array {
    this.assertLive();
    const length = this.exports.restty_output_len(this.handle);
    if (length === 0) return emptyBytes;
    const pointer = this.exports.restty_output_ptr(this.handle);
    validateRange(this.memory.buffer, pointer, length);
    const result = new Uint8Array(length);
    result.set(new Uint8Array(this.memory.buffer, pointer, length));
    checkResult(
      this.exports.restty_output_consume(this.handle, length),
      "consume terminal output",
    );
    return result;
  }

  drainEvents(): GhosttyTerminalEvent[] {
    this.assertLive();
    const length = this.exports.restty_events_len(this.handle);
    if (length === 0) {
      const dropped = this.exports.restty_take_dropped_events(this.handle);
      return dropped > 0 ? [{ type: "overflow", dropped }] : emptyEvents;
    }

    const events: GhosttyTerminalEvent[] = [];
    const pointer = this.exports.restty_events_ptr(this.handle);
    validateRange(this.memory.buffer, pointer, length);
    const bytes = new Uint8Array(this.memory.buffer, pointer, length);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    try {
      while (offset < bytes.byteLength) {
        if (bytes.byteLength - offset < EVENT_HEADER_BYTES) {
          throw new Error("Truncated Ghostty semantic event header");
        }
        const type = bytes[offset];
        const payloadLength = view.getUint32(offset + 1, true);
        offset += EVENT_HEADER_BYTES;
        if (
          payloadLength > MAX_EVENT_PAYLOAD_BYTES ||
          offset + payloadLength > bytes.byteLength
        ) {
          throw new Error("Invalid Ghostty semantic event payload");
        }
        const event = decodeTerminalEvent(
          type,
          bytes.subarray(offset, offset + payloadLength),
        );
        if (event) events.push(event);
        offset += payloadLength;
      }
    } finally {
      checkResult(
        this.exports.restty_events_consume(this.handle, length),
        "consume semantic events",
      );
    }
    const dropped = this.exports.restty_take_dropped_events(this.handle);
    if (dropped > 0) events.push({ type: "overflow", dropped });
    return events;
  }

  enableSemanticMarkers(enabled: boolean): void {
    this.assertLive();
    this.exports.restty_semantic_markers_enable(this.handle, Number(enabled));
  }

  semanticMarkerLine(id: number): number | null {
    this.assertLive();
    if (!Number.isInteger(id) || id <= 0 || id > 0xffff_ffff) return null;
    const line = this.exports.restty_semantic_marker_line(this.handle, id);
    return line < 0 ? null : line;
  }

  bufferCursorLine(): number {
    this.assertLive();
    const bar = this.scrollbar();
    return bar.total - bar.length + this.exports.restty_active_cursor_y(this.handle);
  }

  semanticMarkerColumn(id: number): number | null {
    this.assertLive();
    if (!Number.isInteger(id) || id <= 0 || id > 0xffff_ffff) return null;
    const column = this.exports.restty_semantic_marker_column(this.handle, id);
    return column < 0 ? null : column;
  }

  semanticMarkerCount(): number {
    this.assertLive();
    return this.exports.restty_semantic_marker_count(this.handle);
  }

  readTextRange(startLine: number, endLine: number, startCol = 0, endCol = this.cols - 1): string {
    this.assertLive();
    const total = this.scrollbar().total;
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 0 || endLine < startLine || startLine >= total) return "";
    checkResult(this.exports.restty_text_range_prepare(this.handle, startLine, clampInteger(startCol, 0, this.cols - 1), Math.min(total - 1, endLine), clampInteger(endCol, 0, this.cols - 1)), "read terminal text range");
    const length = this.exports.restty_selection_text_len(this.handle);
    const pointer = this.exports.restty_selection_text_ptr(this.handle);
    validateRange(this.memory.buffer, pointer, length);
    return textDecoder.decode(new Uint8Array(this.memory.buffer, pointer, length));
  }

  scrollViewport(deltaRows: number): void {
    this.assertLive();
    const delta = clampInteger(deltaRows, -0x7fff_ffff, 0x7fff_ffff);
    checkResult(
      this.exports.restty_scroll_viewport(this.handle, delta),
      "scroll viewport",
    );
  }

  scrollViewportTo(row: number): void {
    this.assertLive();
    const target = clampInteger(row, 0, 0xffff_ffff);
    checkResult(
      this.exports.restty_scroll_viewport_to(this.handle, target),
      "scroll viewport to row",
    );
  }

  mode(value: number, ansi = false): boolean {
    this.assertLive();
    return (
      this.exports.restty_mode(
        this.handle,
        clampInteger(value, 0, 0xffff),
        ansi ? 1 : 0,
      ) !== 0
    );
  }

  modes(): {
    readonly alternateScreen: boolean;
    readonly bracketedPaste: boolean;
    readonly focusReporting: boolean;
    readonly mouseTracking: boolean;
    readonly synchronizedOutput: boolean;
  } {
    const bits = this.modeBits();
    return {
      alternateScreen: (bits & (1 << 0)) !== 0,
      bracketedPaste: (bits & (1 << 1)) !== 0,
      focusReporting: (bits & (1 << 2)) !== 0,
      mouseTracking: (bits & (1 << 3)) !== 0,
      synchronizedOutput: (bits & (1 << 4)) !== 0,
    };
  }

  modeBits(): number {
    this.assertLive();
    return this.exports.restty_mode_bits(this.handle);
  }

  setCursorOptions(
    style: "block" | "underline" | "bar",
    blinking: boolean,
  ): void {
    this.assertLive();
    checkResult(
      this.exports.restty_set_cursor_options(
        this.handle,
        style === "block" ? 0 : style === "underline" ? 1 : 2,
        blinking ? 1 : 0,
      ),
      "set cursor options",
    );
  }

  encodeKey(event: TeraxGhosttyKeyEvent): Uint8Array {
    this.assertLive();
    const utf8 = event.utf8 ? this.textEncoder.encode(event.utf8) : emptyBytes;
    if (utf8.byteLength > 0) {
      this.ensureInputCapacity(utf8.byteLength);
      new Uint8Array(
        this.memory.buffer,
        this.inputPointer,
        utf8.byteLength,
      ).set(utf8);
    }
    checkResult(
      this.exports.restty_encode_key(
        this.handle,
        event.action,
        event.key,
        event.mods,
        event.consumedMods ?? 0,
        event.composing ? 1 : 0,
        event.unshiftedCodepoint ?? 0,
        utf8.byteLength > 0 ? this.inputPointer : 0,
        utf8.byteLength,
      ),
      "encode key",
    );
    const length = this.exports.restty_key_output_len(this.handle);
    if (length === 0) return emptyBytes;
    const pointer = this.exports.restty_key_output_ptr(this.handle);
    validateRange(this.memory.buffer, pointer, length);
    return new Uint8Array(this.memory.buffer, pointer, length).slice();
  }

  setSearchQuery(query: string): TeraxGhosttySearchStatus {
    this.assertLive();
    const bytes = this.textEncoder.encode(query);
    if (bytes.byteLength === 0) {
      this.clearSearch();
      return this.searchStatus();
    }
    if (bytes.byteLength > MAX_SEARCH_QUERY_BYTES) {
      throw new RangeError(
        `Ghostty search query exceeds ${MAX_SEARCH_QUERY_BYTES} UTF-8 bytes`,
      );
    }
    this.ensureInputCapacity(bytes.byteLength);
    new Uint8Array(this.memory.buffer, this.inputPointer, bytes.byteLength).set(
      bytes,
    );
    checkResult(
      this.exports.restty_search_set_query(
        this.handle,
        this.inputPointer,
        bytes.byteLength,
      ),
      "set search query",
    );
    return this.searchStatus();
  }

  clearSearch(): void {
    this.assertLive();
    checkResult(this.exports.restty_search_clear(this.handle), "clear search");
  }

  stepSearch(budget = 256): TeraxGhosttySearchStatus {
    this.assertLive();
    checkResult(
      this.exports.restty_search_step(
        this.handle,
        clampInteger(budget, 1, 4_096),
      ),
      "step search",
    );
    return this.searchStatus();
  }

  selectSearchMatch(direction: "next" | "previous"): TeraxGhosttySearchStatus {
    this.assertLive();
    const result =
      direction === "next"
        ? this.exports.restty_search_select_next(this.handle)
        : this.exports.restty_search_select_prev(this.handle);
    checkResult(result, `select ${direction} search match`);
    return this.searchStatus();
  }

  searchStatus(): TeraxGhosttySearchStatus {
    this.assertLive();
    const pointer = this.exports.restty_search_status_ptr(this.handle);
    validateRange(this.memory.buffer, pointer, SEARCH_STATUS_BYTES);
    const view = new DataView(
      this.memory.buffer,
      pointer,
      SEARCH_STATUS_BYTES,
    );
    return {
      active: view.getUint8(0) !== 0,
      pending: view.getUint8(1) !== 0,
      complete: view.getUint8(2) !== 0,
      generation: view.getUint32(4, true),
      totalMatches: view.getUint32(8, true),
      selectedIndex: view.getInt32(12, true),
    };
  }

  searchViewportMatches(): TeraxGhosttySearchViewportSpan[] {
    this.assertLive();
    const count = this.exports.restty_search_viewport_match_count(this.handle);
    if (count === 0) return [];
    const pointer = this.exports.restty_search_viewport_matches_ptr(this.handle);
    validateRange(
      this.memory.buffer,
      pointer,
      count * SEARCH_VIEWPORT_SPAN_BYTES,
    );
    const view = new DataView(
      this.memory.buffer,
      pointer,
      count * SEARCH_VIEWPORT_SPAN_BYTES,
    );
    const matches = new Array<TeraxGhosttySearchViewportSpan>(count);
    for (let index = 0; index < count; index += 1) {
      const offset = index * SEARCH_VIEWPORT_SPAN_BYTES;
      matches[index] = {
        row: view.getUint16(offset, true),
        startColumn: view.getUint16(offset + 2, true),
        endColumn: view.getUint16(offset + 4, true),
        selected: view.getUint8(offset + 6) !== 0,
      };
    }
    return matches;
  }

  scrollbar(): {
    readonly total: number;
    readonly offset: number;
    readonly length: number;
  } {
    this.assertLive();
    return {
      total: this.exports.restty_scrollbar_total(this.handle),
      offset: this.exports.restty_scrollbar_offset(this.handle),
      length: this.exports.restty_scrollbar_len(this.handle),
    };
  }

  setSelection(selection: TeraxGhosttySelection | null): void {
    this.assertLive();
    if (!selection) {
      checkResult(
        this.exports.restty_selection_clear(this.handle),
        "clear selection",
      );
      return;
    }
    checkResult(
      this.exports.restty_selection_set(
        this.handle,
        clampInteger(selection.anchor.line, 0, 0xffff_ffff),
        clampInteger(selection.anchor.column, 0, 0xffff),
        clampInteger(selection.focus.line, 0, 0xffff_ffff),
        clampInteger(selection.focus.column, 0, 0xffff),
        selection.rectangular ? 1 : 0,
      ),
      "set selection",
    );
  }

  selection(): TeraxGhosttySelection | null {
    this.assertLive();
    if (this.exports.restty_selection_active(this.handle) === 0) return null;
    return {
      anchor: {
        line: this.exports.restty_selection_start_line(this.handle),
        column: this.exports.restty_selection_start_col(this.handle),
      },
      focus: {
        line: this.exports.restty_selection_end_line(this.handle),
        column: this.exports.restty_selection_end_col(this.handle),
      },
      rectangular:
        this.exports.restty_selection_rectangular(this.handle) !== 0,
    };
  }

  selectionText(): string {
    this.assertLive();
    checkResult(
      this.exports.restty_selection_text_prepare(this.handle),
      "prepare selection text",
    );
    const length = this.exports.restty_selection_text_len(this.handle);
    if (length === 0) return "";
    const pointer = this.exports.restty_selection_text_ptr(this.handle);
    validateRange(this.memory.buffer, pointer, length);
    return textDecoder.decode(
      new Uint8Array(this.memory.buffer, pointer, length),
    );
  }

  setDefaultColors(
    foreground: number,
    background: number,
    cursor: number,
  ): void {
    this.assertLive();
    checkResult(
      this.exports.restty_set_default_colors(
        this.handle,
        foreground >>> 0,
        background >>> 0,
        cursor >>> 0,
      ),
      "set default colors",
    );
  }

  setPalette(colors: Uint8Array): void {
    this.assertLive();
    if (colors.byteLength % 3 !== 0 || colors.byteLength > 256 * 3) {
      throw new RangeError("Ghostty palette must contain at most 256 RGB triples");
    }
    if (colors.byteLength === 0) return;
    const pointer = this.allocate(colors.byteLength);
    try {
      new Uint8Array(this.memory.buffer, pointer, colors.byteLength).set(colors);
      checkResult(
        this.exports.restty_set_palette(
          this.handle,
          pointer,
          colors.byteLength / 3,
        ),
        "set palette",
      );
    } finally {
      this.exports.restty_free(pointer, colors.byteLength);
    }
  }

  resetPalette(): void {
    this.assertLive();
    checkResult(
      this.exports.restty_reset_palette(this.handle),
      "reset palette",
    );
  }

  graphemeAt(
    state: TeraxGhosttyRenderState,
    cellIndex: number,
  ): string {
    const index = validateCellIndex(state, cellIndex);
    const length = state.graphemeLengths[index];
    if (length === 0) {
      const codepoint = state.codepoints[index];
      return codepoint === 0 ? "" : String.fromCodePoint(codepoint);
    }
    const offset = state.graphemeOffsets[index];
    if (offset + length > state.graphemeCodepoints.length) {
      throw new RangeError("Invalid Ghostty grapheme range");
    }
    return String.fromCodePoint(
      state.codepoints[index],
      ...state.graphemeCodepoints.subarray(offset, offset + length),
    );
  }

  hyperlinkAt(
    state: TeraxGhosttyRenderBase,
    cellIndex: number,
  ): string | null {
    const linkId = state.linkIds[validateCellIndex(state, cellIndex)];
    if (linkId === 0) return null;
    const linkIndex = linkId - 1;
    if (linkIndex >= state.linkOffsets.length) {
      throw new RangeError("Invalid Ghostty hyperlink ID");
    }
    const offset = state.linkOffsets[linkIndex];
    const length = state.linkLengths[linkIndex];
    if (offset + length > state.linkBytes.length) {
      throw new RangeError("Invalid Ghostty hyperlink range");
    }
    return textDecoder.decode(state.linkBytes.subarray(offset, offset + length));
  }

  /**
   * Destroys the terminal. A terminal that owns its instance drops the whole
   * linear memory without running WASM teardown; one on a shared instance frees
   * its allocations back to that instance's allocator.
   */
  dispose(): void {
    if (this.disposed) return;
    const instance = this.instance;
    try {
      if (!this.ownsInstance) {
        if (this.inputPointer) {
          this.exports.restty_free(this.inputPointer, this.inputCapacity);
        }
        this.exports.restty_destroy(this.handle);
      }
    } finally {
      this.invalidate();
      instance.forget(this);
      if (this.ownsInstance) instance.dispose();
    }
  }

  /** @internal Drops every reference into the instance without calling WASM. */
  invalidate(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.inputPointer = 0;
    this.inputCapacity = 0;
    clearRenderViewCache(this.cache);
    this.exports = null as never;
    this.memory = null as never;
    this.instance = null as never;
  }

  private readRenderState(): TeraxGhosttyRenderState {
    const rows = this.exports.restty_rows(this.handle);
    const cols = this.exports.restty_cols(this.handle);
    validateDimensions(cols, rows);
    const cellCount = rows * cols;
    const buffer = this.memory.buffer;
    const graphemeCount = this.exports.restty_grapheme_buffer_len(this.handle);
    const linkCount = this.exports.restty_link_count(this.handle);
    const linkBytesLength = this.exports.restty_link_buffer_len(this.handle);
    const cursorPointer = this.exports.restty_cursor_info_ptr(this.handle);
    validateRange(buffer, cursorPointer, CURSOR_BYTES);
    const cursorView = new DataView(buffer, cursorPointer, CURSOR_BYTES);

    return {
      rows,
      cols,
      cellCount,
      codepoints: this.view(
        this.cache.codepoints,
        this.exports.restty_cell_codepoints_ptr(this.handle),
        cellCount,
        Uint32Array,
      ),
      contentTags: this.view(
        this.cache.contentTags,
        this.exports.restty_cell_content_tags_ptr(this.handle),
        cellCount,
        Uint8Array,
      ),
      widths: this.view(
        this.cache.widths,
        this.exports.restty_cell_wide_ptr(this.handle),
        cellCount,
        Uint8Array,
      ),
      cellFlags: this.view(
        this.cache.cellFlags,
        this.exports.restty_cell_flags_ptr(this.handle),
        cellCount,
        Uint16Array,
      ),
      styleFlags: this.view(
        this.cache.styleFlags,
        this.exports.restty_cell_style_flags_ptr(this.handle),
        cellCount,
        Uint16Array,
      ),
      underlineStyles: this.view(
        this.cache.underlineStyles,
        this.exports.restty_cell_underline_styles_ptr(this.handle),
        cellCount,
        Uint8Array,
      ),
      linkIds: this.view(
        this.cache.linkIds,
        this.exports.restty_cell_link_ids_ptr(this.handle),
        cellCount,
        Uint32Array,
      ),
      foregroundRgba: this.view(
        this.cache.foregroundRgba,
        this.exports.restty_cell_fg_rgba_ptr(this.handle),
        cellCount * 4,
        Uint8Array,
      ),
      backgroundRgba: this.view(
        this.cache.backgroundRgba,
        this.exports.restty_cell_bg_rgba_ptr(this.handle),
        cellCount * 4,
        Uint8Array,
      ),
      underlineRgba: this.view(
        this.cache.underlineRgba,
        this.exports.restty_cell_ul_rgba_ptr(this.handle),
        cellCount * 4,
        Uint8Array,
      ),
      graphemeOffsets: this.view(
        this.cache.graphemeOffsets,
        this.exports.restty_cell_grapheme_offsets_ptr(this.handle),
        cellCount,
        Uint32Array,
      ),
      graphemeLengths: this.view(
        this.cache.graphemeLengths,
        this.exports.restty_cell_grapheme_lengths_ptr(this.handle),
        cellCount,
        Uint32Array,
      ),
      graphemeCodepoints: this.optionalView(
        this.cache.graphemeCodepoints,
        this.exports.restty_grapheme_buffer_ptr(this.handle),
        graphemeCount,
        Uint32Array,
        emptyUint32,
      ),
      selectionStarts: this.view(
        this.cache.selectionStarts,
        this.exports.restty_row_selection_start_ptr(this.handle),
        rows,
        Int16Array,
      ),
      selectionEnds: this.view(
        this.cache.selectionEnds,
        this.exports.restty_row_selection_end_ptr(this.handle),
        rows,
        Int16Array,
      ),
      rowWrapped: this.view(
        this.cache.rowWrapped,
        this.exports.restty_row_wrapped_ptr(this.handle),
        rows,
        Uint8Array,
      ),
      dirtyRows: this.view(
        this.cache.dirtyRows,
        this.exports.restty_row_dirty_ptr(this.handle),
        rows,
        Uint8Array,
      ),
      fullDamage: this.exports.restty_damage_full(this.handle) !== 0,
      linkOffsets: this.optionalView(
        this.cache.linkOffsets,
        this.exports.restty_link_offsets_ptr(this.handle),
        linkCount,
        Uint32Array,
        emptyUint32,
      ),
      linkLengths: this.optionalView(
        this.cache.linkLengths,
        this.exports.restty_link_lengths_ptr(this.handle),
        linkCount,
        Uint32Array,
        emptyUint32,
      ),
      linkBytes: this.optionalView(
        this.cache.linkBytes,
        this.exports.restty_link_buffer_ptr(this.handle),
        linkBytesLength,
        Uint8Array,
        emptyBytes,
      ),
      cursor: {
        row: cursorView.getUint16(0, true),
        column: cursorView.getUint16(2, true),
        visible: cursorView.getUint8(4) !== 0,
        style: decodeCursorStyle(cursorView.getUint8(5)),
        blinking: cursorView.getUint8(6) !== 0,
        wideTail: cursorView.getUint8(7) !== 0,
        colorRgba: cursorView.getUint32(8, true),
      },
    };
  }

  /**
   * Re-reads the GPU render state of the last update without updating. Use it
   * to refresh borrowed views after another terminal grew the shared WASM
   * memory (which detaches every earlier `ArrayBuffer`).
   */
  readGpuRenderState(): TeraxGhosttyGpuRenderState {
    this.assertLive();
    this.assertFormat("gpu", "readGpuRenderState");
    const rows = this.exports.restty_rows(this.handle);
    const cols = this.exports.restty_cols(this.handle);
    validateDimensions(cols, rows);
    const cellCount = rows * cols;
    const buffer = this.memory.buffer;
    const linkCount = this.exports.restty_link_count(this.handle);
    const linkBytesLength = this.exports.restty_link_buffer_len(this.handle);
    const cursorPointer = this.exports.restty_cursor_info_ptr(this.handle);
    validateRange(buffer, cursorPointer, CURSOR_BYTES);
    const cursorView = new DataView(buffer, cursorPointer, CURSOR_BYTES);
    const cellsPtr = this.exports.restty_gpu_cells_ptr(this.handle);

    return {
      rows,
      cols,
      cellCount,
      epoch: this.exports.restty_gpu_epoch(this.handle),
      anyDirty: this.exports.restty_gpu_any_dirty(this.handle) !== 0,
      cellsPtr,
      cellsBytes: this.view(
        this.cache.gpuCells,
        cellsPtr,
        cellCount * GPU_CELL_BYTES,
        Uint8Array,
      ),
      cellWords: this.view(
        this.cache.gpuCellWords,
        cellsPtr,
        cellCount * GPU_CELL_WORDS,
        Uint32Array,
      ),
      blinkingCells: this.exports.restty_gpu_blinking_cells(this.handle),
      glyphCount: this.exports.restty_gpu_glyph_count(this.handle),
      glyphOverflow: this.exports.restty_gpu_glyph_overflow(this.handle),
      newGlyphs: this.pendingGpuGlyphs(),
      linkIds: this.view(
        this.cache.linkIds,
        this.exports.restty_cell_link_ids_ptr(this.handle),
        cellCount,
        Uint32Array,
      ),
      rowWrapped: this.view(
        this.cache.rowWrapped,
        this.exports.restty_row_wrapped_ptr(this.handle),
        rows,
        Uint8Array,
      ),
      dirtyRows: this.view(
        this.cache.dirtyRows,
        this.exports.restty_row_dirty_ptr(this.handle),
        rows,
        Uint8Array,
      ),
      fullDamage: this.exports.restty_damage_full(this.handle) !== 0,
      linkOffsets: this.optionalView(
        this.cache.linkOffsets,
        this.exports.restty_link_offsets_ptr(this.handle),
        linkCount,
        Uint32Array,
        emptyUint32,
      ),
      linkLengths: this.optionalView(
        this.cache.linkLengths,
        this.exports.restty_link_lengths_ptr(this.handle),
        linkCount,
        Uint32Array,
        emptyUint32,
      ),
      linkBytes: this.optionalView(
        this.cache.linkBytes,
        this.exports.restty_link_buffer_ptr(this.handle),
        linkBytesLength,
        Uint8Array,
        emptyBytes,
      ),
      cursor: {
        row: cursorView.getUint16(0, true),
        column: cursorView.getUint16(2, true),
        visible: cursorView.getUint8(4) !== 0,
        style: decodeCursorStyle(cursorView.getUint8(5)),
        blinking: cursorView.getUint8(6) !== 0,
        wideTail: cursorView.getUint8(7) !== 0,
        colorRgba: cursorView.getUint32(8, true),
      },
    };
  }

  private assertFormat(
    expected: TeraxGhosttyRenderFormat,
    operation: string,
  ): void {
    if (this.format !== expected) {
      throw new Error(
        `Adapted Ghostty ${operation} requires the "${expected}" render format (current: "${this.format}")`,
      );
    }
  }

  private view<T extends TypedArray>(
    entry: ViewCacheEntry<T>,
    pointer: number,
    length: number,
    Constructor: TypedArrayConstructor<T>,
  ): T {
    return getCachedView(
      entry,
      this.memory.buffer,
      pointer,
      length,
      Constructor,
    );
  }

  private optionalView<T extends TypedArray>(
    entry: ViewCacheEntry<T>,
    pointer: number,
    length: number,
    Constructor: TypedArrayConstructor<T>,
    empty: T,
  ): T {
    return length === 0
      ? empty
      : this.view(entry, pointer, length, Constructor);
  }

  private allocate(length: number): number {
    const pointer = this.exports.restty_alloc(length);
    if (!pointer) throw new Error("Adapted Ghostty WASM allocation failed");
    return pointer;
  }

  private ensureInputCapacity(length: number): void {
    if (length <= this.inputCapacity) return;
    if (this.inputPointer) {
      this.exports.restty_free(this.inputPointer, this.inputCapacity);
    }
    this.inputPointer = 0;
    this.inputCapacity = 0;
    const capacity = Math.max(
      INPUT_CAPACITY_ALIGNMENT,
      alignCapacity(
        Math.ceil(length * 1.125),
        INPUT_CAPACITY_ALIGNMENT,
      ),
    );
    this.inputPointer = this.allocate(capacity);
    this.inputCapacity = capacity;
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new Error("Adapted Ghostty terminal has been disposed");
    }
  }
}

/**
 * A page that drops a large WebAssembly memory may not collect it for a long
 * time: in WKWebView the memory stayed resident for over ten seconds on an
 * idle page. Creating even a one-page memory makes WebKit and V8 run a
 * collection, which frees every dropped instance.
 */
function hintGarbageCollection(): void {
  try {
    new WebAssembly.Memory({ initial: 1 });
  } catch {
    // Best effort: the dropped memory is still freed by the next collection.
  }
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as { unref(): void }).unref();
  }
}

function defaultInstantiate(
  module: WebAssembly.Module,
  imports: WebAssembly.Imports,
): WebAssembly.Instance {
  return new WebAssembly.Instance(module, imports);
}

async function compileBytes(bytes: ArrayBuffer): Promise<WebAssembly.Module> {
  if (bytes.byteLength === 0) {
    throw new Error("Adapted Ghostty WASM is empty");
  }
  return WebAssembly.compile(bytes);
}

/**
 * Growing by zero pages detaches the current `ArrayBuffer`, so a view retained
 * past disposal reads as empty instead of exposing a dead terminal's cells, and
 * JavaScriptCore no longer lets it pin the memory.
 */
function detachMemoryViews(memory: WebAssembly.Memory): void {
  try {
    memory.grow(0);
  } catch {
    // Best effort: the memory is unreachable once the instance is dropped.
  }
}

function createImports(
  holder: MemoryHolder,
  options: TeraxGhosttyLoadOptions,
): WebAssembly.Imports {
  return {
    env: {
      log: (pointer: number, length: number) => {
        const memory = holder.current;
        if (!memory || pointer <= 0 || length <= 0) return;
        validateRange(memory.buffer, pointer, length);
        options.log?.(
          textDecoder.decode(new Uint8Array(memory.buffer, pointer, length)),
        );
      },
    },
  };
}

function clearRenderViewCache(cache: RenderViewCache): void {
  for (const entry of Object.values(cache) as ViewCacheEntry<TypedArray>[]) {
    entry.buffer = null;
    entry.view = null;
    entry.pointer = 0;
    entry.length = 0;
  }
}

function createRenderViewCache(): RenderViewCache {
  return {
    codepoints: createViewCacheEntry(),
    contentTags: createViewCacheEntry(),
    widths: createViewCacheEntry(),
    cellFlags: createViewCacheEntry(),
    styleFlags: createViewCacheEntry(),
    underlineStyles: createViewCacheEntry(),
    linkIds: createViewCacheEntry(),
    foregroundRgba: createViewCacheEntry(),
    backgroundRgba: createViewCacheEntry(),
    underlineRgba: createViewCacheEntry(),
    graphemeOffsets: createViewCacheEntry(),
    graphemeLengths: createViewCacheEntry(),
    graphemeCodepoints: createViewCacheEntry(),
    selectionStarts: createViewCacheEntry(),
    selectionEnds: createViewCacheEntry(),
    rowWrapped: createViewCacheEntry(),
    dirtyRows: createViewCacheEntry(),
    linkOffsets: createViewCacheEntry(),
    linkLengths: createViewCacheEntry(),
    linkBytes: createViewCacheEntry(),
    gpuCells: createViewCacheEntry(),
    gpuCellWords: createViewCacheEntry(),
    gpuNewGlyphs: createViewCacheEntry(),
    gpuAllGlyphs: createViewCacheEntry(),
  };
}

function validateDimensions(cols: number, rows: number): void {
  if (
    !Number.isSafeInteger(cols) ||
    !Number.isSafeInteger(rows) ||
    cols <= 0 ||
    rows <= 0 ||
    cols > MAX_DIMENSION ||
    rows > MAX_DIMENSION ||
    cols * rows > MAX_CELLS
  ) {
    throw new RangeError(`Invalid terminal dimensions: ${cols}x${rows}`);
  }
}

function validateRange(
  buffer: ArrayBuffer,
  pointer: number,
  byteLength: number,
): void {
  if (
    !Number.isSafeInteger(pointer) ||
    !Number.isSafeInteger(byteLength) ||
    pointer <= 0 ||
    byteLength < 0 ||
    pointer + byteLength > buffer.byteLength
  ) {
    throw new RangeError(
      `Invalid Ghostty WASM range: ptr=${pointer}, bytes=${byteLength}`,
    );
  }
}

function normalizeLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return clampInteger(value, 0, maximum);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function alignCapacity(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function checkResult(code: number, operation: string): void {
  if (code === 0) return;
  const reason =
    code === 1
      ? "invalid handle"
      : code === 2
        ? "out of memory"
        : code === 3
          ? "invalid argument"
          : "internal error";
  throw new Error(`Adapted Ghostty ${operation} failed: ${reason} (${code})`);
}

function decodeCursorStyle(value: number): "block" | "underline" | "bar" {
  // Render-state ABI (cursorStyleToAbi), distinct from setCursorOptions input.
  if (value === 1) return "bar";
  if (value === 2) return "underline";
  return "block";
}

function validateCellIndex(
  state: TeraxGhosttyRenderBase,
  cellIndex: number,
): number {
  if (
    !Number.isSafeInteger(cellIndex) ||
    cellIndex < 0 ||
    cellIndex >= state.cellCount
  ) {
    throw new RangeError(`Invalid Ghostty cell index: ${cellIndex}`);
  }
  return cellIndex;
}

function decodeLines(
  words: Uint32Array,
  cols: number,
  into: TeraxGhosttyLine[],
): void {
  let index = 0;
  while (index < words.length) {
    const wrapped = words[index++] !== 0;
    const cells = new Array<string>(cols);
    for (let column = 0; column < cols; column += 1) {
      if (index >= words.length) {
        throw new RangeError("Truncated Ghostty line cell data");
      }
      const count = words[index++];
      if (index + count > words.length) {
        throw new RangeError("Invalid Ghostty line cell data");
      }
      if (count === 0) {
        cells[column] = "";
      } else if (count === 1) {
        cells[column] = String.fromCodePoint(words[index]);
      } else {
        cells[column] = String.fromCodePoint(
          ...words.subarray(index, index + count),
        );
      }
      index += count;
    }
    into.push({ cells, wrapped });
  }
}

function decodeTerminalEvent(
  type: number,
  payload: Uint8Array,
): GhosttyTerminalEvent | null {
  switch (type) {
    case 1:
      return { type: "bell" };
    case 2:
      return { type: "title", title: textDecoder.decode(payload) };
    case 3:
      return { type: "pwd", uri: textDecoder.decode(payload) };
    case 4:
      if (payload.byteLength < 1) return null;
      return {
        type: "clipboard",
        selection: String.fromCharCode(payload[0]),
        data: textDecoder.decode(payload.subarray(1)),
      };
    case 5: {
      if (payload.byteLength < 4) return null;
      const titleLength = new DataView(
        payload.buffer,
        payload.byteOffset,
        payload.byteLength,
      ).getUint32(0, true);
      if (titleLength > payload.byteLength - 4) return null;
      return {
        type: "notification",
        title: textDecoder.decode(payload.subarray(4, 4 + titleLength)),
        body: textDecoder.decode(payload.subarray(4 + titleLength)),
      };
    }
    case 6:
      return { type: "prompt-start" };
    case 7:
      return { type: "prompt-continuation" };
    case 8:
      return payload.byteLength > 0 && payload[0] === 0
        ? { type: "prompt-end", blockInput: false }
        : { type: "prompt-end" };
    case 9: {
      if (payload.byteLength < 4) return null;
      const marker = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, true);
      return marker ? { type: "end-of-input", marker, command: textDecoder.decode(payload.subarray(4)) } : { type: "end-of-input" };
    }
    case 10: {
      if (payload.byteLength < 9) return null;
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const marker = view.getUint32(0, true);
      return {
        type: "end-of-command",
        exitCode: payload[4] ? view.getInt32(5, true) : null,
        ...(marker ? { marker } : {}),
      };
    }
    case 11:
      return { type: "screen-cleared" };
    default:
      return null;
  }
}
