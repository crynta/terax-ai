import type {
  ApplySelection,
  DiffHunk,
  GitFileDiff,
  HunkSelection,
} from "./types";

/**
 * Which changed lines of which hunks are picked, keyed by hunk id. An entry
 * with `all` takes the whole hunk; otherwise `lines` holds indices into the
 * hunk's `lines`. The model is immutable: every helper returns a new value.
 */
export type HunkSelectionState = ReadonlyMap<string, HunkPick>;

type HunkPick = { all: boolean; lines: ReadonlySet<number> };

export type HunkSelectionLevel = "none" | "partial" | "all";

export const emptySelection: HunkSelectionState = new Map();

/** Indices of the added / removed lines of a hunk (context is never picked). */
export function changedLineIndexes(hunk: DiffHunk): number[] {
  const out: number[] = [];
  hunk.lines.forEach((line, index) => {
    if (line.kind !== "context") out.push(index);
  });
  return out;
}

export function hunkSelectionLevel(
  selection: HunkSelectionState,
  hunk: DiffHunk,
): HunkSelectionLevel {
  const pick = selection.get(hunk.id);
  if (!pick) return "none";
  if (pick.all) return "all";
  const changed = changedLineIndexes(hunk);
  if (pick.lines.size === 0) return "none";
  return pick.lines.size >= changed.length ? "all" : "partial";
}

export function isLineSelected(
  selection: HunkSelectionState,
  hunk: DiffHunk,
  lineIndex: number,
): boolean {
  const pick = selection.get(hunk.id);
  if (!pick) return false;
  return pick.all ? hunk.lines[lineIndex]?.kind !== "context" : pick.lines.has(lineIndex);
}

function withPick(
  selection: HunkSelectionState,
  id: string,
  pick: HunkPick | null,
): HunkSelectionState {
  const next = new Map(selection);
  if (pick) next.set(id, pick);
  else next.delete(id);
  return next;
}

export function toggleHunk(
  selection: HunkSelectionState,
  hunk: DiffHunk,
): HunkSelectionState {
  return hunkSelectionLevel(selection, hunk) === "all"
    ? withPick(selection, hunk.id, null)
    : withPick(selection, hunk.id, { all: true, lines: new Set() });
}

/** Toggles one changed line; a context line is ignored. */
export function toggleLine(
  selection: HunkSelectionState,
  hunk: DiffHunk,
  lineIndex: number,
): HunkSelectionState {
  if (hunk.lines[lineIndex]?.kind === "context" || !hunk.lines[lineIndex]) {
    return selection;
  }
  const current = new Set<number>(
    selection.get(hunk.id)?.all
      ? changedLineIndexes(hunk)
      : (selection.get(hunk.id)?.lines ?? []),
  );
  if (current.has(lineIndex)) current.delete(lineIndex);
  else current.add(lineIndex);
  if (current.size === 0) return withPick(selection, hunk.id, null);
  return withPick(selection, hunk.id, {
    all: current.size === changedLineIndexes(hunk).length,
    lines: current,
  });
}

export function selectAllHunks(diff: GitFileDiff): HunkSelectionState {
  return new Map(
    diff.hunks.map((hunk): [string, HunkPick] => [
      hunk.id,
      { all: true, lines: new Set() },
    ]),
  );
}

/** Forgets picks whose hunks are gone from a refreshed diff. */
export function pruneSelection(
  selection: HunkSelectionState,
  diff: GitFileDiff,
): HunkSelectionState {
  const alive = new Set(diff.hunks.map((hunk) => hunk.id));
  let changed = false;
  const next = new Map<string, HunkPick>();
  for (const [id, pick] of selection) {
    if (alive.has(id)) next.set(id, pick);
    else changed = true;
  }
  return changed ? next : selection;
}

export function hasSelection(selection: HunkSelectionState): boolean {
  return selection.size > 0;
}

/**
 * Whether hunks of this file can be picked individually. Added, deleted,
 * renamed, binary, symlink, submodule and mode-only changes can only be acted
 * on as a whole file, and so can a diff that was cut at its size cap.
 */
export function isWholeFileOnly(diff: GitFileDiff): boolean {
  return (
    diff.status !== "modified" ||
    diff.binary ||
    diff.submodule ||
    diff.symlink ||
    diff.truncated ||
    diff.hunks.length === 0
  );
}

/**
 * Line-level picks are refused by the backend inside a hunk that touches the
 * end-of-file newline; the UI should offer only whole-hunk picks there.
 */
export function allowsLineSelection(hunk: DiffHunk): boolean {
  return !hunk.lines.some((line) => line.noNewline);
}

/**
 * The payload for an apply call. A whole-hunk pick omits `lines`; a line pick
 * that covers every changed line collapses to a whole-hunk pick; hunks are
 * sent in file order. Returns `null` when nothing is selected.
 */
export function toApplySelection(
  diff: GitFileDiff,
  selection: HunkSelectionState,
): ApplySelection | null {
  const items: HunkSelection[] = [];
  for (const hunk of diff.hunks) {
    const pick = selection.get(hunk.id);
    if (!pick) continue;
    const level = hunkSelectionLevel(selection, hunk);
    if (level === "none") continue;
    if (level === "all") {
      items.push({ id: hunk.id });
    } else {
      items.push({ id: hunk.id, lines: [...pick.lines].sort((a, b) => a - b) });
    }
  }
  return items.length > 0 ? { kind: "hunks", items } : null;
}

/** Added / removed line counts of what is currently picked, for button labels. */
export function selectionCounts(
  diff: GitFileDiff,
  selection: HunkSelectionState,
): { hunks: number; added: number; removed: number } {
  let hunks = 0;
  let added = 0;
  let removed = 0;
  for (const hunk of diff.hunks) {
    const level = hunkSelectionLevel(selection, hunk);
    if (level === "none") continue;
    hunks += 1;
    hunk.lines.forEach((line, index) => {
      if (line.kind === "context" || !isLineSelected(selection, hunk, index)) {
        return;
      }
      if (line.kind === "add") added += 1;
      else removed += 1;
    });
  }
  return { hunks, added, removed };
}
