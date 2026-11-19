import {
  currentFocus,
  focusIsMovable,
} from "@/modules/terminal/lib/focusGuard";
import { activeTask, focusedTabId } from "./model/workbench";
import { snapshot } from "./store";

/** Checked at delivery time, including after the editor's document has loaded. */
export function canFocusTab(tabId: number): boolean {
  const task = activeTask(snapshot());
  return (
    !!task && focusedTabId(task) === tabId && focusIsMovable(currentFocus())
  );
}

