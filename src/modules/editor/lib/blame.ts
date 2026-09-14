import { StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { GitBlameLine } from "@/modules/ai/lib/native";

/** Replace the blame annotations for the current document. */
export const setBlame = StateEffect.define<GitBlameLine[] | null>();

// Blame is line-indexed against the saved file, so any local edit invalidates
// it until the next save refetches. Showing stale authors is worse than none.
export const blameField = StateField.define<GitBlameLine[] | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setBlame)) return effect.value;
    }
    return tr.docChanged ? null : value;
  },
});

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(secs: number, nowMs: number = Date.now()): string {
  if (!secs) return "";
  const delta = Math.max(0, Math.floor(nowMs / 1000) - secs);
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 30 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  if (delta < 365 * DAY) return `${Math.floor(delta / (30 * DAY))}mo ago`;
  return `${Math.floor(delta / (365 * DAY))}y ago`;
}

export function blameLabel(line: GitBlameLine, nowMs?: number): string {
  if (line.uncommitted) return "You · uncommitted changes";
  const when = relativeTime(line.timestampSecs, nowMs);
  const author = line.author || "Unknown";
  const summary = line.summary ? ` · ${line.summary}` : "";
  return `${author}, ${when}${summary}`;
}

class BlameWidget extends WidgetType {
  constructor(private readonly label: string) {
    super();
  }

  eq(other: BlameWidget) {
    return other.label === this.label;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-inline-blame";
    span.textContent = this.label;
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const blame = view.state.field(blameField);
  if (!blame || !view.state.selection.main.empty) return Decoration.none;
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const entry = blame[line.number - 1];
  if (!entry || !line.text.trim()) return Decoration.none;
  return Decoration.set([
    Decoration.widget({
      widget: new BlameWidget(blameLabel(entry)),
      side: 1,
    }).range(line.to),
  ]);
}

const blamePlugin = ViewPlugin.fromClass(
  class implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.startState.field(blameField) !== update.state.field(blameField)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const blameTheme = EditorView.baseTheme({
  ".cm-inline-blame": {
    marginLeft: "2em",
    opacity: "0.45",
    fontStyle: "italic",
    pointerEvents: "none",
    userSelect: "none",
  },
});

export function inlineBlame() {
  return [blameField, blamePlugin, blameTheme];
}
