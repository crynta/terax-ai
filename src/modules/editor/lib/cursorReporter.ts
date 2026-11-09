import { countColumn, type EditorState } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { type CursorPosition, useCursorStore } from "./cursorStore";

/** 1-based line and visual column of the main cursor; a tab advances to the next tab stop. */
export function cursorPosition(state: EditorState): CursorPosition {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return {
    line: line.number,
    col: countColumn(line.text, state.tabSize, head - line.from) + 1,
  };
}

export function cursorReporter(getPath: () => string) {
  const report = (state: EditorState) =>
    useCursorStore.getState().report(getPath(), cursorPosition(state));
  return ViewPlugin.define((view) => {
    report(view.state);
    return {
      update(update) {
        if (
          update.selectionSet ||
          update.docChanged ||
          update.startState.tabSize !== update.state.tabSize
        ) {
          report(update.state);
        }
      },
      destroy() {
        useCursorStore.getState().report(getPath(), null);
      },
    };
  });
}
