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

export function cursorTracker(getPath: () => string) {
  const { report } = useCursorStore.getState();
  // A rename changes getPath() under a live view, so remember what this view reported.
  let path = getPath();
  return {
    sync(state: EditorState) {
      if (path !== getPath()) {
        report(path, null);
        path = getPath();
      }
      report(path, cursorPosition(state));
    },
    clear: () => report(path, null),
  };
}

export function cursorReporter(getPath: () => string) {
  return ViewPlugin.define((view) => {
    const tracker = cursorTracker(getPath);
    tracker.sync(view.state);
    return {
      update(update) {
        if (
          update.selectionSet ||
          update.docChanged ||
          update.startState.tabSize !== update.state.tabSize
        ) {
          tracker.sync(update.state);
        }
      },
      destroy: tracker.clear,
    };
  });
}
