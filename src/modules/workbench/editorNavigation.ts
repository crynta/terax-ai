import { whenViewHandle } from "./viewHandles";

/** Moves an editor tab's cursor, now or as soon as its pane mounts. */
export function navigateEditor(
  tabId: number,
  navigation: { line?: number; focus: boolean },
): void {
  whenViewHandle(tabId, "editor", (editor) => {
    if (navigation.line !== undefined)
      editor.gotoLine(navigation.line, { focus: navigation.focus });
    else if (navigation.focus) editor.focus();
  });
}
