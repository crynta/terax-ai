import {
  type CloseManyHazards,
  type CloseManyKind,
  type CloseManyPending,
  deletedPathTabs,
  evaluateCloseHazards,
  hasCloseManyHazards,
  hasNewCloseManyHazards,
} from "@/app/hooks/tabCloseGuards";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Tab } from "@/modules/tabs";
import { leafHasForegroundProcess } from "@/modules/terminal";
import {
  closeTabsNow,
  closeTabsReplacingLast,
  planClose,
  snapshot,
} from "@/modules/workbench";
import { useCallback, useRef, useState } from "react";

function confirmRunningTerminal(): boolean {
  return usePreferencesStore.getState().confirmCloseRunningTerminal;
}

function tabsNow(): readonly Tab[] {
  return snapshot().tabs;
}

/** Ids of `ids` that may close (a project's main task keeps its last tab). */
function closable(ids: readonly number[]): number[] {
  return planClose(snapshot(), ids).close.map((t) => t.id);
}

/**
 * Guards tab closing: dirty editors and terminals with a live foreground
 * process route through a confirmation dialog instead of closing immediately.
 * Owns the pending-close states the dialogs render from.
 */
export function useTabCloseGuards() {
  const [pendingCloseTab, setPendingCloseTab] = useState<number | null>(null);
  const [pendingTerminalCloseTab, setPendingTerminalCloseTab] = useState<
    number | null
  >(null);
  const [pendingDeleteTabs, setPendingDeleteTabs] = useState<number[] | null>(
    null,
  );
  const [pendingCloseMany, setPendingCloseMany] =
    useState<CloseManyPending | null>(null);
  const [closeManyConfirming, setCloseManyConfirming] = useState(false);
  const closeManyRequestRef = useRef(0);

  const handleClose = useCallback(async (id: number) => {
    // The main task's last tab can't close; skip the dialog so confirming it
    // doesn't appear to silently fail.
    if (closable([id]).length === 0) return;
    const t = tabsNow().find((x) => x.id === id);
    if (t?.kind === "editor" && t.dirty) {
      setPendingCloseTab(id);
      return;
    }
    if (
      t?.kind === "terminal" &&
      confirmRunningTerminal() &&
      (await leafHasForegroundProcess(t.id))
    ) {
      setPendingTerminalCloseTab(id);
      return;
    }
    closeTabsNow([id]);
  }, []);

  const captureCloseMany = useCallback((closeIds: number[]) => {
    const close = new Set(closeIds);
    const affected = tabsNow().filter((tab) => close.has(tab.id));
    return {
      dirtyIds: affected
        .filter((tab) => tab.kind === "editor" && tab.dirty)
        .map((tab) => tab.id),
      leafIds: affected
        .filter((tab) => tab.kind === "terminal")
        .map((tab) => tab.id),
    };
  }, []);

  const evaluateCloseMany = useCallback(
    (closeIds: number[]): Promise<CloseManyHazards> =>
      evaluateCloseHazards(
        () => captureCloseMany(closeIds),
        leafHasForegroundProcess,
        confirmRunningTerminal(),
      ),
    [captureCloseMany],
  );

  const handleCloseMany = useCallback(
    async (kind: CloseManyKind, anchorId: number, ids: readonly number[]) => {
      const closeIds = closable(ids);
      if (closeIds.length === 0) return;
      const requestId = ++closeManyRequestRef.current;
      const hazards = await evaluateCloseMany(closeIds);
      if (requestId !== closeManyRequestRef.current) return;
      if (hasCloseManyHazards(hazards)) {
        setPendingCloseMany({ kind, anchorId, closeIds, ...hazards });
        return;
      }
      closeTabsNow(closeIds);
    },
    [evaluateCloseMany],
  );

  const confirmCloseMany = useCallback(async () => {
    if (pendingCloseMany === null) return;
    const requestId = ++closeManyRequestRef.current;
    setCloseManyConfirming(true);
    const closeIds = closable(pendingCloseMany.closeIds);
    const hazards = await evaluateCloseMany(closeIds);
    if (requestId !== closeManyRequestRef.current) return;
    if (hasNewCloseManyHazards(pendingCloseMany, hazards)) {
      setPendingCloseMany({ ...pendingCloseMany, closeIds, ...hazards });
      setCloseManyConfirming(false);
      return;
    }
    closeTabsNow(closeIds);
    setPendingCloseMany(null);
    setCloseManyConfirming(false);
  }, [pendingCloseMany, evaluateCloseMany]);

  const cancelCloseMany = useCallback(() => {
    closeManyRequestRef.current += 1;
    setPendingCloseMany(null);
    setCloseManyConfirming(false);
  }, []);

  const confirmClose = useCallback(() => {
    if (pendingCloseTab !== null) {
      closeTabsNow([pendingCloseTab]);
      setPendingCloseTab(null);
    }
  }, [pendingCloseTab]);

  const cancelClose = useCallback(() => {
    setPendingCloseTab(null);
  }, []);

  const confirmTerminalClose = useCallback(() => {
    if (pendingTerminalCloseTab !== null)
      closeTabsNow([pendingTerminalCloseTab]);
    setPendingTerminalCloseTab(null);
  }, [pendingTerminalCloseTab]);

  const cancelTerminalClose = useCallback(() => {
    setPendingTerminalCloseTab(null);
  }, []);

  const confirmDeleteClose = useCallback(() => {
    if (pendingDeleteTabs !== null) {
      closeTabsReplacingLast(pendingDeleteTabs);
      setPendingDeleteTabs(null);
    }
  }, [pendingDeleteTabs]);

  const cancelDeleteClose = useCallback(() => {
    setPendingDeleteTabs(null);
  }, []);

  const handlePathsDeleted = useCallback((paths: string[]) => {
    const affected = deletedPathTabs(tabsNow(), paths);
    closeTabsReplacingLast(affected.cleanIds);
    if (affected.dirtyIds.length > 0) {
      setPendingDeleteTabs((current) => [
        ...new Set([...(current ?? []), ...affected.dirtyIds]),
      ]);
    }
  }, []);

  return {
    pendingCloseTab,
    pendingTerminalCloseTab,
    pendingDeleteTabs,
    pendingCloseMany,
    closeManyConfirming,
    handleClose,
    handleCloseMany,
    confirmClose,
    cancelClose,
    confirmTerminalClose,
    cancelTerminalClose,
    confirmDeleteClose,
    cancelDeleteClose,
    confirmCloseMany,
    cancelCloseMany,
    handlePathsDeleted,
  };
}
