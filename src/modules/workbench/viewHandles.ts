import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import type { GitHistorySearchHandle } from "@/modules/git-history/GitHistoryPane";
import type { PreviewPaneHandle } from "@/modules/preview/PreviewPane";
import type { TerminalSearchController } from "@/modules/terminal/search/TerminalSearchController";
import type { TerminalPaneHandle } from "@/modules/terminal/TerminalPane";
import { useSyncExternalStore } from "react";

type Handles = {
  terminal: TerminalPaneHandle;
  search: TerminalSearchController;
  editor: EditorPaneHandle;
  preview: PreviewPaneHandle;
  gitHistory: GitHistorySearchHandle;
};

export type ViewHandleKind = keyof Handles;

const registry = new Map<number, Partial<Handles>>();
const listeners = new Set<() => void>();

type Pending = {
  kind: ViewHandleKind;
  run: (handle: never) => void;
  timer: ReturnType<typeof setTimeout>;
};
const pending = new Map<number, Pending[]>();

/** How long an action waits for a view that has not mounted yet. */
const PENDING_VIEW_MS = 10_000;

function dropPending(tabId: number, entry?: Pending) {
  const list = pending.get(tabId);
  if (!list) return;
  const rest = entry ? list.filter((p) => p !== entry) : [];
  for (const p of list) if (!rest.includes(p)) clearTimeout(p.timer);
  if (rest.length === 0) pending.delete(tabId);
  else pending.set(tabId, rest);
}

/**
 * Runs `action` with a tab's handle now, or once the view mounts (views load
 * lazily and register after the commit that opened them).
 */
export function whenViewHandle<K extends ViewHandleKind>(
  tabId: number,
  kind: K,
  action: (handle: Handles[K]) => void,
): void {
  const handle = viewHandle(tabId, kind);
  if (handle) {
    action(handle);
    return;
  }
  const entry: Pending = {
    kind,
    run: action as (handle: never) => void,
    timer: setTimeout(() => dropPending(tabId, entry), PENDING_VIEW_MS),
  };
  pending.set(tabId, [...(pending.get(tabId) ?? []), entry]);
}

function runPending(tabId: number, kind: ViewHandleKind, handle: unknown) {
  const list = pending.get(tabId);
  if (!list) return;
  for (const entry of list.filter((p) => p.kind === kind)) {
    dropPending(tabId, entry);
    clearTimeout(entry.timer);
    entry.run(handle as never);
  }
}

function emit() {
  for (const listener of listeners) listener();
}

/** Notified whenever a handle registers or leaves. */
export function subscribeViewHandles(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setViewHandle<K extends ViewHandleKind>(
  tabId: number,
  kind: K,
  handle: Handles[K] | null,
): void {
  const entry = registry.get(tabId);
  if (handle) {
    if (entry?.[kind] === handle) return;
    registry.set(tabId, { ...entry, [kind]: handle });
    emit();
    runPending(tabId, kind, handle);
    return;
  }
  if (!entry?.[kind]) return;
  const next = { ...entry };
  delete next[kind];
  if (Object.keys(next).length === 0) registry.delete(tabId);
  else registry.set(tabId, next);
  emit();
}

export function viewHandle<K extends ViewHandleKind>(
  tabId: number | null | undefined,
  kind: K,
): Handles[K] | undefined {
  if (tabId === null || tabId === undefined) return undefined;
  return registry.get(tabId)?.[kind] as Handles[K] | undefined;
}

/**
 * A tab's handle as React state: the component re-renders when it registers or
 * leaves. Reads go through useSyncExternalStore, so a compiler-memoized read
 * of the mutable registry can never go stale.
 */
export function useViewHandle<K extends ViewHandleKind>(
  tabId: number | null | undefined,
  kind: K,
): Handles[K] | undefined {
  const read = () => viewHandle(tabId, kind);
  return useSyncExternalStore(subscribeViewHandles, read, read);
}

export function forgetViewHandles(tabId: number): void {
  dropPending(tabId);
  if (registry.delete(tabId)) emit();
}
