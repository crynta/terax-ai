// Renames reported by the explorer, keyed by the (from, to) pair of an open
// editor tab. useDocument consumes one when its path changes so a moved file
// keeps its buffer instead of reloading from disk and dropping unsaved edits.
//
// Invariant: only tabs with a mounted pane (not `cold`) may note a retarget,
// one note per tab, and each mounted pane consumes at most one. The same file
// can be open in several tabs, hence the count. A leftover note is harmless:
// it only matches the exact same (from, to) pair on a loaded pane.
const pending = new Map<string, number>();

const key = (from: string, to: string) => `${from}\0${to}`;

export function noteRetarget(from: string, to: string): void {
  if (from === to) return;
  const k = key(from, to);
  pending.set(k, (pending.get(k) ?? 0) + 1);
}

/** True once per noted rename; false for any other path change. */
export function consumeRetarget(from: string, to: string): boolean {
  const k = key(from, to);
  const n = pending.get(k);
  if (n === undefined) return false;
  if (n <= 1) pending.delete(k);
  else pending.set(k, n - 1);
  return true;
}
