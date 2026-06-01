import { RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";

export type ChangeType = "added" | "modified" | "deleted";

export interface LineChange {
  line: number;          // 1-based first line in new file (or boundary line for deleted)
  type: ChangeType;
  originalLines: string[]; // content before the change (empty for "added")
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
  constructor(readonly changeType: ChangeType) { super(); }
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
  added:    new GitGutterMarker("added"),
  modified: new GitGutterMarker("modified"),
  deleted:  new GitGutterMarker("deleted"),
};

// ── Tooltip ───────────────────────────────────────────────────────────────────

let tooltipEl: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function getTooltip(): HTMLElement {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement("div");
  tooltipEl.className = "cm-git-tooltip";
  Object.assign(tooltipEl.style, {
    position: "fixed",
    zIndex: "10000",
    background: "var(--popover, #1e1e1e)",
    border: "1px solid var(--border, #444)",
    borderRadius: "6px",
    padding: "10px 12px",
    maxWidth: "520px",
    maxHeight: "280px",
    overflow: "auto",
    boxShadow: "0 6px 20px rgba(0,0,0,.45)",
    display: "none",
    fontFamily: "monospace",
    fontSize: "12px",
    lineHeight: "1.5",
    color: "var(--foreground, #ccc)",
  });
  document.body.appendChild(tooltipEl);
  tooltipEl.addEventListener("mouseenter", () => {
    if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; }
  });
  tooltipEl.addEventListener("mouseleave", () => scheduleHide());
  return tooltipEl;
}

function scheduleHide() {
  if (hideTimer !== null) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (tooltipEl) tooltipEl.style.display = "none";
  }, 200);
}

function showTooltip(view: EditorView, change: LineChange, anchorRect: DOMRect) {
  const el = getTooltip();
  el.innerHTML = "";

  // ── Header ──
  const header = document.createElement("div");
  const labels: Record<ChangeType, string> = {
    added: "Added",
    modified: "Modified",
    deleted: "Deleted",
  };
  Object.assign(header.style, {
    marginBottom: "6px",
    fontSize: "11px",
    color: "var(--muted-foreground, #888)",
    fontFamily: "sans-serif",
  });
  header.textContent = labels[change.type];
  el.appendChild(header);

  // ── Original code block ──
  if (change.type !== "added" && change.originalLines.length > 0) {
    const label = document.createElement("div");
    Object.assign(label.style, {
      fontSize: "10px",
      color: "var(--muted-foreground, #888)",
      marginBottom: "4px",
      fontFamily: "sans-serif",
    });
    label.textContent = "Original:";
    el.appendChild(label);

    const pre = document.createElement("pre");
    Object.assign(pre.style, {
      margin: "0",
      padding: "6px 8px",
      background: "var(--accent, #2a2a2a)",
      borderRadius: "4px",
      overflowX: "auto",
      whiteSpace: "pre-wrap",
      wordBreak: "break-all",
      maxHeight: "180px",
      overflowY: "auto",
    });
    // Highlight removed lines in red tint
    change.originalLines.forEach((l) => {
      const span = document.createElement("span");
      span.style.display = "block";
      span.style.color = "#f8928a";
      span.textContent = l || " "; // keep empty lines visible
      pre.appendChild(span);
    });
    el.appendChild(pre);
  } else if (change.type === "added") {
    const note = document.createElement("div");
    Object.assign(note.style, {
      fontStyle: "italic",
      color: "var(--muted-foreground, #888)",
      fontFamily: "sans-serif",
      fontSize: "11px",
    });
    note.textContent = "New line — not in HEAD";
    el.appendChild(note);
  }

  // ── Revert button ──
  const btn = document.createElement("button");
  btn.textContent = "Revert change";
  Object.assign(btn.style, {
    marginTop: "10px",
    padding: "3px 12px",
    background: "var(--destructive, #c0392b)",
    color: "var(--destructive-foreground, #fff)",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "11px",
    fontFamily: "sans-serif",
    display: "block",
  });
  btn.onclick = () => {
    revertChange(view, change);
    el.style.display = "none";
  };
  el.appendChild(btn);

  // ── Position ──
  el.style.display = "block";
  // Measure after display so getBoundingClientRect works
  requestAnimationFrame(() => {
    if (!tooltipEl) return;
    const w = tooltipEl.offsetWidth;
    const h = tooltipEl.offsetHeight;
    let left = anchorRect.right + 6;
    let top = anchorRect.top;
    if (left + w > window.innerWidth - 8) left = anchorRect.left - w - 6;
    if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
    tooltipEl.style.left = `${Math.max(8, left)}px`;
    tooltipEl.style.top = `${Math.max(8, top)}px`;
  });
}

function revertChange(view: EditorView, change: LineChange) {
  const doc = view.state.doc;

  if (change.type === "added") {
    if (change.line < 1 || change.line > doc.lines) return;
    const line = doc.line(change.line);
    // Delete the line + its newline (or the preceding newline if it is the last line)
    const from = change.line > 1 ? line.from - 1 : line.from;
    const to   = change.line > 1 ? line.to : Math.min(line.to + 1, doc.length);
    view.dispatch({ changes: { from, to, insert: "" } });

  } else if (change.type === "modified") {
    if (change.line < 1 || change.line > doc.lines) return;
    const line = doc.line(change.line);
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: change.originalLines.join("\n") },
    });

  } else if (change.type === "deleted") {
    const original = change.originalLines.join("\n");
    if (change.line >= doc.lines) {
      // Deleted at end of file
      view.dispatch({
        changes: { from: doc.length, to: doc.length, insert: "\n" + original },
      });
    } else {
      const nextLine = doc.line(Math.min(change.line + 1, doc.lines));
      view.dispatch({
        changes: { from: nextLine.from, to: nextLine.from, insert: original + "\n" },
      });
    }
  }
}

// ── Diff parser ────────────────────────────────────────────────────────────────

export function parseUnifiedDiff(patch: string): LineChange[] {
  const result: LineChange[] = [];
  const lines = patch.split("\n");
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];

    if (raw.startsWith("diff ") || raw.startsWith("index ") ||
        raw.startsWith("--- ")  || raw.startsWith("+++ ") ||
        raw.startsWith("\\")) { i++; continue; }

    const hunkMatch = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (!hunkMatch) { i++; continue; }

    let newLine = parseInt(hunkMatch[2]);
    i++;

    while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff ")) {
      const l = lines[i];
      if (l.startsWith("\\")) { i++; continue; }

      if (l.startsWith("-") || l.startsWith("+")) {
        // Collect the entire change block (consecutive - and + lines)
        const deleted: string[] = [];
        const added: string[] = [];

        while (i < lines.length && (lines[i].startsWith("-") || lines[i].startsWith("+"))) {
          if (lines[i].startsWith("-")) deleted.push(lines[i].slice(1));
          else                          added.push(lines[i].slice(1));
          i++;
        }

        const nMod = Math.min(deleted.length, added.length);
        // Modified pairs
        for (let k = 0; k < nMod; k++) {
          result.push({ line: newLine + k, type: "modified", originalLines: [deleted[k]] });
        }
        // Pure added
        for (let k = nMod; k < added.length; k++) {
          result.push({ line: newLine + k, type: "added", originalLines: [] });
        }
        // Pure deleted (boundary marker after the added lines)
        if (deleted.length > added.length) {
          result.push({
            line: newLine + added.length,
            type: "deleted",
            originalLines: deleted.slice(nMod),
          });
        }
        newLine += added.length;
      } else {
        // Context line
        newLine++;
        i++;
      }
    }
  }

  return result;
}

// ── Extension ─────────────────────────────────────────────────────────────────

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
          const clampedLine = Math.min(Math.max(line, 1), doc.lines);
          const lineStart = doc.line(clampedLine).from;
          builder.add(lineStart, lineStart, MARKERS[type]);
        }
        return builder.finish();
      },
      initialSpacer: () => MARKERS.added,
      domEventHandlers: {
        mouseover(view, lineBlock, event) {
          const me = event as MouseEvent;
          const doc = view.state.doc;
          const lineNum = doc.lineAt(lineBlock.from).number;
          const changes = view.state.field(gitChangesField);
          const change = changes.find((c) => c.line === lineNum);
          if (!change) { scheduleHide(); return false; }
          if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; }
          const target = me.target as Element;
          showTooltip(view, change, target.getBoundingClientRect());
          return false;
        },
        mouseout(_view, _line, event) {
          const me = event as MouseEvent;
          if (tooltipEl && tooltipEl.contains(me.relatedTarget as Node)) return false;
          scheduleHide();
          return false;
        },
      },
    }),
    EditorView.theme({
      ".cm-git-gutter": { width: "3px", minWidth: "3px", paddingLeft: "0", paddingRight: "0" },
      ".cm-git-marker": { width: "3px", display: "block", boxSizing: "border-box", height: "100%" },
      ".cm-git-marker-added":    { background: "#3fb950" },
      ".cm-git-marker-modified": { background: "#d29922" },
      ".cm-git-marker-deleted":  { background: "#f85149", height: "2px", marginTop: "calc(1lh - 2px)" },
    }),
  ];
}
