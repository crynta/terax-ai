import { whenViewHandle } from "./viewHandles";
import { canFocusTab } from "./viewFocus";

/** Moves an editor tab's cursor, now or as soon as its pane mounts. */
export function navigateEditor(
  tabId: number,
  navigation: { line?: number; focus: boolean },
): void {
  whenViewHandle(tabId, "editor", (editor) => {
    const focus = navigation.focus && canFocusTab(tabId);
    if (navigation.line !== undefined)
      editor.gotoLine(navigation.line, { focus });
    else if (focus) editor.focus();
  });
}
