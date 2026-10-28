export type TeraxGhosttyCursor = {
  readonly row: number;
  readonly column: number;
  readonly visible: boolean;
  readonly style: "block" | "underline" | "bar";
  readonly blinking: boolean;
  readonly wideTail: boolean;
  readonly colorRgba: number;
};

/** Per-cell representation written by `updateRenderState` / `updateGpuRenderState`. */
export type TeraxGhosttyRenderFormat = "soa" | "gpu";

/**
 * State shared by both render formats. All typed arrays are borrowed views
 * into WASM memory: they are valid only until the next call on the terminal
 * that can allocate (update, resize, release, compaction, write).
 */
export type TeraxGhosttyRenderBase = {
  readonly rows: number;
  readonly cols: number;
  readonly cellCount: number;
  /** Per-cell 1-based hyperlink id (0 = none), valid for every row. */
  readonly linkIds: Uint32Array;
  readonly linkOffsets: Uint32Array;
  readonly linkLengths: Uint32Array;
  readonly linkBytes: Uint8Array;
  /** Per-row soft-wrap continuation flag. */
  readonly rowWrapped: Uint8Array;
  /**
   * Per-row dirty flags of the last update. SoA: rows Ghostty marked dirty.
   * GPU: rows whose 16-byte records actually changed (Ghostty-dirty rows that
   * were rewritten with identical content are not reported), or every row on
   * `fullDamage`.
   */
  readonly dirtyRows: Uint8Array;
  readonly fullDamage: boolean;
  readonly cursor: TeraxGhosttyCursor;
};

/** Structure-of-arrays format (`"soa"`): the WebGL fallback and legacy readers. */
export type TeraxGhosttyRenderState = TeraxGhosttyRenderBase & {
  readonly codepoints: Uint32Array;
  readonly contentTags: Uint8Array;
  readonly widths: Uint8Array;
  readonly cellFlags: Uint16Array;
  readonly styleFlags: Uint16Array;
  readonly underlineStyles: Uint8Array;
  readonly foregroundRgba: Uint8Array;
  readonly backgroundRgba: Uint8Array;
  readonly underlineRgba: Uint8Array;
  readonly graphemeOffsets: Uint32Array;
  readonly graphemeLengths: Uint32Array;
  readonly graphemeCodepoints: Uint32Array;
  readonly selectionStarts: Int16Array;
  readonly selectionEnds: Int16Array;
};

/** One interned glyph: a codepoint or grapheme cluster in a bold/italic face. */
export type TeraxGhosttyGpuGlyph = {
  /** Dense id starting at 1; 0 never names a glyph. */
  readonly id: number;
  /** Bit 0: bold. Bit 1: italic. These are the only style bits glyphs key on. */
  readonly style: number;
  /** The text to rasterize (`String.fromCodePoint` of the cluster). */
  readonly text: string;
};

/**
 * GPU format (`"gpu"`): one 16-byte record per cell in WASM memory plus glyph
 * ids interned in WASM. See `GPU_CELL_*` constants for the exact layout. The
 * structure-of-arrays cell arrays do not exist in this format.
 */
export type TeraxGhosttyGpuRenderState = TeraxGhosttyRenderBase & {
  /**
   * Glyph-id epoch. When it differs from the epoch you last saw, every glyph
   * id you hold is invalid: drop your id map and rebuild it from `newGlyphs`
   * (which then contains the whole table). `fullDamage` is also true.
   */
  readonly epoch: number;
  /** True when any row's records changed (always true with `fullDamage`). */
  readonly anyDirty: boolean;
  /** Byte address of record 0 inside `memory.buffer`. */
  readonly cellsPtr: number;
  /** `rows * cols * GPU_CELL_BYTES` bytes; `cellsBytes.buffer` is the WASM buffer. */
  readonly cellsBytes: Uint8Array;
  /** The same bytes as `cellsBytes`, as little-endian words (4 per cell). */
  readonly cellWords: Uint32Array;
  /** Visible cells that blink and draw a glyph. Arm the text-blink timer only if > 0. */
  readonly blinkingCells: number;
  /** Glyphs interned in the current epoch (ids are `1..glyphCount`). */
  readonly glyphCount: number;
  /** Cells drawn as glyph 0 because the visible glyph set exceeded the table. */
  readonly glyphOverflow: number;
  /**
   * Glyphs interned since the last `acknowledgeGpuGlyphs()`. Borrowed; decode
   * (iterate) before the next call, then acknowledge.
   */
  readonly newGlyphs: TeraxGhosttyGpuGlyphBatch;
};

/** Borrowed `[id][style][count][codepoints...]` records. */
export interface TeraxGhosttyGpuGlyphBatch extends Iterable<TeraxGhosttyGpuGlyph> {
  /** Raw little-endian words of the records. */
  readonly words: Uint32Array;
  readonly isEmpty: boolean;
  toArray(): TeraxGhosttyGpuGlyph[];
}

/** One decoded buffer line (see `TeraxGhosttyTerminal.readLines`). */
export type TeraxGhosttyLine = {
  /** Column strings: `""` for wide-character spacers, `" "` for blanks. */
  readonly cells: string[];
  /** True when the row continues a soft-wrapped line. */
  readonly wrapped: boolean;
};

export type TeraxGhosttyKeyEvent = {
  readonly action: number;
  readonly key: number;
  readonly mods: number;
  readonly consumedMods?: number;
  readonly composing?: boolean;
  readonly utf8?: string;
  readonly unshiftedCodepoint?: number;
};

export type TeraxGhosttyTerminalOptions = {
  readonly maxScrollbackBytes?: number;
  readonly maxScrollbackLines?: number;
};

export type TeraxGhosttyTerminalResourceStats = {
  readonly cellCapacity: number;
  readonly rowCapacity: number;
  readonly renderStateResets: number;
  readonly renderFormat: TeraxGhosttyRenderFormat;
  /** Glyphs interned for the GPU format (0 in other formats or when released). */
  readonly glyphCount: number;
  readonly glyphEpoch: number;
};

export type TeraxGhosttySearchStatus = {
  readonly active: boolean;
  readonly pending: boolean;
  readonly complete: boolean;
  readonly generation: number;
  readonly totalMatches: number;
  readonly selectedIndex: number;
};

export type TeraxGhosttySearchViewportSpan = {
  readonly row: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly selected: boolean;
};

export type TeraxGhosttySelection = {
  readonly anchor: { readonly line: number; readonly column: number };
  readonly focus: { readonly line: number; readonly column: number };
  readonly rectangular: boolean;
};

export type TeraxGhosttyInstantiate = (
  module: WebAssembly.Module,
  imports: WebAssembly.Imports,
) => WebAssembly.Instance;

export type TeraxGhosttyLoadOptions = {
  readonly log?: (message: string) => void;
  /**
   * Creates one instance of the compiled module. The default is a synchronous
   * `new WebAssembly.Instance`, which takes about a millisecond or less once
   * the module is compiled. Overridable so tests can observe instantiation.
   */
  readonly instantiate?: TeraxGhosttyInstantiate;
  /**
   * Called once per burst of disposed instances with the linear-memory bytes
   * they released. A dropped memory is only freed when the engine collects it,
   * which on an idle page may not happen for a long time; the default hint
   * allocates a throwaway one-page `WebAssembly.Memory`, which makes WebKit and
   * V8 collect. `null` disables the hint.
   */
  readonly reclaim?: ((bytes: number) => void) | null;
  /** Quiet period before `reclaim` runs (default 250 ms). */
  readonly reclaimDelayMs?: number;
};

/** Linear-memory accounting across every live instance of one compiled module. */
export type TeraxGhosttyMemoryStats = {
  readonly instanceCount: number;
  /** Sum of `memory.buffer.byteLength` over live instances. */
  readonly totalBytes: number;
  readonly instanceBytes: readonly number[];
  /** Instances created since the module was loaded, live or not. */
  readonly instancesCreated: number;
};

export type TeraxGhosttyWasmExports = WebAssembly.Exports & {
  readonly memory: WebAssembly.Memory;
  readonly restty_create_with_limits: (
    cols: number,
    rows: number,
    maxScrollbackBytes: number,
    maxScrollbackLines: number,
  ) => number;
  readonly restty_destroy: (handle: number) => void;
  readonly restty_scrollback_page_bytes: (handle: number) => number;
  readonly restty_set_scrollback_limits: (
    handle: number,
    maxBytes: number,
    maxLines: number,
  ) => number;
  readonly restty_write: (handle: number, ptr: number, len: number) => number;
  readonly restty_resize: (handle: number, cols: number, rows: number) => number;
  readonly restty_set_pixel_size: (
    handle: number,
    widthPx: number,
    heightPx: number,
  ) => number;
  readonly restty_render_update: (handle: number) => number;
  readonly restty_render_release: (handle: number) => void;
  readonly restty_render_compact: (handle: number) => number;
  readonly restty_set_render_format: (handle: number, format: number) => number;
  readonly restty_render_format: (handle: number) => number;
  readonly restty_gpu_cell_stride: () => number;
  readonly restty_gpu_cells_ptr: (handle: number) => number;
  readonly restty_gpu_any_dirty: (handle: number) => number;
  readonly restty_gpu_epoch: (handle: number) => number;
  readonly restty_gpu_blinking_cells: (handle: number) => number;
  readonly restty_gpu_glyph_count: (handle: number) => number;
  readonly restty_gpu_glyph_overflow: (handle: number) => number;
  readonly restty_gpu_new_glyphs_ptr: (handle: number) => number;
  readonly restty_gpu_new_glyphs_len: (handle: number) => number;
  readonly restty_gpu_glyphs_ack: (handle: number) => void;
  readonly restty_gpu_glyphs_ptr: (handle: number) => number;
  readonly restty_gpu_glyphs_len: (handle: number) => number;
  readonly restty_line_cells_prepare: (
    handle: number,
    firstLine: number,
    lastLine: number,
  ) => number;
  readonly restty_line_cells_ptr: (handle: number) => number;
  readonly restty_line_cells_len: (handle: number) => number;
  readonly restty_line_cells_release: (handle: number) => void;
  readonly restty_cell_capacity: (handle: number) => number;
  readonly restty_row_capacity: (handle: number) => number;
  readonly restty_render_reset_count: (handle: number) => number;
  readonly restty_alloc: (len: number) => number;
  readonly restty_free: (ptr: number, len: number) => void;
  readonly restty_output_ptr: (handle: number) => number;
  readonly restty_output_len: (handle: number) => number;
  readonly restty_output_consume: (handle: number, len: number) => number;
  readonly restty_events_ptr: (handle: number) => number;
  readonly restty_events_len: (handle: number) => number;
  readonly restty_events_consume: (handle: number, len: number) => number;
  readonly restty_take_dropped_events: (handle: number) => number;
  readonly restty_scroll_viewport: (handle: number, delta: number) => number;
  readonly restty_scroll_viewport_to: (handle: number, row: number) => number;
  readonly restty_scrollbar_total: (handle: number) => number;
  readonly restty_scrollbar_offset: (handle: number) => number;
  readonly restty_scrollbar_len: (handle: number) => number;
  readonly restty_active_cursor_y: (handle: number) => number;
  readonly restty_selection_set: (
    handle: number,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
    rectangular: number,
  ) => number;
  readonly restty_semantic_markers_enable: (handle: number, enabled: number) => void;
  readonly restty_semantic_marker_column: (handle: number, id: number) => number;
  readonly restty_semantic_marker_line: (handle: number, id: number) => number;
  readonly restty_semantic_marker_count: (handle: number) => number;
  readonly restty_text_range_prepare: (handle: number, startLine: number, startCol: number, endLine: number, endCol: number) => number;
  readonly restty_selection_clear: (handle: number) => number;
  readonly restty_selection_active: (handle: number) => number;
  readonly restty_selection_start_line: (handle: number) => number;
  readonly restty_selection_start_col: (handle: number) => number;
  readonly restty_selection_end_line: (handle: number) => number;
  readonly restty_selection_end_col: (handle: number) => number;
  readonly restty_selection_rectangular: (handle: number) => number;
  readonly restty_selection_text_prepare: (handle: number) => number;
  readonly restty_selection_text_ptr: (handle: number) => number;
  readonly restty_selection_text_len: (handle: number) => number;
  readonly restty_set_default_colors: (
    handle: number,
    foreground: number,
    background: number,
    cursor: number,
  ) => number;
  readonly restty_set_palette: (
    handle: number,
    ptr: number,
    count: number,
  ) => number;
  readonly restty_reset_palette: (handle: number) => number;
  readonly restty_mode: (
    handle: number,
    value: number,
    ansi: number,
  ) => number;
  readonly restty_mode_bits: (handle: number) => number;
  readonly restty_set_cursor_options: (
    handle: number,
    style: number,
    blinking: number,
  ) => number;
  readonly restty_encode_key: (
    handle: number,
    action: number,
    key: number,
    mods: number,
    consumedMods: number,
    composing: number,
    unshiftedCodepoint: number,
    utf8Pointer: number,
    utf8Length: number,
  ) => number;
  readonly restty_key_output_ptr: (handle: number) => number;
  readonly restty_key_output_len: (handle: number) => number;
  readonly restty_search_set_query: (
    handle: number,
    ptr: number,
    len: number,
  ) => number;
  readonly restty_search_clear: (handle: number) => number;
  readonly restty_search_step: (handle: number, budget: number) => number;
  readonly restty_search_status_ptr: (handle: number) => number;
  readonly restty_search_viewport_match_count: (handle: number) => number;
  readonly restty_search_viewport_matches_ptr: (handle: number) => number;
  readonly restty_search_select_next: (handle: number) => number;
  readonly restty_search_select_prev: (handle: number) => number;
  readonly restty_rows: (handle: number) => number;
  readonly restty_cols: (handle: number) => number;
  readonly restty_cell_codepoints_ptr: (handle: number) => number;
  readonly restty_cell_content_tags_ptr: (handle: number) => number;
  readonly restty_cell_wide_ptr: (handle: number) => number;
  readonly restty_cell_flags_ptr: (handle: number) => number;
  readonly restty_cell_style_flags_ptr: (handle: number) => number;
  readonly restty_cell_underline_styles_ptr: (handle: number) => number;
  readonly restty_cell_link_ids_ptr: (handle: number) => number;
  readonly restty_cell_fg_rgba_ptr: (handle: number) => number;
  readonly restty_cell_bg_rgba_ptr: (handle: number) => number;
  readonly restty_cell_ul_rgba_ptr: (handle: number) => number;
  readonly restty_cell_grapheme_offsets_ptr: (handle: number) => number;
  readonly restty_cell_grapheme_lengths_ptr: (handle: number) => number;
  readonly restty_grapheme_buffer_ptr: (handle: number) => number;
  readonly restty_grapheme_buffer_len: (handle: number) => number;
  readonly restty_row_selection_start_ptr: (handle: number) => number;
  readonly restty_row_selection_end_ptr: (handle: number) => number;
  readonly restty_row_wrapped_ptr: (handle: number) => number;
  readonly restty_row_dirty_ptr: (handle: number) => number;
  readonly restty_damage_full: (handle: number) => number;
  readonly restty_cursor_info_ptr: (handle: number) => number;
  readonly restty_link_offsets_ptr: (handle: number) => number;
  readonly restty_link_lengths_ptr: (handle: number) => number;
  readonly restty_link_buffer_ptr: (handle: number) => number;
  readonly restty_link_count: (handle: number) => number;
  readonly restty_link_buffer_len: (handle: number) => number;
};

export type TypedArray =
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int16Array;

export type TypedArrayConstructor<T extends TypedArray> = {
  readonly BYTES_PER_ELEMENT: number;
  new (buffer: ArrayBuffer, byteOffset: number, length: number): T;
};

export type ViewCacheEntry<T extends TypedArray> = {
  buffer: ArrayBuffer | null;
  pointer: number;
  length: number;
  view: T | null;
};
