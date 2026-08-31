export type TeraxGhosttyCursor = {
  readonly row: number;
  readonly column: number;
  readonly visible: boolean;
  readonly style: "block" | "underline" | "bar";
  readonly blinking: boolean;
  readonly wideTail: boolean;
  readonly colorRgba: number;
};

export type TeraxGhosttyRenderState = {
  readonly rows: number;
  readonly cols: number;
  readonly cellCount: number;
  readonly codepoints: Uint32Array;
  readonly contentTags: Uint8Array;
  readonly widths: Uint8Array;
  readonly cellFlags: Uint16Array;
  readonly styleFlags: Uint16Array;
  readonly underlineStyles: Uint8Array;
  readonly linkIds: Uint32Array;
  readonly foregroundRgba: Uint8Array;
  readonly backgroundRgba: Uint8Array;
  readonly underlineRgba: Uint8Array;
  readonly graphemeOffsets: Uint32Array;
  readonly graphemeLengths: Uint32Array;
  readonly graphemeCodepoints: Uint32Array;
  readonly selectionStarts: Int16Array;
  readonly selectionEnds: Int16Array;
  readonly rowWrapped: Uint8Array;
  readonly dirtyRows: Uint8Array;
  readonly fullDamage: boolean;
  readonly linkOffsets: Uint32Array;
  readonly linkLengths: Uint32Array;
  readonly linkBytes: Uint8Array;
  readonly cursor: TeraxGhosttyCursor;
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

export type TeraxGhosttyLoadOptions = {
  readonly log?: (message: string) => void;
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
  readonly restty_write: (handle: number, ptr: number, len: number) => number;
  readonly restty_resize: (handle: number, cols: number, rows: number) => number;
  readonly restty_set_pixel_size: (
    handle: number,
    widthPx: number,
    heightPx: number,
  ) => number;
  readonly restty_render_update: (handle: number) => number;
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
  readonly restty_selection_set: (
    handle: number,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
    rectangular: number,
  ) => number;
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
