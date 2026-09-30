import { getSearchQuery } from "@codemirror/search";
import type { EditorState } from "@codemirror/state";

export function editorSearchMatchStatus(state: EditorState): {
  current: number;
  total: number;
  complete: true;
} {
  const query = getSearchQuery(state);
  if (!query.valid || query.search.length === 0) {
    return { current: 0, total: 0, complete: true };
  }
  const cursor = query.getCursor(state.doc);
  const { from, to } = state.selection.main;
  let total = 0;
  let current = 0;
  for (let item = cursor.next(); !item.done; item = cursor.next()) {
    total++;
    if (item.value.from === from && item.value.to === to) current = total;
  }
  return { current, total, complete: true };
}
