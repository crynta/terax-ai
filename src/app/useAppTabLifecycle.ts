import type { SearchAddon } from "@xterm/addon-search";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { EditorPaneHandle } from "@/modules/editor";
import type { PreviewPaneHandle } from "@/modules/preview";
import type { Tab } from "@/modules/tabs";
import {
  disposeSession,
  leafHasForegroundProcess,
  leafIds,
  type TerminalPaneHandle,
} from "@/modules/terminal";

type LifecycleRefs = {
  editorRefs: RefObject<Map<number, EditorPaneHandle>>;
  previewRefs: RefObject<Map<number, PreviewPaneHandle>>;
  searchAddons: RefObject<Map<number, SearchAddon>>;
  terminalRefs: RefObject<Map<number, TerminalPaneHandle>>;
};

type UseAppTabLifecycleInput = LifecycleRefs & {
  activeId: number;
  activeLeafId: number | null;
  closeTab: (id: number) => void;
  tabs: Tab[];
};

export function useAppTabLifecycle({
  activeId,
  activeLeafId,
  closeTab,
  editorRefs,
  previewRefs,
  searchAddons,
  tabs,
  terminalRefs,
}: UseAppTabLifecycleInput) {
  const [activeEditorHandle, setActiveEditorHandle] =
    useState<EditorPaneHandle | null>(null);
  const [activeSearchAddon, setActiveSearchAddon] =
    useState<SearchAddon | null>(null);
  const [pendingCloseTab, setPendingCloseTab] = useState<number | null>(null);
  const [pendingTerminalCloseTab, setPendingTerminalCloseTab] = useState<
    number | null
  >(null);
  const liveLeavesRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    setActiveSearchAddon(
      activeLeafId !== null
        ? (searchAddons.current.get(activeLeafId) ?? null)
        : null,
    );
    setActiveEditorHandle(editorRefs.current.get(activeId) ?? null);
  }, [activeId, activeLeafId, editorRefs, searchAddons]);

  const handleSearchReady = useCallback(
    (leafId: number, addon: SearchAddon) => {
      searchAddons.current.set(leafId, addon);
      if (leafId === activeLeafId) setActiveSearchAddon(addon);
    },
    [activeLeafId, searchAddons],
  );

  const disposeTab = useCallback(
    (id: number) => {
      editorRefs.current.delete(id);
      previewRefs.current.delete(id);
      closeTab(id);
    },
    [closeTab, editorRefs, previewRefs],
  );

  useEffect(() => {
    const live = new Set<number>();
    for (const tab of tabs) {
      if (tab.kind === "terminal") {
        for (const id of leafIds(tab.paneTree)) live.add(id);
      }
    }
    for (const id of liveLeavesRef.current) {
      if (!live.has(id)) disposeSession(id);
    }
    liveLeavesRef.current = live;
    for (const id of [...terminalRefs.current.keys()]) {
      if (!live.has(id)) terminalRefs.current.delete(id);
    }
    for (const id of [...searchAddons.current.keys()]) {
      if (!live.has(id)) searchAddons.current.delete(id);
    }
  }, [searchAddons, tabs, terminalRefs]);

  const handleClose = useCallback(
    async (id: number) => {
      const tab = tabs.find((candidate) => candidate.id === id);
      if ((tab?.kind === "editor" || tab?.kind === "workflow") && tab.dirty) {
        setPendingCloseTab(id);
        return;
      }
      if (tab?.kind === "terminal") {
        const leaves = leafIds(tab.paneTree);
        const checks = await Promise.all(leaves.map(leafHasForegroundProcess));
        if (checks.some(Boolean)) {
          setPendingTerminalCloseTab(id);
          return;
        }
      }
      disposeTab(id);
    },
    [disposeTab, tabs],
  );

  const confirmClose = useCallback(() => {
    if (pendingCloseTab !== null) {
      disposeTab(pendingCloseTab);
      setPendingCloseTab(null);
    }
  }, [disposeTab, pendingCloseTab]);

  const cancelClose = useCallback(() => {
    setPendingCloseTab(null);
  }, []);

  return {
    activeEditorHandle,
    activeSearchAddon,
    cancelClose,
    confirmClose,
    disposeTab,
    handleClose,
    handleSearchReady,
    pendingCloseTab,
    pendingTerminalCloseTab,
    setActiveEditorHandle,
    setPendingTerminalCloseTab,
  };
}
