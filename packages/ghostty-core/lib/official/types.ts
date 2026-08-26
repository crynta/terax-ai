export const OFFICIAL_GHOSTTY_COMMIT =
  "cecf81678e47f967b0354acada67e69d229f436b";
export const OFFICIAL_GHOSTTY_WASM_SHA256 =
  "13f9440aa2e1afaa2ec4c48b7560cea14ec4ab4ae90cc0292bdbadb034290a01";

export enum GhosttyResult {
  Success = 0,
  OutOfMemory = -1,
  InvalidValue = -2,
  OutOfSpace = -3,
  NoValue = -4,
  IoError = -5,
  LimitExceeded = -6,
}

export enum GhosttyOptimizeMode {
  Debug = 0,
  ReleaseSafe = 1,
  ReleaseSmall = 2,
  ReleaseFast = 3,
}

export enum GhosttyBuildInfoKey {
  Simd = 1,
  Optimize = 4,
  VersionString = 5,
}

export enum GhosttyTerminalOption {
  WritePty = 1,
  ColorForeground = 11,
  ColorBackground = 12,
  ColorCursor = 13,
  ColorPalette = 14,
  DefaultCursorStyle = 22,
  DefaultCursorBlink = 23,
  ScrollbackMaxBytes = 27,
  ScrollbackMaxLines = 28,
  ContinuationMaxBytes = 31,
  TerminfoName = 37,
}

export enum GhosttyTerminalData {
  ActiveScreen = 6,
  MouseTracking = 11,
  Title = 12,
  Pwd = 13,
  ScrollbackRows = 15,
  Scrollbar = 9,
  Mode = 37,
  CursorAtPrompt = 39,
}

export enum GhosttyRenderStateData {
  Cols = 1,
  Rows = 2,
  Dirty = 3,
  RowIterator = 4,
  CursorVisualStyle = 10,
  CursorVisible = 11,
  CursorBlinking = 12,
  CursorViewportHasValue = 14,
  CursorViewportX = 15,
  CursorViewportY = 16,
}

export enum GhosttyRenderStateRowData {
  Dirty = 1,
  Cells = 3,
  Selection = 4,
  CellsRaw = 5,
}

export enum GhosttyRenderStateDirty {
  None = 0,
  Partial = 1,
  Full = 2,
}

export enum GhosttyRenderStateCursorStyle {
  Bar = 0,
  Block = 1,
  Underline = 2,
  BlockHollow = 3,
}

export type OfficialGhosttyBuildInfo = {
  readonly optimize: GhosttyOptimizeMode;
  readonly simd: boolean;
  readonly version: string;
};

export type OfficialGhosttyColor = readonly [
  red: number,
  green: number,
  blue: number,
];

export type OfficialGhosttyRenderColors = {
  readonly background: OfficialGhosttyColor;
  readonly foreground: OfficialGhosttyColor;
  readonly cursor: OfficialGhosttyColor | null;
  readonly palette: readonly OfficialGhosttyColor[];
};

export type OfficialGhosttyRenderCursor = {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
  readonly blinking: boolean;
  readonly style: GhosttyRenderStateCursorStyle;
};

export type OfficialGhosttyRawRow = {
  readonly row: number;
  readonly dirty: boolean;
  /** Two little-endian uint32 values per opaque 64-bit GhosttyCell. */
  readonly cells: Uint32Array;
};

export type OfficialGhosttyTerminalOptions = {
  readonly scrollbackMaxLines?: number;
  readonly scrollbackMaxBytes?: number;
  readonly continuationMaxBytes?: number;
  readonly foreground?: OfficialGhosttyColor;
  readonly background?: OfficialGhosttyColor;
  readonly cursor?: OfficialGhosttyColor;
  readonly palette?: readonly OfficialGhosttyColor[];
  readonly cursorStyle?: "bar" | "block" | "underline";
  readonly cursorBlink?: boolean;
  readonly terminfoName?: string;
  readonly onReply?: (bytes: Uint8Array) => void;
};

export interface OfficialGhosttyWasmExports extends WebAssembly.Exports {
  readonly memory: WebAssembly.Memory;
  readonly __indirect_function_table: WebAssembly.Table;
  ghostty_type_json(): number;
  ghostty_build_info(key: number, out: number): number;
  ghostty_wasm_alloc_opaque(): number;
  ghostty_wasm_free_opaque(pointer: number): void;
  ghostty_wasm_alloc_u8_array(length: number): number;
  ghostty_wasm_free_u8_array(pointer: number, length: number): void;
  ghostty_terminal_new(
    allocator: number,
    outTerminal: number,
    cols: number,
    rows: number,
  ): number;
  ghostty_terminal_free(terminal: number): void;
  ghostty_terminal_resize(
    terminal: number,
    cols: number,
    rows: number,
    cellWidthPx: number,
    cellHeightPx: number,
  ): number;
  ghostty_terminal_set(terminal: number, option: number, value: number): number;
  ghostty_terminal_get(terminal: number, data: number, out: number): number;
  ghostty_terminal_vt_write(
    terminal: number,
    data: number,
    length: number,
  ): void;
  ghostty_render_state_new(allocator: number, outState: number): number;
  ghostty_render_state_free(state: number): void;
  ghostty_render_state_update(state: number, terminal: number): number;
  ghostty_render_state_get(state: number, data: number, out: number): number;
  ghostty_render_state_set(
    state: number,
    option: number,
    value: number,
  ): number;
  ghostty_render_state_colors_get(state: number, out: number): number;
  ghostty_render_state_row_iterator_new(
    allocator: number,
    outIterator: number,
  ): number;
  ghostty_render_state_row_iterator_free(iterator: number): void;
  ghostty_render_state_row_iterator_next(iterator: number): boolean;
  ghostty_render_state_row_get(
    iterator: number,
    data: number,
    out: number,
  ): number;
  ghostty_render_state_row_set(
    iterator: number,
    option: number,
    value: number,
  ): number;
}
