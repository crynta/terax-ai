import { describe, expect, it } from "vitest";
import {
  allowsLineSelection,
  changedLineIndexes,
  emptySelection,
  hasSelection,
  hunkSelectionLevel,
  isLineSelected,
  isWholeFileOnly,
  pruneSelection,
  selectAllHunks,
  selectionCounts,
  toApplySelection,
  toggleHunk,
  toggleLine,
} from "./hunks";
import type { DiffHunk, DiffLine, GitFileDiff } from "./types";

function line(kind: DiffLine["kind"], text: string, noNewline = false): DiffLine {
  return { kind, text, oldLine: null, newLine: null, noNewline };
}

function hunk(id: string, lines: DiffLine[]): DiffHunk {
  return {
    id,
    header: "@@",
    oldStart: 1,
    oldLines: lines.filter((l) => l.kind !== "add").length,
    newStart: 1,
    newLines: lines.filter((l) => l.kind !== "remove").length,
    lines,
    added: lines.filter((l) => l.kind === "add").length,
    removed: lines.filter((l) => l.kind === "remove").length,
  };
}

function diff(hunks: DiffHunk[], overrides: Partial<GitFileDiff> = {}): GitFileDiff {
  return {
    path: "a.txt",
    oldPath: null,
    status: "modified",
    unchanged: false,
    binary: false,
    submodule: false,
    symlink: false,
    added: 0,
    removed: 0,
    hunks,
    fingerprint: "f",
    truncated: false,
    contents: null,
    contentsOmitted: null,
    from: { kind: "index" },
    to: { kind: "worktree" },
    ...overrides,
  };
}

const first = hunk("h1", [
  line("context", "a"),
  line("remove", "b"),
  line("remove", "c"),
  line("add", "B"),
  line("context", "d"),
]);
const second = hunk("h2", [line("context", "x"), line("add", "y")]);
const file = diff([first, second]);

describe("changedLineIndexes", () => {
  it("skips context lines", () => {
    expect(changedLineIndexes(first)).toEqual([1, 2, 3]);
    expect(changedLineIndexes(second)).toEqual([1]);
  });
});

describe("hunk and line toggling", () => {
  it("toggles a whole hunk on and off", () => {
    const on = toggleHunk(emptySelection, first);
    expect(hunkSelectionLevel(on, first)).toBe("all");
    expect(hunkSelectionLevel(on, second)).toBe("none");
    expect(isLineSelected(on, first, 1)).toBe(true);
    expect(isLineSelected(on, first, 0)).toBe(false);
    const off = toggleHunk(on, first);
    expect(hunkSelectionLevel(off, first)).toBe("none");
    expect(hasSelection(off)).toBe(false);
  });

  it("does not mutate the previous selection", () => {
    const before = toggleHunk(emptySelection, first);
    toggleLine(before, first, 1);
    expect(hunkSelectionLevel(before, first)).toBe("all");
    expect(emptySelection.size).toBe(0);
  });

  it("builds a partial selection line by line and completes it", () => {
    let sel = toggleLine(emptySelection, first, 1);
    expect(hunkSelectionLevel(sel, first)).toBe("partial");
    sel = toggleLine(sel, first, 3);
    expect(hunkSelectionLevel(sel, first)).toBe("partial");
    sel = toggleLine(sel, first, 2);
    expect(hunkSelectionLevel(sel, first)).toBe("all");
    sel = toggleLine(sel, first, 2);
    expect(hunkSelectionLevel(sel, first)).toBe("partial");
  });

  it("unticking a line of a fully selected hunk leaves the others picked", () => {
    const all = toggleHunk(emptySelection, first);
    const sel = toggleLine(all, first, 2);
    expect(hunkSelectionLevel(sel, first)).toBe("partial");
    expect(isLineSelected(sel, first, 1)).toBe(true);
    expect(isLineSelected(sel, first, 2)).toBe(false);
    expect(isLineSelected(sel, first, 3)).toBe(true);
  });

  it("removes the hunk when its last picked line is unticked", () => {
    const sel = toggleLine(toggleLine(emptySelection, first, 1), first, 1);
    expect(hasSelection(sel)).toBe(false);
  });

  it("ignores context and out-of-range lines", () => {
    expect(toggleLine(emptySelection, first, 0)).toBe(emptySelection);
    expect(toggleLine(emptySelection, first, 99)).toBe(emptySelection);
  });
});

describe("toApplySelection", () => {
  it("is null when nothing is picked", () => {
    expect(toApplySelection(file, emptySelection)).toBeNull();
  });

  it("sends whole hunks without a line list, in file order", () => {
    const sel = toggleHunk(toggleHunk(emptySelection, second), first);
    expect(toApplySelection(file, sel)).toEqual({
      kind: "hunks",
      items: [{ id: "h1" }, { id: "h2" }],
    });
  });

  it("sends sorted line indices for a partial pick", () => {
    const sel = toggleLine(toggleLine(emptySelection, first, 3), first, 1);
    expect(toApplySelection(file, sel)).toEqual({
      kind: "hunks",
      items: [{ id: "h1", lines: [1, 3] }],
    });
  });

  it("collapses a line pick that covers every change into a whole hunk", () => {
    let sel = emptySelection;
    for (const index of [1, 2, 3]) sel = toggleLine(sel, first, index);
    expect(toApplySelection(file, sel)).toEqual({
      kind: "hunks",
      items: [{ id: "h1" }],
    });
  });

  it("drops picks for hunks that are not in the diff", () => {
    const sel = toggleHunk(emptySelection, hunk("gone", [line("add", "z")]));
    expect(toApplySelection(file, sel)).toBeNull();
  });
});

describe("selectAllHunks / pruneSelection", () => {
  it("selects every hunk", () => {
    const sel = selectAllHunks(file);
    expect(toApplySelection(file, sel)).toEqual({
      kind: "hunks",
      items: [{ id: "h1" }, { id: "h2" }],
    });
  });

  it("forgets hunks a refreshed diff no longer has and keeps identity when nothing changed", () => {
    const sel = selectAllHunks(file);
    expect(pruneSelection(sel, file)).toBe(sel);
    const refreshed = diff([second]);
    const pruned = pruneSelection(sel, refreshed);
    expect(hunkSelectionLevel(pruned, first)).toBe("none");
    expect(hunkSelectionLevel(pruned, second)).toBe("all");
  });
});

describe("selectionCounts", () => {
  it("counts only picked changes", () => {
    expect(selectionCounts(file, emptySelection)).toEqual({
      hunks: 0,
      added: 0,
      removed: 0,
    });
    expect(selectionCounts(file, selectAllHunks(file))).toEqual({
      hunks: 2,
      added: 2,
      removed: 2,
    });
    const partial = toggleLine(emptySelection, first, 2);
    expect(selectionCounts(file, partial)).toEqual({
      hunks: 1,
      added: 0,
      removed: 1,
    });
  });
});

describe("whole-file and line-level eligibility", () => {
  it("allows hunk picks only for plain modified text files", () => {
    expect(isWholeFileOnly(file)).toBe(false);
    for (const status of ["added", "deleted", "renamed", "untracked"] as const) {
      expect(isWholeFileOnly(diff([first], { status }))).toBe(true);
    }
    expect(isWholeFileOnly(diff([first], { binary: true }))).toBe(true);
    expect(isWholeFileOnly(diff([first], { submodule: true }))).toBe(true);
    expect(isWholeFileOnly(diff([first], { symlink: true }))).toBe(true);
    expect(isWholeFileOnly(diff([first], { truncated: true }))).toBe(true);
    expect(isWholeFileOnly(diff([]))).toBe(true);
  });

  it("refuses line picks inside a hunk that touches the end-of-file newline", () => {
    expect(allowsLineSelection(first)).toBe(true);
    const eof = hunk("eof", [line("remove", "c", true), line("add", "c")]);
    expect(allowsLineSelection(eof)).toBe(false);
  });
});
