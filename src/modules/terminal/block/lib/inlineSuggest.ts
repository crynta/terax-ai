import { Prec, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

const setSuggestion = StateEffect.define<string>();

const suggestionField = StateField.define<string>({
  create: () => "",
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setSuggestion)) return e.value;
    if (tr.docChanged) {
      if (!value) return value;
      const doc = tr.state.doc.toString();
      return doc.length > 0 && value.startsWith(doc) && value.length > doc.length
        ? value
        : "";
    }
    return value;
  },
});

class GhostWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }
  eq(other: GhostWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-ghost";
    span.textContent = this.text;
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

function tail(state: EditorView["state"]): string | null {
  const sugg = state.field(suggestionField, false);
  if (!sugg) return null;
  const sel = state.selection.main;
  if (!sel.empty || sel.head !== state.doc.length) return null;
  const doc = state.doc.toString();
  if (doc.length === 0) return null;
  if (!sugg.startsWith(doc) || sugg.length <= doc.length) return null;
  return sugg.slice(doc.length);
}

const ghostDecorations = EditorView.decorations.compute(
  [suggestionField, "doc", "selection"],
  (state): DecorationSet => {
    const t = tail(state);
    if (t === null) return Decoration.none;
    return Decoration.set([
      Decoration.widget({
        widget: new GhostWidget(t),
        side: 1,
      }).range(state.doc.length),
    ]);
  },
);

export function acceptInlineSuggestion(view: EditorView): boolean {
  const t = tail(view.state);
  if (t === null) return false;
  view.dispatch({
    changes: { from: view.state.doc.length, insert: t },
    selection: { anchor: view.state.doc.length + t.length },
    effects: setSuggestion.of(""),
  });
  return true;
}

function fetcherPlugin(fetch: (line: string) => Promise<string | null>) {
  return ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        if (this.timer) clearTimeout(this.timer);
        const view = update.view;
        const line = view.state.doc.toString();
        if (!line) return;
        this.timer = setTimeout(() => {
          if (view.state.doc.toString() !== line) return;
          fetch(line)
            .then((sugg) => {
              if (sugg && view.state.doc.toString() === line) {
                view.dispatch({ effects: setSuggestion.of(sugg) });
              }
            })
            .catch(() => {});
        }, 70);
      }
      destroy() {
        if (this.timer) clearTimeout(this.timer);
      }
    },
  );
}

export function inlineSuggestion(fetch: (line: string) => Promise<string | null>) {
  return [
    suggestionField,
    ghostDecorations,
    fetcherPlugin(fetch),
    Prec.highest(
      keymap.of([
        { key: "ArrowRight", run: acceptInlineSuggestion },
        { key: "End", run: acceptInlineSuggestion },
        { key: "Mod-f", run: acceptInlineSuggestion },
      ]),
    ),
  ];
}
