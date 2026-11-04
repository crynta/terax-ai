import { findCard } from "../model/layout";
import {
  activeTask,
  focusedTabId,
  locateTab,
  type WorkbenchState,
} from "../model/workbench";
import { cardFrame } from "./geometry";

export type Slot = {
  /** Shown: its card's tab, in the active task, not behind a maximized card. */
  visible: boolean;
  /** Its task's focused tab; a press in a slot that is not claims focus. */
  focused: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Where a tab is drawn and whether it is shown and focused. */
export function slotOf(state: WorkbenchState, id: number): Slot | null {
  const loc = locateTab(state, id);
  if (!loc) return null;
  const { task, cardId } = loc;
  const frame = cardFrame(task, cardId);
  if (!frame) return null;
  const visible =
    activeTask(state)?.id === task.id &&
    findCard(task.layout, cardId)?.activeTabId === id &&
    (task.maximizedCardId === null || task.maximizedCardId === cardId);
  return { visible, focused: focusedTabId(task) === id, ...frame };
}
