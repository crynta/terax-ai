import {
  detectTerminalLinks,
  type TerminalTextLink,
} from "@/modules/terminal/ghostty/core/terminalLinks";
import type {
  PackedTerminalViewport,
  TerminalCursor,
  TerminalDamage,
  TerminalModelDiagnostics,
  TerminalModes,
  TerminalRowRange,
} from "@/modules/terminal/backend/contracts";
import type {
  TeraxGhostty,
  TeraxGhosttyRenderState,
  TeraxGhosttyTerminal,
} from "@terax/ghostty-core/adapted";
import type {
  GhosttyTerminalConfig,
  GhosttyTerminalEvent,
  KeyEvent,
} from "@terax/ghostty-core/protocol";
import { CellFlags } from "@terax/ghostty-core/protocol";
import { PromptPresentationGate } from "./core/PromptPresentationGate";
import {
  CELL_STRIDE,
  type Rgb,
  type TerminalCellReader,
} from "./core/packedCells";
import { SynchronizedOutputPresentationGate } from "./core/SynchronizedOutputPresentationGate";
import { clearTerminalBufferSequence } from "./core/terminalActions";
import type {
  GhosttySearchStatus,
  GhosttySearchViewportSpan,
  GhosttyTerminalModelApi,
  GhosttyTerminalModelOptions,
  TerminalBufferPoint,
  TerminalBufferSelection,
} from "./GhosttyTerminalModel";

const MAX_DIMENSION = 4_096;
const MAX_CELLS = 1_048_576;
const MIN_SCROLLBACK_BYTES = 1024 * 1024;
const MAX_SCROLLBACK_BYTES = 64 * 1024 * 1024;
const APPROXIMATE_BYTES_PER_SCROLLBACK_CELL = 8;
const NO_DAMAGE: TerminalDamage = { kind: "none" };
const FULL_DAMAGE: TerminalDamage = { kind: "full" };

type BufferLine = {
  readonly cells: string[];
  readonly wrapped: boolean;
};

type ScrollPosition = {
  readonly offset: number;
  readonly history: number;
};

const DEFAULT_MODES: TerminalModes = Object.freeze({
  alternateScreen: false,
  bracketedPaste: false,
  focusReporting: false,
  mouseTracking: false,
  synchronizedOutput: false,
});

/**
 * Terax-owned model adapter for the current Ghostty terminal and render-state
 * implementation. The terminal model is independent from GPU surfaces so it
 * survives RendererPool lease release and keeps parsing hidden-tab output.
 */
export class AdaptedGhosttyTerminalModel implements GhosttyTerminalModelApi {
  readonly backend: GhosttyTerminalModelOptions["backend"];

  private readonly terminal: TeraxGhosttyTerminal;
  private plainLinks: {
    revision: number;
    origin: number;
    cols: number;
    startRow: number;
    endRow: number;
    offsets: number[];
    links: TerminalTextLink[];
  } | null = null;
  private blockMatch: { line: number; col: number; len: number } | null = null;
  private readonly directCellReader = new GhosttyRenderCellView();
  private readonly damageListeners = new Set<() => void>();
  private replySink: ((bytes: Uint8Array) => void) | null;
  private eventSink: ((event: GhosttyTerminalEvent) => void) | null;
  private onDispose: (() => void) | null;
  private pendingDamage: TerminalDamage = FULL_DAMAGE;
  private renderState: TeraxGhosttyRenderState | null = null;
  private renderStateCurrent = false;
  private packedViewport = new Uint8Array(0);
  private packedRenderVersion = -1;
  private renderVersion = 0;
  private contentRevision = 0;
  private writeCount = 0;
  private renderStateUpdateCount = 0;
  private presentationResourcesReleased = false;
  private damageNotificationPending = false;
  private damageNeedsResolution = false;
  private modeBitsValue = 0;
  private modesValue = DEFAULT_MODES;
  private scrollPositionValue: ScrollPosition = { offset: 0, history: 0 };
  private scrollPositionCurrent = false;
  private readonly promptPresentation: PromptPresentationGate;
  private readonly synchronizedOutputPresentation: SynchronizedOutputPresentationGate;
  private colsValue: number;
  private rowsValue: number;
  private disposed = false;

  constructor(ghostty: TeraxGhostty, options: GhosttyTerminalModelOptions) {
    validateDimensions(options.cols, options.rows);
    this.backend = options.backend;
    this.colsValue = options.cols;
    this.rowsValue = options.rows;
    this.replySink = options.onReply ?? null;
    this.eventSink = options.onEvent ?? null;
    this.onDispose = options.onDispose ?? null;

    const scrollbackLines = normalizeScrollbackLines(
      options.config?.scrollbackLimit,
    );
    this.terminal = ghostty.createTerminal(options.cols, options.rows, {
      maxScrollbackLines: scrollbackLines,
      maxScrollbackBytes: scrollbackBytes(scrollbackLines, options.cols),
    });
    this.promptPresentation = new PromptPresentationGate(() =>
      this.requestPresentation(),
    );
    this.synchronizedOutputPresentation =
      new SynchronizedOutputPresentationGate(() => this.notifyDamage());
    try {
      this.applyConfig(options.config);
    } catch (error) {
      this.terminal.dispose();
      throw error;
    }
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  get cols(): number {
    this.assertLive();
    return this.colsValue;
  }

  get rows(): number {
    this.assertLive();
    return this.rowsValue;
  }

  presentationSuppressed(): boolean {
    this.assertLive();
    return (
      this.promptPresentation.suppressed ||
      this.synchronizedOutputPresentation.suppressed
    );
  }

  deferPresentation(): boolean {
    this.assertLive();
    if (!this.presentationSuppressed()) return false;
    this.damageNotificationPending = false;
    return true;
  }

  releasePresentationResources(): void {
    this.assertLive();
    if (this.presentationResourcesReleased) return;
    this.plainLinks = null;
    this.renderState = null;
    this.directCellReader.clear();
    this.renderStateCurrent = false;
    this.packedViewport = new Uint8Array(0);
    this.packedRenderVersion = -1;
    this.terminal.releaseRenderState();
    this.presentationResourcesReleased = true;
    this.pendingDamage = FULL_DAMAGE;
    this.damageNeedsResolution = false;
  }

  compactPresentationResources(): void {
    this.assertLive();
    this.directCellReader.clear();
    this.terminal.compactRenderState();
    this.renderState = null;
    this.renderStateCurrent = false;
    this.packedViewport = new Uint8Array(0);
    this.packedRenderVersion = -1;
    this.pendingDamage = FULL_DAMAGE;
    this.damageNeedsResolution = false;
  }

  setColors(
    foreground: number,
    background: number,
    cursor: number,
    palette: readonly number[],
  ): boolean {
    this.assertLive();
    this.terminal.setDefaultColors(foreground, background, cursor);
    this.terminal.setPalette(encodePalette(palette));
    this.invalidateRenderState();
    this.pendingDamage = FULL_DAMAGE;
    this.notifyDamage();
    return true;
  }

  write(bytes: Uint8Array): void {
    this.assertLive();
    if (bytes.byteLength === 0) return;

    this.blockMatch = null;
    this.terminal.write(bytes);
    this.writeCount += 1;
    this.contentRevision += 1;
    this.scrollPositionCurrent = false;
    this.invalidateRenderState();
    this.damageNeedsResolution = true;
    this.refreshModes();
    this.drainReplies();
    this.drainEvents();
    this.synchronizedOutputPresentation.observe(
      this.modesValue.synchronizedOutput,
    );
    this.requestPresentation();
  }

  resize(cols: number, rows: number): void {
    this.assertLive();
    validateDimensions(cols, rows);
    if (cols === this.colsValue && rows === this.rowsValue) return;

    this.terminal.resize(cols, rows);
    this.blockMatch = null;
    this.colsValue = cols;
    this.rowsValue = rows;
    this.contentRevision += 1;
    this.scrollPositionCurrent = false;
    this.invalidateRenderState();
    this.pendingDamage = FULL_DAMAGE;
    this.notifyDamage();
  }

  setPixelSize(widthPx: number, heightPx: number): void {
    this.assertLive();
    if (widthPx <= 0 || heightPx <= 0) return;
    this.terminal.setPixelSize(widthPx, heightPx);
  }

  setSearchQuery(query: string): GhosttySearchStatus {
    this.assertLive();
    return this.terminal.setSearchQuery(query);
  }

  clearSearch(): void {
    this.assertLive();
    this.terminal.clearSearch();
  }

  stepSearch(budget?: number): GhosttySearchStatus {
    this.assertLive();
    return this.terminal.stepSearch(budget);
  }

  selectSearchMatch(direction: "next" | "previous"): GhosttySearchStatus {
    this.assertLive();
    const status = this.terminal.selectSearchMatch(direction);
    this.invalidateRenderState();
    this.pendingDamage = FULL_DAMAGE;
    this.notifyDamage();
    return status;
  }

  searchViewportMatches(): readonly GhosttySearchViewportSpan[] {
    this.assertLive();
    const spans = this.terminal.searchViewportMatches();
    const match = this.blockMatch;
    if (!match) return spans;
    const row = match.line - this.viewportOriginLine();
    if (row < 0 || row >= this.rows) return spans;
    return [
      ...spans,
      {
        row,
        startColumn: match.col,
        endColumn: match.col + match.len,
        selected: true,
      },
    ];
  }

  consumeDamage(): TerminalDamage {
    this.assertLive();
    let damage = this.pendingDamage;
    if (this.damageNeedsResolution) {
      damage = mergeDamage(
        damage,
        damageFromRenderState(this.ensureRenderState()),
      );
    } else if (damage.kind !== "none") {
      this.ensureRenderState();
    }
    this.pendingDamage = NO_DAMAGE;
    this.damageNeedsResolution = false;
    this.damageNotificationPending = false;
    return damage;
  }

  viewport(): PackedTerminalViewport {
    this.assertLive();
    const state = this.ensureRenderState();
    if (this.packedRenderVersion !== this.renderVersion) {
      this.packRenderState(state);
      this.packedRenderVersion = this.renderVersion;
    }
    return {
      bytes: this.packedViewport,
      cellCount: state.cellCount,
      cellStride: CELL_STRIDE,
      cols: state.cols,
      rows: state.rows,
    };
  }

  renderCells(): TerminalCellReader {
    this.assertLive();
    this.directCellReader.update(this.ensureRenderState());
    return this.directCellReader;
  }

  cursor(): TerminalCursor {
    this.assertLive();
    const cursor = this.ensureRenderState().cursor;
    return {
      x: cursor.column,
      y: cursor.row,
      visible: cursor.visible,
      blinking: cursor.blinking,
      style: cursor.style,
    };
  }

  setCursorOptions(
    style: "block" | "underline" | "bar",
    blinking: boolean,
  ): void {
    this.assertLive();
    this.terminal.setCursorOptions(style, blinking);
    this.invalidateRenderState();
    this.pendingDamage = FULL_DAMAGE;
    this.notifyDamage();
  }

  grapheme(row: number, column: number): string {
    this.assertLive();
    if (
      row < 0 ||
      row >= this.rowsValue ||
      column < 0 ||
      column >= this.colsValue
    ) {
      return "";
    }
    const state = this.ensureRenderState();
    return this.terminal.graphemeAt(state, row * state.cols + column);
  }

  hyperlinkAtViewportCell(row: number, column: number): string | null {
    this.assertLive();
    if (
      row < 0 ||
      row >= this.rowsValue ||
      column < 0 ||
      column >= this.colsValue
    ) {
      return null;
    }
    const state = this.ensureRenderState();
    const explicit = this.terminal.hyperlinkAt(
      state,
      row * state.cols + column,
    );
    if (explicit) return explicit;
    const origin = this.viewportOriginLine();
    let cache = this.plainLinks;
    if (
      !cache ||
      cache.revision !== this.contentRevision ||
      cache.origin !== origin ||
      cache.cols !== state.cols ||
      row < cache.startRow ||
      row > cache.endRow
    ) {
      let startRow = row;
      let endRow = row;
      while (startRow > 0 && row - startRow < 8 && state.rowWrapped[startRow])
        startRow--;
      while (
        endRow + 1 < state.rows &&
        endRow - startRow < 8 &&
        state.rowWrapped[endRow + 1]
      )
        endRow++;
      let text = "";
      const offsets: number[] = [];
      for (let y = startRow; y <= endRow; y++) {
        for (let x = 0; x < state.cols; x++) {
          offsets.push(text.length);
          const index = y * state.cols + x;
          if (state.widths[index] !== 2 && state.widths[index] !== 3)
            text += this.terminal.graphemeAt(state, index) || " ";
        }
      }
      cache = {
        revision: this.contentRevision,
        origin,
        cols: state.cols,
        startRow,
        endRow,
        offsets,
        links: detectTerminalLinks(text),
      };
      this.plainLinks = cache;
    }
    const offset = cache.offsets[(row - cache.startRow) * state.cols + column];
    return (
      cache.links.find((link) => offset >= link.start && offset < link.end)
        ?.uri ?? null
    );
  }

  scrollPosition(): ScrollPosition {
    this.assertLive();
    if (this.scrollPositionCurrent) return this.scrollPositionValue;
    this.scrollPositionValue = scrollPositionFromScrollbar(
      this.terminal.scrollbar(),
    );
    this.scrollPositionCurrent = true;
    return this.scrollPositionValue;
  }

  scrollBy(lines: number): boolean {
    this.assertLive();
    if (!Number.isFinite(lines) || lines === 0) return false;
    return this.scrollTo(this.scrollPosition().offset - Math.trunc(lines));
  }

  scrollTo(offset: number): boolean {
    this.assertLive();
    const current = this.scrollPosition();
    const next = this.modes().alternateScreen
      ? 0
      : clampInteger(Math.round(offset), 0, current.history);
    if (next === current.offset) return false;

    this.terminal.scrollViewportTo(current.history - next);
    this.scrollPositionValue = { offset: next, history: current.history };
    this.scrollPositionCurrent = true;
    this.invalidateRenderState();
    this.pendingDamage = FULL_DAMAGE;
    this.notifyDamage();
    return true;
  }

  scrollToBottom(): boolean {
    return this.scrollTo(0);
  }

  clear(): void {
    this.assertLive();
    this.setSelection(null);
    this.write(clearTerminalBufferSequence(this.cursor()));
  }

  revision(): number {
    this.assertLive();
    return this.contentRevision;
  }

  viewportOriginLine(): number {
    this.assertLive();
    return this.terminal.scrollbar().offset;
  }

  bufferLineAtViewportRow(row: number): number {
    this.assertLive();
    return (
      this.viewportOriginLine() +
      clampInteger(row, 0, Math.max(0, this.rowsValue - 1))
    );
  }

  enableSemanticMarkers(enabled: boolean): void {
    this.assertLive();
    this.terminal.enableSemanticMarkers(enabled);
  }

  semanticMarkerColumn(id: number): number | null {
    this.assertLive();
    return this.terminal.semanticMarkerColumn(id);
  }

  semanticMarkerLine(id: number): number | null {
    this.assertLive();
    return this.terminal.semanticMarkerLine(id);
  }

  readTextRange(
    startLine: number,
    endLine: number,
    startCol?: number,
    endCol?: number,
  ): string {
    this.assertLive();
    return this.terminal.readTextRange(startLine, endLine, startCol, endCol);
  }

  blockSearchActive(): boolean {
    return this.blockMatch !== null;
  }

  setBlockSearchMatch(
    match: { line: number; col: number; len: number } | null,
  ): void {
    this.blockMatch = match;
    this.pendingDamage = FULL_DAMAGE;
    this.notifyDamage();
  }

  readCellLine(line: number): readonly string[] {
    return this.readBufferLine(line).cells;
  }

  bufferCursorLine(): number {
    this.assertLive();
    return this.terminal.bufferCursorLine();
  }

  wordRangeAt(point: TerminalBufferPoint): {
    readonly start: number;
    readonly end: number;
  } {
    this.assertLive();
    const cells = this.readBufferLine(point.line).cells;
    const column = clampInteger(point.column, 0, this.colsValue - 1);
    const category = wordCategory(cells[column] ?? "");
    let start = column;
    let end = column;
    while (start > 0 && wordCategory(cells[start - 1] ?? "") === category) {
      start -= 1;
    }
    while (
      end + 1 < this.colsValue &&
      wordCategory(cells[end + 1] ?? "") === category
    ) {
      end += 1;
    }
    return { start, end };
  }

  lineEndColumn(line: number): number {
    this.assertLive();
    const cells = this.readBufferLine(line).cells;
    for (let column = cells.length - 1; column >= 0; column -= 1) {
      if (cells[column].trim() !== "") return column;
    }
    return 0;
  }

  selectionText(selection: TerminalBufferSelection): string {
    this.assertLive();
    if (this.terminal.selection()) return this.terminal.selectionText();
    const normalized = normalizeBufferSelection(selection);
    const snapshots = this.readBufferLines(
      normalized.start.line,
      normalized.end.line,
    );
    const lines: string[] = [];

    for (
      let line = normalized.start.line;
      line <= normalized.end.line;
      line += 1
    ) {
      const snapshot = snapshots.get(line) ?? emptyBufferLine(this.colsValue);
      const startColumn = selection.rectangular
        ? normalized.left
        : line === normalized.start.line
          ? normalized.start.column
          : 0;
      const endColumn = selection.rectangular
        ? normalized.right
        : line === normalized.end.line
          ? normalized.end.column
          : this.colsValue - 1;
      let value = "";
      for (let column = startColumn; column <= endColumn; column += 1) {
        value += snapshot.cells[column] ?? "";
      }
      const text = value.trimEnd();
      if (lines.length > 0 && !selection.rectangular && snapshot.wrapped) {
        lines[lines.length - 1] += text;
      } else {
        lines.push(text);
      }
    }
    return lines.join("\n");
  }

  setSelection(selection: TerminalBufferSelection | null): void {
    this.assertLive();
    const previous = this.terminal.selection();
    this.terminal.setSelection(selection);
    const origin = this.viewportOriginLine();
    this.pendingDamage = mergeDamage(
      this.pendingDamage,
      mergeDamage(
        selectionDamage(previous, origin, this.rowsValue),
        selectionDamage(selection, origin, this.rowsValue),
      ),
    );
    this.notifyDamage();
  }

  trackedSelection(): TerminalBufferSelection | null {
    this.assertLive();
    return this.terminal.selection();
  }

  encodeKey(event: KeyEvent): Uint8Array {
    this.assertLive();
    return this.terminal.encodeKey(event);
  }

  mode(mode: number, isAnsi = false): boolean {
    this.assertLive();
    return this.terminal.mode(mode, isAnsi);
  }

  modes(): TerminalModes {
    this.assertLive();
    this.refreshModes();
    return this.modesValue;
  }

  private refreshModes(): void {
    const modeBits = this.terminal.modeBits();
    if (modeBits === this.modeBitsValue) return;
    this.modeBitsValue = modeBits;
    this.modesValue = modesFromBits(modeBits);
  }

  readText(maxLines: number): string {
    this.assertLive();
    const requestedLines = Math.max(0, Math.floor(maxLines));
    if (requestedLines === 0) return "";

    const scrollbar = this.terminal.scrollbar();
    const totalLines = scrollbar.total;
    const firstLine = Math.max(0, totalLines - requestedLines);
    return this.terminal.readTextRange(firstLine, totalLines - 1).trimEnd();
  }

  subscribeDamage(listener: () => void): () => void {
    this.assertLive();
    this.damageListeners.add(listener);
    return () => this.damageListeners.delete(listener);
  }

  setReplySink(sink: ((bytes: Uint8Array) => void) | null): void {
    this.assertLive();
    this.replySink = sink;
    if (sink) this.drainReplies();
  }

  diagnostics(): TerminalModelDiagnostics {
    const scrollbar = this.disposed
      ? { total: 0, length: 0 }
      : this.terminal.scrollbar();
    const resources = this.disposed ? null : this.terminal.resourceStats();
    return {
      backend: this.backend,
      cols: this.colsValue,
      rows: this.rowsValue,
      scrollbackLines: Math.max(0, scrollbar.total - scrollbar.length),
      disposed: this.disposed,
      writes: this.writeCount,
      renderStateUpdates: this.renderStateUpdateCount,
      bridgeCellCapacity: resources?.cellCapacity ?? 0,
      bridgeRowCapacity: resources?.rowCapacity ?? 0,
      renderStateResets: resources?.renderStateResets ?? 0,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.damageListeners.clear();
    this.replySink = null;
    this.eventSink = null;
    this.renderState = null;
    this.directCellReader.clear();
    this.plainLinks = null;
    this.blockMatch = null;
    this.packedViewport = new Uint8Array(0);
    this.promptPresentation.dispose();
    this.synchronizedOutputPresentation.dispose();
    this.terminal.dispose();
    const callback = this.onDispose;
    this.onDispose = null;
    callback?.();
  }

  private applyConfig(config: GhosttyTerminalConfig | undefined): void {
    if (!config) return;
    if (
      config.fgColor !== undefined ||
      config.bgColor !== undefined ||
      config.cursorColor !== undefined
    ) {
      this.terminal.setDefaultColors(
        config.fgColor ?? 0xffff_ffff,
        config.bgColor ?? 0xffff_ffff,
        config.cursorColor ?? 0xffff_ffff,
      );
    }
    if (config.palette && config.palette.length > 0) {
      this.terminal.setPalette(encodePalette(config.palette));
    }
    if (config.cursorStyle !== undefined || config.cursorBlink !== undefined) {
      this.terminal.setCursorOptions(
        config.cursorStyle ?? "block",
        config.cursorBlink ?? false,
      );
    }
  }

  private ensureRenderState(): TeraxGhosttyRenderState {
    const state = this.renderState;
    if (
      !this.renderStateCurrent ||
      !state ||
      state.codepoints.buffer.byteLength === 0
    ) {
      this.renderState = this.terminal.updateRenderState();
      this.renderStateCurrent = true;
      this.renderVersion += 1;
      this.renderStateUpdateCount += 1;
      this.presentationResourcesReleased = false;
    }
    const current = this.renderState;
    if (!current) throw new Error("Ghostty render state is unavailable");
    return current;
  }

  private invalidateRenderState(): void {
    this.renderStateCurrent = false;
  }

  private packRenderState(state: TeraxGhosttyRenderState): void {
    const byteLength = state.cellCount * CELL_STRIDE;
    if (this.packedViewport.byteLength !== byteLength) {
      this.packedViewport = new Uint8Array(byteLength);
    }
    const bytes = this.packedViewport;
    const words = new Uint32Array(
      bytes.buffer,
      bytes.byteOffset,
      byteLength / 4,
    );
    const halves = new Uint16Array(
      bytes.buffer,
      bytes.byteOffset,
      byteLength / 2,
    );

    for (let index = 0; index < state.cellCount; index += 1) {
      const cellOffset = index * CELL_STRIDE;
      const colorOffset = index * 4;
      words[index * 4] = state.codepoints[index];
      bytes[cellOffset + 4] = state.foregroundRgba[colorOffset];
      bytes[cellOffset + 5] = state.foregroundRgba[colorOffset + 1];
      bytes[cellOffset + 6] = state.foregroundRgba[colorOffset + 2];
      bytes[cellOffset + 7] = state.backgroundRgba[colorOffset];
      bytes[cellOffset + 8] = state.backgroundRgba[colorOffset + 1];
      bytes[cellOffset + 9] = state.backgroundRgba[colorOffset + 2];
      bytes[cellOffset + 10] = rendererFlags(
        state.styleFlags[index],
        state.underlineStyles[index],
      );
      bytes[cellOffset + 11] = rendererWidth(state.widths[index]);
      halves[index * 8 + 6] = Math.min(0xffff, state.linkIds[index]);
      bytes[cellOffset + 14] = Math.min(0xff, state.graphemeLengths[index]);
      bytes[cellOffset + 15] = 0;
    }
  }

  private readBufferLine(line: number): BufferLine {
    const scrollbar = this.terminal.scrollbar();
    if (scrollbar.total === 0) return emptyBufferLine(this.colsValue);
    const safeLine = clampInteger(line, 0, scrollbar.total - 1);
    return (
      this.readBufferLines(safeLine, safeLine).get(safeLine) ??
      emptyBufferLine(this.colsValue)
    );
  }

  private readBufferLines(
    firstLine: number,
    lastLine: number,
  ): Map<number, BufferLine> {
    const result = new Map<number, BufferLine>();
    const initialScrollbar = this.terminal.scrollbar();
    if (initialScrollbar.total === 0 || lastLine < firstLine) return result;

    const first = clampInteger(firstLine, 0, initialScrollbar.total - 1);
    const last = clampInteger(lastLine, first, initialScrollbar.total - 1);
    const originalOffset = initialScrollbar.offset;
    const history = Math.max(
      0,
      initialScrollbar.total - initialScrollbar.length,
    );
    let line = first;
    try {
      while (line <= last) {
        this.terminal.scrollViewportTo(Math.min(line, history));
        const state = this.terminal.updateRenderState();
        this.renderStateUpdateCount += 1;
        this.presentationResourcesReleased = false;
        if (this.damageNeedsResolution) {
          this.pendingDamage = mergeDamage(
            this.pendingDamage,
            damageFromRenderState(state),
          );
        }
        const viewportOffset = this.terminal.scrollbar().offset;
        const firstRow = Math.max(0, line - viewportOffset);
        const lastRow = Math.min(state.rows - 1, last - viewportOffset);
        if (firstRow > lastRow) break;
        for (let row = firstRow; row <= lastRow; row += 1) {
          result.set(
            viewportOffset + row,
            snapshotRow(this.terminal, state, row),
          );
        }
        const next = viewportOffset + lastRow + 1;
        if (next <= line) break;
        line = next;
      }
    } finally {
      this.terminal.scrollViewportTo(originalOffset);
      this.scrollPositionValue = scrollPositionFromScrollbar(initialScrollbar);
      this.scrollPositionCurrent = true;
      this.invalidateRenderState();
    }
    return result;
  }

  private drainReplies(): void {
    if (!this.replySink) return;
    const bytes = this.terminal.drainOutputBytes();
    if (bytes.byteLength > 0) this.replySink(bytes);
  }

  private drainEvents(): void {
    const events = this.terminal.drainEvents();
    for (const event of events) {
      this.promptPresentation.observe(event);
      this.eventSink?.(event);
    }
  }

  private requestPresentation(): void {
    if (this.presentationSuppressed()) return;
    this.notifyDamage();
  }

  private notifyDamage(): void {
    if (
      this.promptPresentation.suppressed ||
      this.synchronizedOutputPresentation.suppressed ||
      this.damageNotificationPending ||
      this.damageListeners.size === 0
    ) {
      return;
    }
    this.damageNotificationPending = true;
    for (const listener of this.damageListeners) listener();
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("Ghostty terminal model is disposed");
  }
}

class GhosttyRenderCellView implements TerminalCellReader {
  private state: TeraxGhosttyRenderState | null = null;

  get length(): number {
    return this.current().cellCount;
  }

  update(state: TeraxGhosttyRenderState): void {
    this.state = state;
  }

  clear(): void {
    this.state = null;
  }

  codepoint(index: number): number {
    return this.current().codepoints[index];
  }

  flags(index: number): number {
    const state = this.current();
    return rendererFlags(state.styleFlags[index], state.underlineStyles[index]);
  }

  width(index: number): number {
    return rendererWidth(this.current().widths[index]);
  }

  graphemeLength(index: number): number {
    return this.current().graphemeLengths[index];
  }

  underlineStyle(index: number): number {
    return this.current().underlineStyles[index];
  }

  underlineColorPacked(index: number): number {
    return packedRgb(this.current().underlineRgba, index * 4);
  }

  overline(index: number): boolean {
    return (this.current().styleFlags[index] & (1 << 7)) !== 0;
  }

  foreground(index: number): Rgb {
    const state = this.current();
    const offset = index * 4;
    return [
      state.foregroundRgba[offset],
      state.foregroundRgba[offset + 1],
      state.foregroundRgba[offset + 2],
    ];
  }

  foregroundPacked(index: number): number {
    return packedRgb(this.current().foregroundRgba, index * 4);
  }

  background(index: number): Rgb {
    const state = this.current();
    const offset = index * 4;
    return [
      state.backgroundRgba[offset],
      state.backgroundRgba[offset + 1],
      state.backgroundRgba[offset + 2],
    ];
  }

  backgroundPacked(index: number): number {
    return packedRgb(this.current().backgroundRgba, index * 4);
  }

  private current(): TeraxGhosttyRenderState {
    if (!this.state) throw new Error("Ghostty render cells are unavailable");
    return this.state;
  }
}

function snapshotRow(
  terminal: TeraxGhosttyTerminal,
  state: TeraxGhosttyRenderState,
  row: number,
): BufferLine {
  const cells = new Array<string>(state.cols);
  const rowOffset = row * state.cols;
  for (let column = 0; column < state.cols; column += 1) {
    const index = rowOffset + column;
    if (rendererWidth(state.widths[index]) === 0) {
      cells[column] = "";
    } else if (state.graphemeLengths[index] > 0) {
      cells[column] = terminal.graphemeAt(state, index);
    } else {
      const codepoint = state.codepoints[index];
      cells[column] = codepoint === 0 ? " " : String.fromCodePoint(codepoint);
    }
  }
  return { cells, wrapped: state.rowWrapped[row] !== 0 };
}

function emptyBufferLine(cols: number): BufferLine {
  return { cells: Array.from({ length: cols }, () => ""), wrapped: false };
}

function rendererWidth(width: number): number {
  if (width === 1) return 2;
  if (width === 2 || width === 3) return 0;
  return 1;
}

function rendererFlags(style: number, underlineStyle: number): number {
  let flags = 0;
  if ((style & (1 << 0)) !== 0) flags |= CellFlags.BOLD;
  if ((style & (1 << 1)) !== 0) flags |= CellFlags.ITALIC;
  if ((style & (1 << 2)) !== 0) flags |= CellFlags.FAINT;
  if ((style & (1 << 3)) !== 0) flags |= CellFlags.BLINK;
  if ((style & (1 << 4)) !== 0) flags |= CellFlags.INVERSE;
  if ((style & (1 << 5)) !== 0) flags |= CellFlags.INVISIBLE;
  if ((style & (1 << 6)) !== 0) flags |= CellFlags.STRIKETHROUGH;
  if (underlineStyle !== 0) flags |= CellFlags.UNDERLINE;
  return flags;
}

function packedRgb(colors: Uint8Array, offset: number): number {
  return (
    (colors[offset] << 16) | (colors[offset + 1] << 8) | colors[offset + 2]
  );
}

function encodePalette(palette: readonly number[]): Uint8Array {
  const colors = new Uint8Array(Math.min(256, palette.length) * 3);
  for (let index = 0; index < colors.byteLength / 3; index += 1) {
    const color = palette[index] >>> 0;
    colors[index * 3] = (color >>> 16) & 0xff;
    colors[index * 3 + 1] = (color >>> 8) & 0xff;
    colors[index * 3 + 2] = color & 0xff;
  }
  return colors;
}

function damageFromRenderState(state: TeraxGhosttyRenderState): TerminalDamage {
  if (state.fullDamage) return FULL_DAMAGE;
  const ranges: TerminalRowRange[] = [];
  let first = -1;
  for (let row = 0; row < state.rows; row += 1) {
    if (state.dirtyRows[row] !== 0) {
      if (first < 0) first = row;
    } else if (first >= 0) {
      ranges.push({ start: first, end: row - 1 });
      first = -1;
    }
  }
  if (first >= 0) ranges.push({ start: first, end: state.rows - 1 });
  return ranges.length === 0 ? NO_DAMAGE : { kind: "rows", ranges };
}

function mergeDamage(
  previous: TerminalDamage,
  next: TerminalDamage,
): TerminalDamage {
  if (previous.kind === "full" || next.kind === "full") return FULL_DAMAGE;
  if (previous.kind === "none") return next;
  if (next.kind === "none") return previous;
  const sorted = [...previous.ranges, ...next.ranges].sort(
    (a, b) => a.start - b.start,
  );
  const ranges: TerminalRowRange[] = [];
  for (const range of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && range.start <= last.end + 1)
      ranges[ranges.length - 1] = {
        start: last.start,
        end: Math.max(last.end, range.end),
      };
    else ranges.push(range);
  }
  return { kind: "rows", ranges };
}

function selectionDamage(
  selection: TerminalBufferSelection | null,
  origin: number,
  rows: number,
): TerminalDamage {
  if (!selection) return NO_DAMAGE;
  const start = Math.max(
    0,
    Math.min(selection.anchor.line, selection.focus.line) - origin,
  );
  const end = Math.min(
    rows - 1,
    Math.max(selection.anchor.line, selection.focus.line) - origin,
  );
  return start > end ? NO_DAMAGE : { kind: "rows", ranges: [{ start, end }] };
}

function modesFromBits(bits: number): TerminalModes {
  if (bits === 0) return DEFAULT_MODES;
  return Object.freeze({
    alternateScreen: (bits & (1 << 0)) !== 0,
    bracketedPaste: (bits & (1 << 1)) !== 0,
    focusReporting: (bits & (1 << 2)) !== 0,
    mouseTracking: (bits & (1 << 3)) !== 0,
    synchronizedOutput: (bits & (1 << 4)) !== 0,
  });
}

function scrollPositionFromScrollbar(scrollbar: {
  readonly total: number;
  readonly length: number;
  readonly offset: number;
}): ScrollPosition {
  const history = Math.max(0, scrollbar.total - scrollbar.length);
  return {
    offset: Math.max(0, history - Math.min(history, scrollbar.offset)),
    history,
  };
}

function normalizeScrollbackLines(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 10_000;
  return clampInteger(Math.round(value), 1, 100_000);
}

function scrollbackBytes(lines: number, cols: number): number {
  return clampInteger(
    lines * cols * APPROXIMATE_BYTES_PER_SCROLLBACK_CELL,
    MIN_SCROLLBACK_BYTES,
    MAX_SCROLLBACK_BYTES,
  );
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

function normalizeBufferSelection(selection: TerminalBufferSelection): {
  readonly start: TerminalBufferPoint;
  readonly end: TerminalBufferPoint;
  readonly left: number;
  readonly right: number;
} {
  const anchorFirst =
    selection.anchor.line < selection.focus.line ||
    (selection.anchor.line === selection.focus.line &&
      selection.anchor.column <= selection.focus.column);
  const start = anchorFirst ? selection.anchor : selection.focus;
  const end = anchorFirst ? selection.focus : selection.anchor;
  return {
    start,
    end,
    left: Math.min(selection.anchor.column, selection.focus.column),
    right: Math.max(selection.anchor.column, selection.focus.column),
  };
}

function wordCategory(value: string): "space" | "word" | "punctuation" {
  if (/\s/u.test(value)) return "space";
  if (/^[\p{Letter}\p{Number}_]$/u.test(value)) return "word";
  return "punctuation";
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
