import type {
  TerminalBackendKind,
  TerminalDamage,
  TerminalModel,
  TerminalRowRange,
} from "@/modules/terminal/backend/contracts";
import type { TeraxGhosttyGpuGlyph } from "@terax/ghostty-core/adapted";
import type {
  GhosttyTerminalConfig,
  GhosttyTerminalEvent,
  KeyEvent,
} from "@terax/ghostty-core/protocol";
import type { TerminalCellReader } from "@/modules/terminal/ghostty/core/packedCells";

export type GhosttyTerminalModelOptions = {
  readonly backend: Extract<TerminalBackendKind, `ghostty-${string}`>;
  readonly cols: number;
  readonly rows: number;
  readonly config?: GhosttyTerminalConfig;
  readonly deviceAttributeFallback?: boolean;
  readonly onReply?: (bytes: Uint8Array) => void;
  readonly onEvent?: (event: GhosttyTerminalEvent) => void;
  readonly onDispose?: () => void;
};

export type TerminalBufferPoint = {
  readonly line: number;
  readonly column: number;
};

export type TerminalBufferSelection = {
  readonly anchor: TerminalBufferPoint;
  readonly focus: TerminalBufferPoint;
  readonly rectangular: boolean;
};

export type GhosttySearchStatus = {
  readonly active: boolean;
  readonly pending: boolean;
  readonly complete: boolean;
  readonly generation: number;
  readonly totalMatches: number;
  readonly selectedIndex: number;
};

export type GhosttySearchViewportSpan = {
  readonly row: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly selected: boolean;
};

/** Per-cell representation the model is currently producing. */
export type GhosttyRenderFormat = "soa" | "gpu";

export type GhosttyGpuGlyph = TeraxGhosttyGpuGlyph;

export type GhosttyGpuFrameOptions = {
  /**
   * The consumer has no glyph map or no uploaded cells for this model (a new
   * or re-leased surface): report full damage and deliver the complete glyph
   * table in `newGlyphs`, not only the delta.
   */
  readonly resync?: boolean;
};

/**
 * Everything a GPU renderer needs for one frame, produced by
 * `GhosttyTerminalModelApi.consumeGpuFrame()`. Cell records are 16 bytes per
 * cell; see `@terax/ghostty-core/adapted` (`GPU_CELL_*`, `decodeGpuCell`) for
 * the exact word layout. `cells` and `memory.buffer` are borrowed: use them
 * synchronously (for example `queue.writeBuffer`) before the next call into
 * the model, because any WASM allocation can replace `memory.buffer`.
 * Never store the frame, `cells` or `memory`: each model owns its WebAssembly
 * instance, and a retained reference keeps the whole linear memory alive after
 * `dispose()` (the engine only frees it once nothing references it).
 */
export type GhosttyGpuFrame = {
  readonly rows: number;
  readonly cols: number;
  /**
   * Glyph-id epoch. If it differs from the previous frame's, drop every
   * id-to-atlas mapping; `newGlyphs` then holds the whole table.
   */
  readonly epoch: number;
  /**
   * Upload every row: stored records are stale (first frame, resize, release
   * or compaction, new glyph epoch, format switch, resync). Scrolling and
   * palette changes are not `fullDamage`: every row is re-encoded natively and
   * only rows whose bytes changed appear in `dirtyRanges`.
   */
  readonly fullDamage: boolean;
  /**
   * Inclusive, sorted, coalesced row ranges whose records changed since the
   * previous consumed frame. `[{ start: 0, end: rows - 1 }]` on `fullDamage`;
   * empty when no record changed (redundant rewrites are filtered natively).
   */
  readonly dirtyRanges: readonly TerminalRowRange[];
  /**
   * Redraw damage, a superset of `dirtyRanges`: it also covers overlay state
   * that never alters records (selection rows, block-search match, cursor
   * options). `kind === "none"` means nothing needs drawing.
   */
  readonly damage: TerminalDamage;
  /** `rows * cols * 16` bytes of cell records, a view into `memory.buffer`. */
  readonly cells: Uint8Array;
  /** The WASM linear memory backing `cells`, for zero-copy `writeBuffer`. */
  readonly memory: WebAssembly.Memory;
  /** Visible cells that blink and draw a glyph; arm the blink timer only if > 0. */
  readonly blinkingCells: number;
  /** Glyphs interned in this epoch (valid ids are `1..glyphCount`). */
  readonly glyphCount: number;
  /** Glyphs to rasterize/map before drawing this frame. Owned copies. */
  readonly newGlyphs: readonly GhosttyGpuGlyph[];
};

export interface GhosttyTerminalModelApi extends TerminalModel {
  isDisposed?(): boolean;
  /**
   * The cell format the model currently produces. Models start as `"soa"`.
   * `consumeGpuFrame()` switches to `"gpu"`; `renderCells()`, `viewport()`
   * and `consumeDamage()` switch back to `"soa"`. Each switch releases the
   * other format's buffers and forces full damage, so a surface should stick
   * to one format.
   */
  renderFormat(): GhosttyRenderFormat;
  /**
   * GPU-format equivalent of `consumeDamage()` + `renderCells()`: updates the
   * render state if output arrived, resets pending damage, and returns the
   * packed cell records with exact dirty rows and newly interned glyphs.
   * Call `deferPresentation()` first, exactly as for the SoA path; this method
   * does not itself honor synchronized-output suppression.
   */
  consumeGpuFrame(options?: GhosttyGpuFrameOptions): GhosttyGpuFrame;
  renderCells(): TerminalCellReader;
  presentationSuppressed(): boolean;
  deferPresentation(): boolean;
  /** App lab only: a resize erased the prompt and the shell has not printed it again. */
  promptErased?(): boolean;
  releasePresentationResources(): void;
  compactPresentationResources(): void;
  setColors(
    foreground: number,
    background: number,
    cursor: number,
    palette: readonly number[],
  ): boolean;
  setPixelSize(widthPx: number, heightPx: number): void;
  setSearchQuery(query: string): GhosttySearchStatus;
  clearSearch(): void;
  stepSearch(budget?: number): GhosttySearchStatus;
  selectSearchMatch(direction: "next" | "previous"): GhosttySearchStatus;
  searchViewportMatches(): readonly GhosttySearchViewportSpan[];
  setCursorOptions(
    style: "block" | "underline" | "bar",
    blinking: boolean,
  ): void;
  grapheme(row: number, column: number): string;
  hyperlinkAtViewportCell(row: number, column: number): string | null;
  scrollPosition(): { readonly offset: number; readonly history: number };
  scrollBy(lines: number): boolean;
  scrollTo(offset: number): boolean;
  scrollToBottom(): boolean;
  clear(): void;
  revision(): number;
  viewportOriginLine(): number;
  bufferLineAtViewportRow(row: number): number;
  wordRangeAt(point: TerminalBufferPoint): {
    readonly start: number;
    readonly end: number;
  };
  lineEndColumn(line: number): number;
  selectionText(selection: TerminalBufferSelection): string;
  setSelection?(selection: TerminalBufferSelection | null): void;
  trackedSelection?(): TerminalBufferSelection | null;
  encodeKey(event: KeyEvent): Uint8Array;
  mode(mode: number, isAnsi?: boolean): boolean;
  setReplySink(sink: ((bytes: Uint8Array) => void) | null): void;
  enableSemanticMarkers?(enabled: boolean): void;
  semanticMarkerColumn?(id: number): number | null;
  semanticMarkerLine?(id: number): number | null;
  readTextRange?(
    startLine: number,
    endLine: number,
    startCol?: number,
    endCol?: number,
  ): string;
  bufferCursorLine?(): number;
  readCellLine?(line: number): readonly string[];
  blockSearchActive?(): boolean;
  setBlockSearchMatch?(
    match: { line: number; col: number; len: number } | null,
  ): void;
}
