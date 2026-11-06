/**
 * Reviewing a changed file the way Cursor does: Claude's edits are already on
 * disk (kept by default), each change can be kept or undone, and the file is
 * editable in place. Pure helpers for the review dialog.
 */

/** What saving the review should do, given the disk now and when last seen. */
export type SaveDecision = "unchanged" | "write" | "conflict";

/**
 * `diskNow` is the file as it is now (null when missing), `diskKnown` the
 * content the dialog last read or wrote, `doc` the editor's text. Writing over
 * a file someone else (Claude) changed since is a conflict, never silent.
 */
export function saveDecision(
  diskNow: string | null,
  diskKnown: string | null,
  doc: string,
): SaveDecision {
  if (diskNow !== diskKnown) return diskNow === doc ? "unchanged" : "conflict";
  return doc === diskNow ? "unchanged" : "write";
}

/** A change as the review shows it: line ranges in the earlier text (A) and now (B). */
export type ReviewChunk = {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
};

/** Lines removed and added across the review's changes, as the editor draws them. */
export function chunkStats(
  original: string,
  doc: string,
  chunks: readonly ReviewChunk[],
): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const c of chunks) {
    removed += countLines(original, c.fromA, c.toA);
    added += countLines(doc, c.fromB, c.toB);
  }
  return { added, removed };
}

function countLines(text: string, from: number, to: number): number {
  if (from === to) return 0;
  const slice = text.slice(from, to);
  let n = 1;
  for (let i = 0; i < slice.length; i++) {
    if (slice.charCodeAt(i) === 10) n++;
  }
  if (slice.endsWith("\n")) n--;
  return Math.max(n, 1);
}

/**
 * The change to land on when stepping `direction` from the cursor: the first
 * change starting after it (or before it, going up), wrapping at the ends.
 * `starts` are the changes' positions in document order.
 */
export function nextChange(
  starts: readonly number[],
  cursor: number,
  direction: 1 | -1,
): number {
  if (starts.length === 0) return -1;
  if (direction === 1) {
    const i = starts.findIndex((s) => s > cursor);
    return i === -1 ? 0 : i;
  }
  for (let i = starts.length - 1; i >= 0; i--) {
    if (starts[i] < cursor) return i;
  }
  return starts.length - 1;
}

/** Which change (index) the cursor sits in or just before; -1 when none. */
export function changeAt(
  ranges: readonly { from: number; to: number }[],
  cursor: number,
): number {
  return ranges.findIndex((r) => cursor >= r.from && cursor <= r.to);
}
