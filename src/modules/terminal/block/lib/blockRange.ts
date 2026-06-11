// Block ranges are derived live from markers; a disposed marker (scrolled out
// of scrollback) means the block is no longer addressable.

export type MarkerLike = { line: number; isDisposed: boolean };

export type LineRange = { start: number; end: number };

export function computeRange(
  start: MarkerLike,
  end: MarkerLike,
): LineRange | null {
  if (start.isDisposed || end.isDisposed) return null;
  if (start.line < 0 || end.line < 0) return null;
  return { start: start.line, end: Math.max(start.line, end.line) };
}

export function blockIndexAt(ranges: (LineRange | null)[], line: number): number {
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    if (r && line >= r.start && line <= r.end) return i;
  }
  return -1;
}
