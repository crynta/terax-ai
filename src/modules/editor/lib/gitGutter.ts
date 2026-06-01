import { RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";

export type ChangeType = "added" | "modified" | "deleted";

export interface LineChange {
  line: number; // 1-based line number in the new file
  type: ChangeType;
}

export const setGitChanges = StateEffect.define<LineChange[]>();

const gitChangesField = StateField.define<LineChange[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGitChanges)) return e.value;
    }
    return value;
  },
});

class GitGutterMarker extends GutterMarker {
  constructor(readonly changeType: ChangeType) {
    super();
  }
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = `cm-git-marker cm-git-marker-${this.changeType}`;
    return el;
  }
  eq(other: GutterMarker): boolean {
    return other instanceof GitGutterMarker && this.changeType === other.changeType;
  }
}

const MARKERS: Record<ChangeType, GitGutterMarker> = {
  added: new GitGutterMarker("added"),
  modified: new GitGutterMarker("modified"),
  deleted: new GitGutterMarker("deleted"),
};

// Parse a unified diff patch and return per-line change records.
// Sequences of - followed by + are classified as "modified"; pure + as "added";
// positions where lines were deleted are marked "deleted" at the boundary line.
export function parseUnifiedDiff(patch: string): LineChange[] {
  const result: LineChange[] = [];
  const lines = patch.split("\n");
  let newLine = 0;
  let pendingDels = 0;

  for (const raw of lines) {
    if (raw.startsWith("@@")) {
      if (pendingDels > 0) {
        result.push({ line: newLine, type: "deleted" });
        pendingDels = 0;
      }
      const m = raw.match(/\+(\d+)/);
      if (m) newLine = parseInt(m[1]) - 1;
      continue;
    }
    if (
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ") ||
      raw.startsWith("\\")
    )
      continue;

    if (raw.startsWith("-")) {
      pendingDels++;
    } else if (raw.startsWith("+")) {
      newLine++;
      if (pendingDels > 0) {
        result.push({ line: newLine, type: "modified" });
        pendingDels--;
      } else {
        result.push({ line: newLine, type: "added" });
      }
    } else {
      if (pendingDels > 0) {
        result.push({ line: newLine, type: "deleted" });
        pendingDels = 0;
      }
      newLine++;
    }
  }

  if (pendingDels > 0) {
    result.push({ line: newLine, type: "deleted" });
  }

  return result;
}

export function gitGutterExtension(): Extension {
  return [
    gitChangesField,
    gutter({
      class: "cm-git-gutter",
      markers(view) {
        const changes = view.state.field(gitChangesField);
        const builder = new RangeSetBuilder<GutterMarker>();
        const doc = view.state.doc;
        const sorted = [...changes].sort((a, b) => a.line - b.line);
        for (const { line, type } of sorted) {
          if (line < 1 || line > doc.lines) continue;
          const lineStart = doc.line(line).from;
          builder.add(lineStart, lineStart, MARKERS[type]);
        }
        return builder.finish();
      },
      initialSpacer: () => MARKERS.added,
    }),
    EditorView.theme({
      ".cm-git-gutter": {
        width: "3px",
        minWidth: "3px",
        paddingLeft: "0",
        paddingRight: "0",
      },
      ".cm-git-marker": {
        width: "3px",
        display: "block",
        boxSizing: "border-box",
        height: "100%",
      },
      ".cm-git-marker-added": { background: "#3fb950" },
      ".cm-git-marker-modified": { background: "#d29922" },
      ".cm-git-marker-deleted": {
        background: "#f85149",
        height: "2px",
        marginTop: "calc(1lh - 2px)",
      },
    }),
  ];
}
