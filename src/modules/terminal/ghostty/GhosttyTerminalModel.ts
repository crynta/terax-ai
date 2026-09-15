import type {
  TerminalBackendKind,
  TerminalModel,
} from "@/modules/terminal/backend/contracts";
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

export interface GhosttyTerminalModelApi extends TerminalModel {
  isDisposed?(): boolean;
  renderCells(): TerminalCellReader;
  presentationSuppressed(): boolean;
  deferPresentation(): boolean;
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
