import type { Tab } from "@/modules/tabs/lib/tabs";
import { disposeSession } from "@/modules/terminal/lib/terminalSessionApi";
import { create } from "zustand";
import type { LayoutNode } from "./model/layout";
import {
  activeTabId,
  activeTask,
  EMPTY_WORKBENCH,
  type WorkbenchState,
  warmVisible,
} from "./model/workbench";
import { forgetViewHandles } from "./viewHandles";

function maxLayoutId(node: LayoutNode): number {
  if (node.kind === "card") return node.id;
  return Math.max(node.id, ...node.children.map(maxLayoutId));
}

type Store = WorkbenchState & {
  /** Boot finished restoring; gates warming so nothing spawns before it. */
  booted: boolean;
};

export const useWorkbench = create<Store>(() => ({
  ...EMPTY_WORKBENCH,
  booted: false,
}));

let nextId = 1;

/** Allocates ids for tabs, cards, splits and tasks from one counter. */
export function allocId(): number {
  return nextId++;
}

export function snapshot(): WorkbenchState {
  return useWorkbench.getState();
}

type CommitListener = (prev: WorkbenchState, next: WorkbenchState) => void;
const listeners = new Set<CommitListener>();

/** Runs after every commit that changed state (project sync, etc.). */
export function onCommit(listener: CommitListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The single write path. Warms on-screen restored tabs, disposes terminal
 * sessions and view handles of tabs that left the workbench.
 */
export function commit(update: (state: WorkbenchState) => WorkbenchState) {
  const prev = useWorkbench.getState();
  let next = update(prev);
  if (next === prev) return prev;
  if (prev.booted) next = warmVisible(next);
  useWorkbench.setState(next);
  if (next.tabs !== prev.tabs) releaseClosedTabs(prev.tabs, next.tabs);
  for (const listener of listeners) listener(prev, next);
  return next;
}

function releaseClosedTabs(prev: readonly Tab[], next: readonly Tab[]) {
  if (prev.length === 0) return;
  const live = new Set(next.map((t) => t.id));
  for (const tab of prev) {
    if (live.has(tab.id)) continue;
    if (tab.kind === "terminal") disposeSession(tab.id);
    forgetViewHandles(tab.id);
  }
}

/** Replaces the whole workbench (boot restore). */
export function hydrateWorkbench(state: WorkbenchState) {
  let max = 0;
  for (const tab of state.tabs) max = Math.max(max, tab.id);
  for (const task of state.tasks)
    max = Math.max(max, task.id, maxLayoutId(task.layout));
  nextId = Math.max(nextId, max + 1);
  commit(() => state);
}

export function markBooted() {
  useWorkbench.setState({ booted: true });
  commit(warmVisible);
}

export function useActiveTabId(): number | null {
  return useWorkbench(activeTabId);
}

export function useActiveTask() {
  return useWorkbench((s) => activeTask(s));
}
