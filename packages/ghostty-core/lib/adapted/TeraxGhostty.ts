import type {
  TeraxGhosttyLoadOptions,
  TeraxGhosttyKeyEvent,
  TeraxGhosttyRenderState,
  TeraxGhosttySearchStatus,
  TeraxGhosttySearchViewportSpan,
  TeraxGhosttySelection,
  TeraxGhosttyTerminalOptions,
  TeraxGhosttyWasmExports,
  TypedArray,
  TypedArrayConstructor,
  ViewCacheEntry,
} from "./types";
import { createViewCacheEntry, getCachedView } from "./viewCache";
import type { GhosttyTerminalEvent } from "../types";

export const ADAPTED_GHOSTTY_COMMIT =
  "e9db8d2b0b827be035ab75658ea9faf4f0f56d3f";
export const ADAPTED_RESTTY_COMMIT =
  "7700b14a7643ba9240818209ef1e0aa90d83ad77";
export const ADAPTED_GHOSTTY_WASM_SHA256 =
  "ed4a16b152710c53039d3dd2ddbdb94e7b0ba0205c9e4d6811efb03150cd0633";

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

const requiredExports = [
  "memory",
  "restty_create_with_limits",
  "restty_destroy",
  "restty_write",
  "restty_resize",
  "restty_set_pixel_size",
  "restty_render_update",
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
  "restty_selection_set",
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
] as const;

const textDecoder = new TextDecoder();
const emptyBytes = new Uint8Array(0);
const emptyUint32 = new Uint32Array(0);

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
};

export class TeraxGhostty {
  private constructor(
    private readonly exports: TeraxGhosttyWasmExports,
    private readonly memory: WebAssembly.Memory,
  ) {}

  static async load(
    wasmPath?: string,
    options: TeraxGhosttyLoadOptions = {},
  ): Promise<TeraxGhostty> {
    const path =
      wasmPath ?? new URL("../../adapted/ghostty-vt.wasm", import.meta.url).href;
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch adapted Ghostty WASM: ${response.status} ${response.statusText}`,
      );
    }

    const fallback = response.clone();
    const memoryRef: { current: WebAssembly.Memory | null } = {
      current: null,
    };
    const imports = createImports(memoryRef, options);
    try {
      const { instance } = await WebAssembly.instantiateStreaming(
        response,
        imports,
      );
      return TeraxGhostty.fromInstance(instance, memoryRef);
    } catch {
      return TeraxGhostty.loadBytes(await fallback.arrayBuffer(), options);
    }
  }

  static async loadBytes(
    bytes: ArrayBuffer,
    options: TeraxGhosttyLoadOptions = {},
  ): Promise<TeraxGhostty> {
    if (bytes.byteLength === 0) {
      throw new Error("Adapted Ghostty WASM is empty");
    }
    const memoryRef: { current: WebAssembly.Memory | null } = {
      current: null,
    };
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(
      module,
      createImports(memoryRef, options),
    );
    return TeraxGhostty.fromInstance(instance, memoryRef);
  }

  createTerminal(
    cols: number,
    rows: number,
    options: TeraxGhosttyTerminalOptions = {},
  ): TeraxGhosttyTerminal {
    return new TeraxGhosttyTerminal(
      this.exports,
      this.memory,
      cols,
      rows,
      options,
    );
  }

  getMemoryBytes(): number {
    return this.memory.buffer.byteLength;
  }

  private static fromInstance(
    instance: WebAssembly.Instance,
    memoryRef: { current: WebAssembly.Memory | null },
  ): TeraxGhostty {
    const exports = instance.exports as TeraxGhosttyWasmExports;
    for (const name of requiredExports) {
      if (!(name in exports)) {
        throw new Error(`Missing adapted Ghostty WASM export: ${name}`);
      }
    }
    memoryRef.current = exports.memory;
    return new TeraxGhostty(exports, exports.memory);
  }
}

export class TeraxGhosttyTerminal {
  private readonly cache: RenderViewCache = createRenderViewCache();
  private readonly handle: number;
  private inputPointer = 0;
  private inputCapacity = 0;
  private readonly textEncoder = new TextEncoder();
  private disposed = false;

  constructor(
    private readonly exports: TeraxGhosttyWasmExports,
    private readonly memory: WebAssembly.Memory,
    cols: number,
    rows: number,
    options: TeraxGhosttyTerminalOptions,
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
    this.handle = this.exports.restty_create_with_limits(
      cols,
      rows,
      maxScrollbackBytes,
      maxScrollbackLines,
    );
    if (!this.handle) {
      throw new Error("Failed to create adapted Ghostty terminal");
    }
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

  updateRenderState(): TeraxGhosttyRenderState {
    this.assertLive();
    checkResult(
      this.exports.restty_render_update(this.handle),
      "update render state",
    );
    return this.readRenderState();
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
    const events: GhosttyTerminalEvent[] = [];
    const length = this.exports.restty_events_len(this.handle);
    if (length > 0) {
      const pointer = this.exports.restty_events_ptr(this.handle);
      validateRange(this.memory.buffer, pointer, length);
      const bytes = new Uint8Array(this.memory.buffer, pointer, length);
      let offset = 0;
      try {
        while (offset < bytes.byteLength) {
          if (bytes.byteLength - offset < EVENT_HEADER_BYTES) {
            throw new Error("Truncated Ghostty semantic event header");
          }
          const type = bytes[offset];
          const payloadLength = new DataView(
            bytes.buffer,
            bytes.byteOffset + offset + 1,
            4,
          ).getUint32(0, true);
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
    }

    const dropped = this.exports.restty_take_dropped_events(this.handle);
    if (dropped > 0) events.push({ type: "overflow", dropped });
    return events;
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
    this.assertLive();
    const bits = this.exports.restty_mode_bits(this.handle);
    return {
      alternateScreen: (bits & (1 << 0)) !== 0,
      bracketedPaste: (bits & (1 << 1)) !== 0,
      focusReporting: (bits & (1 << 2)) !== 0,
      mouseTracking: (bits & (1 << 3)) !== 0,
      synchronizedOutput: (bits & (1 << 4)) !== 0,
    };
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
    state: TeraxGhosttyRenderState,
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.inputPointer) {
      this.exports.restty_free(this.inputPointer, this.inputCapacity);
      this.inputPointer = 0;
      this.inputCapacity = 0;
    }
    this.exports.restty_destroy(this.handle);
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
    this.inputCapacity = Math.max(
      INPUT_CAPACITY_ALIGNMENT,
      alignCapacity(
        Math.ceil(length * 1.125),
        INPUT_CAPACITY_ALIGNMENT,
      ),
    );
    this.inputPointer = this.allocate(this.inputCapacity);
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new Error("Adapted Ghostty terminal has been disposed");
    }
  }
}

function createImports(
  memoryRef: { current: WebAssembly.Memory | null },
  options: TeraxGhosttyLoadOptions,
): WebAssembly.Imports {
  return {
    env: {
      log: (pointer: number, length: number) => {
        const memory = memoryRef.current;
        if (!memory || pointer <= 0 || length <= 0) return;
        validateRange(memory.buffer, pointer, length);
        options.log?.(
          textDecoder.decode(new Uint8Array(memory.buffer, pointer, length)),
        );
      },
    },
  };
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
  if (value === 1) return "underline";
  if (value === 2) return "bar";
  return "block";
}

function validateCellIndex(
  state: TeraxGhosttyRenderState,
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
      return { type: "prompt-end" };
    case 9:
      return { type: "end-of-input" };
    case 10:
      return {
        type: "end-of-command",
        exitCode:
          payload[0] === undefined || payload[0] === 255 ? null : payload[0],
      };
    default:
      return null;
  }
}
