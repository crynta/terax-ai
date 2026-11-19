import {
  cellSpanSegments,
  detectTerminalLinks,
  lowerBound,
  type TerminalLinkHit,
  type TerminalLinkSegment,
  type TerminalTextLink,
  upperBound,
} from "./terminalLinks";

const MAX_EXPLICIT_LINK_CELLS = 4_096;
const MAX_LINK_TEXT_LENGTH = 512;

/**
 * What the model hands out for link lookups: raw cell data only, so the
 * scanning code lives here, in the chunk that loads when a link is first
 * hovered, and not in the terminal's startup path.
 */
export interface ViewportLinkSource {
  readonly cols: number;
  readonly rows: number;
  /** Bumps whenever the cells change. */
  readonly revision: number;
  /** Buffer line shown at the top of the viewport. */
  readonly origin: number;
  readonly cellCount: number;
  /** The OSC 8 uri of a viewport cell, or null. */
  hyperlinkAt(index: number): string | null;
  /** The OSC 8 id of every viewport cell; equal non-zero ids are one link. */
  readonly linkIds: ArrayLike<number>;
  /** Whether each viewport row continues on the next. */
  readonly rowWrapped: ArrayLike<number | boolean>;
  readLines(
    first: number,
    last: number,
  ): ReadonlyMap<number, { readonly cells: ArrayLike<string> }>;
}

export interface ViewportLinkModel {
  linkSource(): ViewportLinkSource;
}

type PlainScan = {
  revision: number;
  origin: number;
  cols: number;
  startRow: number;
  endRow: number;
  offsets: number[];
  links: TerminalTextLink[];
};

/** Finds the link, explicit (OSC 8) or detected in text, under a viewport cell. */
export class ViewportLinkResolver {
  private plain: PlainScan | null = null;

  constructor(private readonly model: ViewportLinkModel) {}

  at(row: number, column: number): TerminalLinkHit | null {
    const source = this.model.linkSource();
    if (row < 0 || row >= source.rows || column < 0 || column >= source.cols) {
      return null;
    }
    const index = row * source.cols + column;
    const explicit = source.hyperlinkAt(index);
    if (explicit) return explicitLinkHit(source, index, explicit);
    return this.detectedLinkHit(source, row, column);
  }

  private detectedLinkHit(
    source: ViewportLinkSource,
    row: number,
    column: number,
  ): TerminalLinkHit | null {
    let scan = this.plain;
    if (
      !scan ||
      scan.revision !== source.revision ||
      scan.origin !== source.origin ||
      scan.cols !== source.cols ||
      row < scan.startRow ||
      row > scan.endRow
    ) {
      scan = scanRows(source, row);
      this.plain = scan;
    }
    const offset = scan.offsets[(row - scan.startRow) * source.cols + column];
    const link = scan.links.find(
      (candidate) => offset >= candidate.start && offset < candidate.end,
    );
    if (!link) return null;
    // A wide character's spacer shares the next offset, so the cell holding
    // an offset is the last one at or before it.
    const first = upperBound(scan.offsets, link.start) - 1;
    const last = lowerBound(scan.offsets, link.end) - 1;
    return {
      kind: link.kind,
      uri: link.uri,
      text: link.uri,
      segments: cellSpanSegments(
        first,
        Math.max(first, last),
        source.cols,
        scan.startRow,
      ),
      path: link.path,
      line: link.line,
      column: link.column,
    };
  }
}

/** The text of the wrapped rows around `row`, bounded, with its link matches. */
function scanRows(source: ViewportLinkSource, row: number): PlainScan {
  let startRow = row;
  let endRow = row;
  while (startRow > 0 && row - startRow < 8 && source.rowWrapped[startRow]) {
    startRow--;
  }
  while (
    endRow + 1 < source.rows &&
    endRow - startRow < 8 &&
    source.rowWrapped[endRow + 1]
  ) {
    endRow++;
  }
  let text = "";
  const offsets: number[] = [];
  const lines = source.readLines(
    source.origin + startRow,
    source.origin + endRow,
  );
  for (let y = startRow; y <= endRow; y++) {
    const cells = lines.get(source.origin + y)?.cells;
    for (let x = 0; x < source.cols; x++) {
      offsets.push(text.length);
      // Wide-character spacers read as "" and contribute no text.
      text += cells?.[x] ?? " ";
    }
  }
  return {
    revision: source.revision,
    origin: source.origin,
    cols: source.cols,
    startRow,
    endRow,
    offsets,
    links: detectTerminalLinks(text),
  };
}

function explicitLinkHit(
  source: ViewportLinkSource,
  index: number,
  uri: string,
): TerminalLinkHit {
  const id = source.linkIds[index];
  let first = index;
  let last = index;
  while (
    first > 0 &&
    source.linkIds[first - 1] === id &&
    index - first < MAX_EXPLICIT_LINK_CELLS
  ) {
    first--;
  }
  while (
    last + 1 < source.cellCount &&
    source.linkIds[last + 1] === id &&
    last - index < MAX_EXPLICIT_LINK_CELLS
  ) {
    last++;
  }
  const segments = cellSpanSegments(first, last, source.cols, 0);
  return { kind: "osc8", uri, text: segmentsText(source, segments), segments };
}

function segmentsText(
  source: ViewportLinkSource,
  segments: readonly TerminalLinkSegment[],
): string {
  if (segments.length === 0) return "";
  const lines = source.readLines(
    source.origin + segments[0].row,
    source.origin + segments[segments.length - 1].row,
  );
  let text = "";
  for (const segment of segments) {
    const cells = lines.get(source.origin + segment.row)?.cells;
    for (
      let x = segment.start;
      x < segment.end && text.length < MAX_LINK_TEXT_LENGTH;
      x++
    ) {
      text += cells?.[x] ?? " ";
    }
  }
  return text;
}

/** One-shot lookup for callers that do not keep a resolver (tests, tools). */
function linkAtViewportCell(
  model: ViewportLinkModel,
  row: number,
  column: number,
): TerminalLinkHit | null {
  return new ViewportLinkResolver(model).at(row, column);
}

export function linkUriAt(
  model: ViewportLinkModel,
  row: number,
  column: number,
): string | null {
  return linkAtViewportCell(model, row, column)?.uri ?? null;
}
