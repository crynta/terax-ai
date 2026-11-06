import {
  currentFocus,
  focusIsMovable,
} from "@/modules/terminal/lib/focusGuard";
import { activeTask, focusedTabId } from "./model/workbench";
import { snapshot } from "./store";
import { whenViewHandle } from "./viewHandles";

/** Checked at delivery time, including after the editor's document has loaded. */
export function canFocusEditor(tabId: number): boolean {
  const task = activeTask(snapshot());
  return (
    !!task && focusedTabId(task) === tabId && focusIsMovable(currentFocus())
  );
}

/** Moves an editor tab's cursor, now or as soon as its pane mounts. */
export function navigateEditor(
  tabId: number,
  navigation: { line?: number; focus: boolean },
): void {
  whenViewHandle(tabId, "editor", (editor) => {
    const focus = navigation.focus && canFocusEditor(tabId);
    if (navigation.line !== undefined)
      editor.gotoLine(navigation.line, { focus });
    else if (focus) editor.focus();
  });
}
