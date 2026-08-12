import { useCallback, useState } from "react";
import { leafHasForegroundProcess, leafIds } from "@/modules/terminal";
import {
  nextActiveInSpace,
  planCloseOtherTabs,
  planCloseTabsToRight,
  type Tab,
} from "@/modules/tabs";

type CloseManyKind = "right" | "other";

type Params = {
  tabs: Tab[];
  activeId: number;
  disposeTab: (id: number) => void;
  disposeTabsToRight: (anchorId: number) => void;
  disposeOtherTabs: (anchorId: number) => void;
};

type CloseManyPending = {
  kind: CloseManyKind;
  anchorId: number;
  closeIds: number[];
  dirtyCount: number;
  busy: boolean;
};

/**
 * Guards tab closing: dirty editors and terminals with a live foreground
 * process route through a confirmation dialog instead of closing immediately.
 * Owns the pending-close states the dialogs render from.
 */
export function useTabCloseGuards({
  tabs,
  activeId,
  disposeTab,
  disposeTabsToRight,
  disposeOtherTabs,
}: Params) {
  const [pendingCloseTab, setPendingCloseTab] = useState<number | null>(null);
  const [pendingTerminalCloseTab, setPendingTerminalCloseTab] = useState<
    number | null
  >(null);
  const [pendingDeleteTabs, setPendingDeleteTabs] = useState<number[] | null>(
    null,
  );
  const [pendingCloseMany, setPendingCloseMany] =
    useState<CloseManyPending | null>(null);

  const handleClose = useCallback(
    async (id: number) => {
      // Last tab in its space can't be closed (closeTab refuses). Skip the
      // dialog entirely so confirming it doesn't appear to silently fail.
      if (nextActiveInSpace(tabs, id) === null) return;
      const t = tabs.find((x) => x.id === id);
      if (t?.kind === "editor" && t.dirty) {
        setPendingCloseTab(id);
        return;
      }
      if (t?.kind === "terminal") {
        const leaves = leafIds(t.paneTree);
        const checks = await Promise.all(leaves.map(leafHasForegroundProcess));
        if (checks.some(Boolean)) {
          setPendingTerminalCloseTab(id);
          return;
        }
      }
      disposeTab(id);
    },
    [tabs, disposeTab],
  );

  const handleCloseMany = useCallback(
    async (kind: CloseManyKind, closeIds: number[], anchorId: number) => {
      if (closeIds.length === 0) return;
      const affected = tabs.filter((t) => closeIds.includes(t.id));
      const dirty = affected.some((t) => t.kind === "editor" && t.dirty);
      const leaves = affected
        .filter((t) => t.kind === "terminal")
        .flatMap((t) => leafIds(t.paneTree));
      const busy =
        leaves.length > 0 &&
        (await Promise.all(leaves.map(leafHasForegroundProcess))).some(Boolean);
      if (dirty || busy) {
        setPendingCloseMany({
          kind,
          anchorId,
          closeIds,
          dirtyCount: affected.filter((t) => t.kind === "editor" && t.dirty)
            .length,
          busy,
        });
        return;
      }
      if (kind === "right") disposeTabsToRight(anchorId);
      else disposeOtherTabs(anchorId);
    },
    [tabs, disposeTabsToRight, disposeOtherTabs],
  );

  const handleCloseTabsToRight = useCallback(
    async (anchorId: number) => {
      const { closeIds } = planCloseTabsToRight(tabs, anchorId, activeId);
      handleCloseMany("right", closeIds, anchorId);
    },
    [tabs, activeId, handleCloseMany],
  );

  const handleCloseOtherTabs = useCallback(
    async (anchorId: number) => {
      const { closeIds } = planCloseOtherTabs(tabs, anchorId, activeId);
      handleCloseMany("other", closeIds, anchorId);
    },
    [tabs, activeId, handleCloseMany],
  );

  const confirmCloseMany = useCallback(() => {
    if (pendingCloseMany !== null) {
      const { kind, anchorId } = pendingCloseMany;
      if (kind === "right") disposeTabsToRight(anchorId);
      else disposeOtherTabs(anchorId);
      setPendingCloseMany(null);
    }
  }, [pendingCloseMany, disposeTabsToRight, disposeOtherTabs]);

  const cancelCloseMany = useCallback(() => {
    setPendingCloseMany(null);
  }, []);

  const confirmClose = useCallback(() => {
    if (pendingCloseTab !== null) {
      disposeTab(pendingCloseTab);
      setPendingCloseTab(null);
    }
  }, [pendingCloseTab, disposeTab]);

  const cancelClose = useCallback(() => {
    setPendingCloseTab(null);
  }, []);

  const confirmTerminalClose = useCallback(() => {
    if (pendingTerminalCloseTab !== null) disposeTab(pendingTerminalCloseTab);
    setPendingTerminalCloseTab(null);
  }, [pendingTerminalCloseTab, disposeTab]);

  const cancelTerminalClose = useCallback(() => {
    setPendingTerminalCloseTab(null);
  }, []);

  const confirmDeleteClose = useCallback(() => {
    if (pendingDeleteTabs !== null) {
      for (const id of pendingDeleteTabs) disposeTab(id);
      setPendingDeleteTabs(null);
    }
  }, [pendingDeleteTabs, disposeTab]);

  const cancelDeleteClose = useCallback(() => {
    setPendingDeleteTabs(null);
  }, []);

  const handlePathDeleted = useCallback(
    (path: string) => {
      const dirty: number[] = [];
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path !== path && !t.path.startsWith(`${path}/`)) continue;
        if (t.dirty) {
          dirty.push(t.id);
        } else {
          disposeTab(t.id);
        }
      }
      if (dirty.length > 0) setPendingDeleteTabs(dirty);
    },
    [tabs, disposeTab],
  );

  return {
    pendingCloseTab,
    pendingTerminalCloseTab,
    pendingDeleteTabs,
    pendingCloseMany,
    handleClose,
    handleCloseTabsToRight,
    handleCloseOtherTabs,
    confirmClose,
    cancelClose,
    confirmTerminalClose,
    cancelTerminalClose,
    confirmDeleteClose,
    cancelDeleteClose,
    confirmCloseMany,
    cancelCloseMany,
    handlePathDeleted,
  };
}
