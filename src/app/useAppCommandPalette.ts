import type { SearchAddon } from "@xterm/addon-search";
import { type MutableRefObject, useMemo } from "react";
import { createCommandPaletteActions } from "@/modules/command-palette";
import type { EditorPaneHandle } from "@/modules/editor";
import type { FileExplorerHandle } from "@/modules/explorer";
import type { GitHistorySearchHandle } from "@/modules/git-history";
import type { SearchInlineHandle, SearchTarget } from "@/modules/header";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import type { Tab } from "@/modules/tabs";
import type { TerminalPaneHandle } from "@/modules/terminal";

type UseAppCommandPaletteInput = {
  activeEditorHandle: EditorPaneHandle | null;
  activeId: number;
  activeLeafId: number | null;
  activeSearchAddon: SearchAddon | null;
  askFromSelection: () => void;
  cycleTab: (delta: 1 | -1) => void;
  explorerRef: MutableRefObject<FileExplorerHandle | null>;
  explorerRoot: string | null;
  focusNextPaneInTab: (tabId: number, delta: 1 | -1) => void;
  gitHistoryHandle: GitHistorySearchHandle | null;
  handleCloseTabOrPane: () => void;
  home: string | null;
  isEditorTab: boolean;
  isGitHistoryTab: boolean;
  isTerminalTab: boolean;
  openNewPrivateTab: () => void;
  openNewTab: () => void;
  openPreviewTab: (url: string) => number;
  searchInlineRef: MutableRefObject<SearchInlineHandle | null>;
  setNewEditorOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  splitActivePaneInActiveTab: (dir: "row" | "col") => void;
  tabs: Tab[];
  terminalRefs: MutableRefObject<Map<number, TerminalPaneHandle>>;
  togglePanelAndFocus: () => void;
  toggleSidebar: () => void;
};

export function useAppCommandPalette({
  activeEditorHandle,
  activeId,
  activeLeafId,
  activeSearchAddon,
  askFromSelection,
  cycleTab,
  explorerRef,
  explorerRoot,
  focusNextPaneInTab,
  gitHistoryHandle,
  handleCloseTabOrPane,
  home,
  isEditorTab,
  isGitHistoryTab,
  isTerminalTab,
  openNewPrivateTab,
  openNewTab,
  openPreviewTab,
  searchInlineRef,
  setNewEditorOpen,
  setShortcutsOpen,
  splitActivePaneInActiveTab,
  tabs,
  terminalRefs,
  togglePanelAndFocus,
  toggleSidebar,
}: UseAppCommandPaletteInput) {
  const searchTarget = useMemo<SearchTarget>(() => {
    if (isTerminalTab && activeLeafId !== null && activeSearchAddon) {
      return {
        kind: "terminal",
        addon: activeSearchAddon,
        focus: () => terminalRefs.current.get(activeLeafId)?.focus(),
      };
    }
    if (isEditorTab && activeEditorHandle) {
      return {
        kind: "editor",
        handle: activeEditorHandle,
        focus: () => activeEditorHandle.focus(),
      };
    }
    if (isGitHistoryTab && gitHistoryHandle) {
      return {
        kind: "git-history",
        handle: gitHistoryHandle,
        focus: () => {},
      };
    }
    return null;
  }, [
    activeEditorHandle,
    activeLeafId,
    activeSearchAddon,
    gitHistoryHandle,
    isEditorTab,
    isGitHistoryTab,
    isTerminalTab,
    terminalRefs,
  ]);

  const commandPaletteActions = useMemo(
    () =>
      createCommandPaletteActions({
        tabs,
        activeId,
        searchTarget,
        explorerRoot,
        home,
        openNewTab,
        openNewPrivate: openNewPrivateTab,
        openNewEditor: () => setNewEditorOpen(true),
        openNewPreview: () => openPreviewTab(""),
        closeActiveTabOrPane: handleCloseTabOrPane,
        nextTab: () => cycleTab(1),
        previousTab: () => cycleTab(-1),
        splitPaneRight: () => splitActivePaneInActiveTab("row"),
        splitPaneDown: () => splitActivePaneInActiveTab("col"),
        focusNextPane: () => focusNextPaneInTab(activeId, 1),
        focusPreviousPane: () => focusNextPaneInTab(activeId, -1),
        focusSearch: () => searchInlineRef.current?.focus(),
        focusExplorerSearch: () => explorerRef.current?.focusSearch(),
        toggleSidebar,
        toggleAi: togglePanelAndFocus,
        askAiSelection: askFromSelection,
        openSettings: () => void openSettingsWindow(),
        openShortcuts: () => setShortcutsOpen(true),
      }),
    [
      activeId,
      askFromSelection,
      cycleTab,
      explorerRef,
      explorerRoot,
      focusNextPaneInTab,
      handleCloseTabOrPane,
      home,
      openNewPrivateTab,
      openNewTab,
      openPreviewTab,
      searchInlineRef,
      searchTarget,
      setNewEditorOpen,
      setShortcutsOpen,
      splitActivePaneInActiveTab,
      tabs,
      togglePanelAndFocus,
      toggleSidebar,
    ],
  );

  return { commandPaletteActions, searchTarget };
}
