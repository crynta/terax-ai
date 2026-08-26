import type {
  PackedTerminalViewport,
  TerminalBackendKind,
  TerminalCursor,
  TerminalDamage,
  TerminalModel,
  TerminalModelDiagnostics,
  TerminalModes,
  TerminalRowRange,
} from "@/modules/terminal/backend/contracts";
import {
  DirtyState,
  type Ghostty,
  type GhosttyCell,
  type GhosttyTerminal,
  type GhosttyTerminalConfig,
  type GhosttyTerminalEvent,
  type KeyEncoder,
  KeyEncoderOption,
  type KeyEvent,
} from "@terax/ghostty-core";
import { PromptPresentationGate } from "./core/PromptPresentationGate";
import {
  CELL_STRIDE,
  PackedCellView,
  type TerminalCellReader,
} from "./core/packedCells";
import { SynchronizedOutputPresentationGate } from "./core/SynchronizedOutputPresentationGate";
import { TerminalQueryFallback } from "./core/TerminalQueryFallback";
import { clearTerminalBufferSequence } from "./core/terminalActions";

const MAX_DIMENSION = 4_096;
const MAX_CELLS = 1_048_576;
const RESPONSE_DRAIN_BUDGET_BYTES = 64 * 1024;

const NO_DAMAGE: TerminalDamage = { kind: "none" };
const FULL_DAMAGE: TerminalDamage = { kind: "full" };

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

export interface GhosttyTerminalModelApi extends TerminalModel {
  renderCells(): TerminalCellReader;
  presentationSuppressed(): boolean;
  deferPresentation(): boolean;
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
}

export class GhosttyTerminalModel implements GhosttyTerminalModelApi {
  readonly backend: Extract<TerminalBackendKind, `ghostty-${string}`>;

  private readonly terminal: GhosttyTerminal;
  private readonly keyEncoder: KeyEncoder;
  private readonly queryFallback: TerminalQueryFallback | null;
  private readonly damageListeners = new Set<() => void>();
  private replySink: ((bytes: Uint8Array) => void) | null;
  private eventSink: ((event: GhosttyTerminalEvent) => void) | null;
  private onDispose: (() => void) | null;
  private pendingDamage: TerminalDamage = FULL_DAMAGE;
  private scrolledViewport = new Uint8Array(0);
  private scrollOffsetValue = 0;
  private responseDrainScheduled = false;
  private damageNotificationPending = false;
  private readonly promptPresentation: PromptPresentationGate;
  private readonly synchronizedOutputPresentation: SynchronizedOutputPresentationGate;
  private renderStateCurrent = false;
  private renderStateDirty: DirtyState = DirtyState.FULL;
  private writeCount = 0;
  private renderStateUpdateCount = 0;
  private cellReader: PackedCellView | null = null;
  private contentRevision = 0;
  private disposed = false;

  constructor(ghostty: Ghostty, options: GhosttyTerminalModelOptions) {
    validateDimensions(options.cols, options.rows);
    this.backend = options.backend;
    this.terminal = ghostty.createTerminal(
      options.cols,
      options.rows,
      options.config,
    );
    this.keyEncoder = ghostty.createKeyEncoder();
    this.queryFallback = options.deviceAttributeFallback
      ? new TerminalQueryFallback()
      : null;
    this.replySink = options.onReply ?? null;
    this.eventSink = options.onEvent ?? null;
    this.onDispose = options.onDispose ?? null;
    this.promptPresentation = new PromptPresentationGate(() =>
      this.notifyDamage(),
    );
    this.synchronizedOutputPresentation =
      new SynchronizedOutputPresentationGate(() => this.notifyDamage());
  }

  get cols(): number {
    return this.terminal.cols;
  }

  get rows(): number {
    return this.terminal.rows;
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

  setColors(
    _foreground: number,
    _background: number,
    _cursor: number,
    _palette: readonly number[],
  ): boolean {
    return false;
  }

  write(bytes: Uint8Array): void {
    this.assertLive();
    if (bytes.byteLength === 0) return;

    // Finish older replies before parsing newer PTY output. This preserves
    // protocol ordering even when a hostile stream exhausts one drain budget.
    if (this.responseDrainScheduled) this.drainReplies();
    const previousScrollbackLength =
      this.scrollOffsetValue > 0 ? this.terminal.getScrollbackLength() : 0;

    const fallbackReplies = this.queryFallback?.scan(bytes) ?? [];
    if (this.replySink && fallbackReplies.length > 0) {
      let offset = 0;
      for (const reply of fallbackReplies) {
        this.terminal.write(bytes.subarray(offset, reply.endOffset));
        this.drainReplies();
        this.replySink?.(reply.bytes.slice());
        offset = reply.endOffset;
      }
      this.terminal.write(bytes.subarray(offset));
    } else {
      this.terminal.write(bytes);
    }
    this.writeCount += 1;
    this.contentRevision += 1;
    this.renderStateCurrent = false;
    this.reconcileScrollOffset(previousScrollbackLength);
    this.drainReplies();
    this.drainEvents();
    this.synchronizedOutputPresentation.observe(this.terminal.getMode(2026));
    this.notifyDamage();
  }

  resize(cols: number, rows: number): void {
    this.assertLive();
    validateDimensions(cols, rows);
    if (cols === this.cols && rows === this.rows) return;
    this.terminal.resize(cols, rows);
    this.contentRevision += 1;
    this.renderStateCurrent = false;
    this.scrollOffsetValue = Math.min(
      this.scrollOffsetValue,
      this.terminal.getScrollbackLength(),
    );
    this.pendingDamage = FULL_DAMAGE;
    this.notifyDamage();
  }

  setPixelSize(_widthPx: number, _heightPx: number): void {}

  setSearchQuery(_query: string): GhosttySearchStatus {
    return emptySearchStatus();
  }

  clearSearch(): void {}

  stepSearch(_budget?: number): GhosttySearchStatus {
    return emptySearchStatus();
  }

  selectSearchMatch(_direction: "next" | "previous"): GhosttySearchStatus {
    return emptySearchStatus();
  }

  searchViewportMatches(): readonly GhosttySearchViewportSpan[] {
    return [];
  }

  consumeDamage(): TerminalDamage {
    this.assertLive();
    this.captureDamage(false);
    const damage = this.pendingDamage;
    this.pendingDamage = NO_DAMAGE;
    this.damageNotificationPending = false;
    if (damage.kind !== "none") {
      this.terminal.markClean();
      this.renderStateDirty = DirtyState.NONE;
    }
    return damage;
  }

  viewport(): PackedTerminalViewport {
    this.assertLive();
    this.ensureRenderState();
    if (this.scrollOffsetValue === 0) {
      return this.terminal.getPackedViewport();
    }

    const byteLength = this.cols * this.rows * CELL_STRIDE;
    if (this.scrolledViewport.byteLength < byteLength) {
      this.scrolledViewport = new Uint8Array(byteLength);
    }
    const target = this.scrolledViewport.subarray(0, byteLength);
    target.fill(0);

    const scrollbackLength = this.terminal.getScrollbackLength();
    this.scrollOffsetValue = Math.min(this.scrollOffsetValue, scrollbackLength);
    const firstLine = scrollbackLength - this.scrollOffsetValue;
    let targetRow = 0;

    for (
      let line = firstLine;
      line < scrollbackLength && targetRow < this.rows;
      line += 1
    ) {
      const packed = this.terminal.getPackedScrollbackLineSnapshot(line);
      if (packed) {
        const rowStart = targetRow * this.cols * CELL_STRIDE;
        target.set(packed.bytes.subarray(0, this.cols * CELL_STRIDE), rowStart);
      }
      targetRow += 1;
    }

    if (targetRow < this.rows) {
      const viewport = this.terminal.getPackedViewport();
      const activeBytes = (this.rows - targetRow) * this.cols * CELL_STRIDE;
      target.set(
        viewport.bytes.subarray(0, activeBytes),
        targetRow * this.cols * CELL_STRIDE,
      );
    }

    return {
      bytes: target,
      cellCount: this.cols * this.rows,
      cellStride: CELL_STRIDE,
      cols: this.cols,
      rows: this.rows,
    };
  }

  renderCells(): TerminalCellReader {
    const viewport = this.viewport();
    if (!this.cellReader || this.cellReader.bytes !== viewport.bytes) {
      this.cellReader = new PackedCellView(viewport.bytes);
    }
    return this.cellReader;
  }

  cursor(): TerminalCursor {
    this.assertLive();
    this.ensureRenderState();
    const cursor = this.terminal.getCursorSnapshot();
    return this.scrollOffsetValue > 0 ? { ...cursor, visible: false } : cursor;
  }

  setCursorOptions(
    style: "block" | "underline" | "bar",
    blinking: boolean,
  ): void {
    this.assertLive();
    this.terminal.setCursorOptions(style, blinking);
    this.renderStateCurrent = false;
    this.pendingDamage = FULL_DAMAGE;
    this.notifyDamage();
  }

  grapheme(row: number, column: number): string {
    this.assertLive();
    const scrollbackLength = this.terminal.getScrollbackLength();
    const sourceLine = scrollbackLength - this.scrollOffsetValue + row;
    return sourceLine < scrollbackLength
      ? this.terminal.getScrollbackGraphemeString(sourceLine, column)
      : this.terminal.getGraphemeString(sourceLine - scrollbackLength, column);
  }

  hyperlinkAtViewportCell(row: number, column: number): string | null {
    this.assertLive();
    if (row < 0 || row >= this.rows || column < 0 || column >= this.cols) {
      return null;
    }
    this.ensureRenderState();
    const scrollbackLength = this.terminal.getScrollbackLength();
    const sourceLine = scrollbackLength - this.scrollOffsetValue + row;
    return sourceLine < scrollbackLength
      ? this.terminal.getScrollbackHyperlinkUri(sourceLine, column)
      : this.terminal.getHyperlinkUri(sourceLine - scrollbackLength, column);
  }

  scrollPosition(): { readonly offset: number; readonly history: number } {
    this.assertLive();
    const history = this.terminal.getScrollbackLength();
    this.scrollOffsetValue = Math.min(this.scrollOffsetValue, history);
    return { offset: this.scrollOffsetValue, history };
  }

  scrollBy(lines: number): boolean {
    this.assertLive();
    if (!Number.isFinite(lines) || lines === 0) return false;
    return this.scrollTo(this.scrollOffsetValue - Math.trunc(lines));
  }

  scrollTo(offset: number): boolean {
    this.assertLive();
    const history = this.terminal.isAlternateScreen()
      ? 0
      : this.terminal.getScrollbackLength();
    const next = Math.max(0, Math.min(history, Math.round(offset)));
    if (next === this.scrollOffsetValue) return false;
    this.scrollOffsetValue = next;
    this.pendingDamage = FULL_DAMAGE;
    this.notifyDamage();
    return true;
  }

  scrollToBottom(): boolean {
    return this.scrollTo(0);
  }

  clear(): void {
    this.assertLive();
    this.write(clearTerminalBufferSequence(this.cursor()));
  }

  revision(): number {
    this.assertLive();
    return this.contentRevision;
  }

  viewportOriginLine(): number {
    this.assertLive();
    const history = this.terminal.getScrollbackLength();
    this.scrollOffsetValue = Math.min(this.scrollOffsetValue, history);
    return history - this.scrollOffsetValue;
  }

  bufferLineAtViewportRow(row: number): number {
    this.assertLive();
    return this.viewportOriginLine() + clampInteger(row, 0, this.rows - 1);
  }

  wordRangeAt(point: TerminalBufferPoint): {
    readonly start: number;
    readonly end: number;
  } {
    this.assertLive();
    const cells = this.readBufferLineCells(point.line);
    const column = clampInteger(point.column, 0, this.cols - 1);
    const category = wordCategory(cells[column] ?? "");
    let start = column;
    let end = column;
    while (start > 0 && wordCategory(cells[start - 1] ?? "") === category) {
      start -= 1;
    }
    while (
      end + 1 < this.cols &&
      wordCategory(cells[end + 1] ?? "") === category
    ) {
      end += 1;
    }
    return { start, end };
  }

  lineEndColumn(line: number): number {
    this.assertLive();
    const cells = this.readBufferLineCells(line);
    for (let column = cells.length - 1; column >= 0; column -= 1) {
      if (cells[column].trim() !== "") return column;
    }
    return 0;
  }

  selectionText(selection: TerminalBufferSelection): string {
    this.assertLive();
    const normalized = normalizeBufferSelection(selection);
    const lines: string[] = [];
    for (
      let line = normalized.start.line;
      line <= normalized.end.line;
      line += 1
    ) {
      const cells = this.readBufferLineCells(line);
      const startColumn = selection.rectangular
        ? normalized.left
        : line === normalized.start.line
          ? normalized.start.column
          : 0;
      const endColumn = selection.rectangular
        ? normalized.right
        : line === normalized.end.line
          ? normalized.end.column
          : this.cols - 1;
      let value = "";
      for (let column = startColumn; column <= endColumn; column += 1) {
        value += cells[column] ?? "";
      }
      const text = value.trimEnd();
      if (
        lines.length > 0 &&
        !selection.rectangular &&
        this.isBufferLineWrapped(line)
      ) {
        lines[lines.length - 1] += text;
      } else {
        lines.push(text);
      }
    }
    return lines.join("\n");
  }

  encodeKey(event: KeyEvent): Uint8Array {
    this.assertLive();
    this.keyEncoder.setOption(
      KeyEncoderOption.CURSOR_KEY_APPLICATION,
      this.terminal.getMode(1),
    );
    this.keyEncoder.setOption(
      KeyEncoderOption.KEYPAD_KEY_APPLICATION,
      this.terminal.getMode(66),
    );
    return this.keyEncoder.encode(event);
  }

  mode(mode: number, isAnsi = false): boolean {
    this.assertLive();
    return this.terminal.getMode(mode, isAnsi);
  }

  modes(): TerminalModes {
    this.assertLive();
    return {
      alternateScreen: this.terminal.isAlternateScreen(),
      bracketedPaste: this.terminal.hasBracketedPaste(),
      focusReporting: this.terminal.hasFocusEvents(),
      mouseTracking: this.terminal.hasMouseTracking(),
      synchronizedOutput: this.terminal.getMode(2026),
    };
  }

  readText(maxLines: number): string {
    this.assertLive();
    const requestedLines = Math.max(0, Math.floor(maxLines));
    if (requestedLines === 0) return "";

    this.ensureRenderState();
    const scrollbackLength = this.terminal.getScrollbackLength();
    const totalLines = scrollbackLength + this.rows;
    const firstLine = Math.max(0, totalLines - requestedLines);
    const lines: string[] = [];

    for (let line = firstLine; line < scrollbackLength; line += 1) {
      const cells = this.terminal.getScrollbackLineSnapshot(line);
      lines.push(
        cells
          ? cellsToText(cells, (column) =>
              this.terminal.getScrollbackGraphemeString(line, column),
            )
          : "",
      );
    }

    const viewport = this.terminal.getViewport();
    const firstViewportRow = Math.max(0, firstLine - scrollbackLength);
    for (let row = firstViewportRow; row < this.rows; row += 1) {
      const start = row * this.cols;
      lines.push(
        cellsToText(viewport.slice(start, start + this.cols), (column) =>
          this.terminal.getGraphemeString(row, column),
        ),
      );
    }

    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
  }

  subscribeDamage(listener: () => void): () => void {
    this.assertLive();
    this.damageListeners.add(listener);
    return () => this.damageListeners.delete(listener);
  }

  setReplySink(sink: ((bytes: Uint8Array) => void) | null): void {
    this.assertLive();
    this.replySink = sink;
    if (sink && this.terminal.hasResponse()) this.drainReplies();
  }

  diagnostics(): TerminalModelDiagnostics {
    return {
      backend: this.backend,
      cols: this.cols,
      rows: this.rows,
      scrollbackLines: this.disposed ? 0 : this.terminal.getScrollbackLength(),
      disposed: this.disposed,
      writes: this.writeCount,
      renderStateUpdates: this.renderStateUpdateCount,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.damageListeners.clear();
    this.replySink = null;
    this.eventSink = null;
    this.responseDrainScheduled = false;
    this.scrolledViewport = new Uint8Array(0);
    this.cellReader = null;
    this.promptPresentation.dispose();
    this.synchronizedOutputPresentation.dispose();
    this.keyEncoder.dispose();
    this.terminal.free();
    const callback = this.onDispose;
    this.onDispose = null;
    callback?.();
  }

  private captureDamage(notify = true): void {
    const state = this.ensureRenderState();
    if (state === DirtyState.NONE) return;

    const nextDamage =
      this.scrollOffsetValue > 0 || state === DirtyState.FULL
        ? FULL_DAMAGE
        : this.readDirtyRows();
    this.pendingDamage = mergeDamage(this.pendingDamage, nextDamage);
    if (notify && this.pendingDamage.kind !== "none") this.notifyDamage();
  }

  private readDirtyRows(): TerminalDamage {
    const ranges: TerminalRowRange[] = [];
    let rangeStart = -1;

    for (let row = 0; row < this.rows; row += 1) {
      if (this.terminal.isRowDirty(row)) {
        if (rangeStart < 0) rangeStart = row;
      } else if (rangeStart >= 0) {
        ranges.push({ start: rangeStart, end: row - 1 });
        rangeStart = -1;
      }
    }
    if (rangeStart >= 0) ranges.push({ start: rangeStart, end: this.rows - 1 });

    // A partial state without row details cannot be rendered safely. A full
    // redraw is rare and preferable to presenting stale cells.
    return ranges.length > 0 ? { kind: "rows", ranges } : FULL_DAMAGE;
  }

  private reconcileScrollOffset(previousScrollbackLength: number): void {
    if (this.scrollOffsetValue === 0) return;
    if (this.terminal.isAlternateScreen()) {
      this.scrollOffsetValue = 0;
      this.pendingDamage = FULL_DAMAGE;
      return;
    }

    const scrollbackLength = this.terminal.getScrollbackLength();
    const appendedLines = Math.max(
      0,
      scrollbackLength - previousScrollbackLength,
    );
    this.scrollOffsetValue = Math.min(
      scrollbackLength,
      this.scrollOffsetValue + appendedLines,
    );
  }

  private drainReplies(): void {
    this.responseDrainScheduled = false;
    if (!this.replySink) return;

    let drainedBytes = 0;
    while (this.terminal.hasResponse()) {
      const response = this.terminal.readResponseBytes();
      if (!response || response.byteLength === 0) break;
      drainedBytes += response.byteLength;
      this.replySink(response);
      if (drainedBytes >= RESPONSE_DRAIN_BUDGET_BYTES) break;
    }

    if (this.terminal.hasResponse()) {
      this.responseDrainScheduled = true;
      queueMicrotask(() => {
        if (!this.disposed && this.responseDrainScheduled) this.drainReplies();
      });
    }
  }

  private drainEvents(): void {
    const events = this.terminal.drainEvents();
    for (const event of events) {
      this.promptPresentation.observe(event);
      this.eventSink?.(event);
    }
  }

  private notifyDamage(): void {
    if (
      this.promptPresentation.suppressed ||
      this.synchronizedOutputPresentation.suppressed ||
      this.damageNotificationPending ||
      this.damageListeners.size === 0
    )
      return;
    this.damageNotificationPending = true;
    for (const listener of this.damageListeners) listener();
  }

  private ensureRenderState(): DirtyState {
    if (!this.renderStateCurrent) {
      this.renderStateDirty = this.terminal.update();
      this.renderStateCurrent = true;
      this.renderStateUpdateCount += 1;
    }
    return this.renderStateDirty;
  }

  private readBufferLineCells(line: number): string[] {
    this.ensureRenderState();
    const history = this.terminal.getScrollbackLength();
    const maxLine = history + this.rows - 1;
    const safeLine = clampInteger(line, 0, maxLine);
    const activeRow = safeLine - history;
    const cells =
      activeRow < 0
        ? this.terminal.getScrollbackLineSnapshot(safeLine)
        : this.terminal.getLineSnapshot(activeRow);
    if (!cells) return Array.from({ length: this.cols }, () => "");

    return cells.map((cell, column) => {
      if (cell.width === 0) return "";
      if (cell.codepoint === 0) return " ";
      return cell.grapheme_len > 0
        ? activeRow < 0
          ? this.terminal.getScrollbackGraphemeString(safeLine, column)
          : this.terminal.getGraphemeString(activeRow, column)
        : String.fromCodePoint(cell.codepoint);
    });
  }

  private isBufferLineWrapped(line: number): boolean {
    const history = this.terminal.getScrollbackLength();
    return line < history
      ? this.terminal.isScrollbackRowWrapped(line)
      : this.terminal.isRowWrapped(line - history);
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("Ghostty terminal model is disposed");
  }
}

function cellsToText(
  cells: readonly GhosttyCell[],
  readGrapheme: (column: number) => string,
): string {
  let value = "";
  for (let column = 0; column < cells.length; column += 1) {
    const cell = cells[column];
    if (cell.width === 0) continue;
    if (cell.grapheme_len > 0) value += readGrapheme(column);
    else
      value +=
        cell.codepoint === 0 ? " " : String.fromCodePoint(cell.codepoint);
  }
  return value.trimEnd();
}

function mergeDamage(
  previous: TerminalDamage,
  next: TerminalDamage,
): TerminalDamage {
  if (previous.kind === "full" || next.kind === "full") return FULL_DAMAGE;
  if (previous.kind === "none") return next;
  if (next.kind === "none") return previous;

  const sorted = [...previous.ranges, ...next.ranges].sort(
    (left, right) => left.start - right.start,
  );
  const ranges: TerminalRowRange[] = [];
  for (const range of sorted) {
    const tail = ranges[ranges.length - 1];
    if (!tail || range.start > tail.end + 1) {
      ranges.push({ ...range });
    } else if (range.end > tail.end) {
      ranges[ranges.length - 1] = { start: tail.start, end: range.end };
    }
  }
  return { kind: "rows", ranges };
}

function validateDimensions(cols: number, rows: number): void {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 1 ||
    rows < 1 ||
    cols > MAX_DIMENSION ||
    rows > MAX_DIMENSION ||
    cols * rows > MAX_CELLS
  ) {
    throw new RangeError(
      `Invalid terminal dimensions ${cols}x${rows}; maximum is ${MAX_CELLS} cells`,
    );
  }
}

function emptySearchStatus(): GhosttySearchStatus {
  return {
    active: false,
    pending: false,
    complete: true,
    generation: 0,
    totalMatches: 0,
    selectedIndex: -1,
  };
}

function normalizeBufferSelection(selection: TerminalBufferSelection): {
  readonly start: TerminalBufferPoint;
  readonly end: TerminalBufferPoint;
  readonly left: number;
  readonly right: number;
} {
  const anchorBeforeFocus =
    selection.anchor.line < selection.focus.line ||
    (selection.anchor.line === selection.focus.line &&
      selection.anchor.column <= selection.focus.column);
  return {
    start: anchorBeforeFocus ? selection.anchor : selection.focus,
    end: anchorBeforeFocus ? selection.focus : selection.anchor,
    left: Math.min(selection.anchor.column, selection.focus.column),
    right: Math.max(selection.anchor.column, selection.focus.column),
  };
}

function wordCategory(
  value: string,
): "empty" | "space" | "word" | "punctuation" {
  if (value === "") return "empty";
  if (/^\s+$/u.test(value)) return "space";
  if (/^[\p{L}\p{N}\p{M}_./\\:~@%+=-]+$/u.test(value)) return "word";
  return "punctuation";
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
