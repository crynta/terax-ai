import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";

// 1-based new-file line numbers, grouped by change kind. `deleted` marks lines
// that have a deletion immediately above/at them (shown as a boundary bar).
export type GitChanges = {
  added: Set<number>;
  modified: Set<number>;
  deleted: Set<number>;
};

export const emptyGitChanges = (): GitChanges => ({
  added: new Set(),
  modified: new Set(),
  deleted: new Set(),
});

/**
 * Parse a `git diff` unified patch into per-line change kinds against the NEW
 * (worktree) file, so a gutter can mark added / modified / deleted lines.
 * ponytail: diff is worktree-vs-index (recomputed on save); good enough for the
 * edit→save loop. For staged-line accuracy switch the source to `git diff HEAD`.
 */
export function parseUnifiedDiff(diffText: string): GitChanges {
  const res = emptyGitChanges();
  if (!diffText) return res;

  let newLine = 0;
  let pendingDel = 0; // deletions seen since the last addition/context line
  for (const raw of diffText.split("\n")) {
    if (raw === "") continue;
    if (raw.startsWith("@@")) {
      const m = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (m) newLine = Number.parseInt(m[1], 10);
      pendingDel = 0;
      continue;
    }
    // File headers / metadata — never part of a hunk body.
    if (
      raw.startsWith("+++ ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("new file") ||
      raw.startsWith("deleted file") ||
      raw.startsWith("rename ") ||
      raw.startsWith("similarity ") ||
      raw.startsWith("\\")
    ) {
      continue;
    }

    const c = raw[0];
    if (c === "+") {
      if (pendingDel > 0) {
        res.modified.add(newLine);
        pendingDel--;
      } else {
        res.added.add(newLine);
      }
      newLine++;
    } else if (c === "-") {
      pendingDel++;
    } else {
      // context line: flush any unmatched deletions as a boundary marker here
      if (pendingDel > 0) {
        res.deleted.add(newLine);
        pendingDel = 0;
      }
      newLine++;
    }
  }
  if (pendingDel > 0) res.deleted.add(Math.max(1, newLine - 1));
  return res;
}

export const setGitChanges = StateEffect.define<GitChanges>();

const gitChangesField = StateField.define<GitChanges>({
  create: emptyGitChanges,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setGitChanges)) return e.value;
    return value;
  },
});

class ChangeMarker extends GutterMarker {
  constructor(kind: "added" | "modified" | "deleted") {
    super();
    this.elementClass = `cm-change-${kind}`;
  }
}

const addedMarker = new ChangeMarker("added");
const modifiedMarker = new ChangeMarker("modified");
const deletedMarker = new ChangeMarker("deleted");

const changeGutter = gutter({
  class: "cm-changeGutter",
  lineMarker(view, line) {
    const changes = view.state.field(gitChangesField, false);
    if (!changes) return null;
    const lineNo = view.state.doc.lineAt(line.from).number;
    if (changes.modified.has(lineNo)) return modifiedMarker;
    if (changes.added.has(lineNo)) return addedMarker;
    if (changes.deleted.has(lineNo)) return deletedMarker;
    return null;
  },
  lineMarkerChange: (update) =>
    update.state.field(gitChangesField) !==
    update.startState.field(gitChangesField),
});

const changeGutterTheme = EditorView.baseTheme({
  ".cm-changeGutter": { width: "3px", padding: "0" },
  ".cm-changeGutter .cm-gutterElement": { padding: "0" },
  ".cm-change-added": { backgroundColor: "#3fb950" },
  ".cm-change-modified": { backgroundColor: "#2f81f7" },
  ".cm-change-deleted": { boxShadow: "inset 0 -2px 0 0 #f85149" },
});

export const gitChangeGutter: Extension = [
  gitChangesField,
  changeGutter,
  changeGutterTheme,
];
