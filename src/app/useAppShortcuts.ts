import { type MutableRefObject, useCallback, useMemo, useState } from "react";
import type { EditorPaneHandle } from "@/modules/editor";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import {
  type ShortcutHandlers,
  type ShortcutId,
  useGlobalShortcuts,
} from "@/modules/shortcuts";
import type { Tab } from "@/modules/tabs";
import { clearFocusedTerminal, leafIds } from "@/modules/terminal";

type UseAppShortcutsInput = {
  activeId: number;
  activeTab: Tab | undefined;
  askFromSelection: () => void;
  captureActiveSelection: () => string | null;
  closeActivePane: (tabId: number) => void;
  focusNextPaneInTab: (tabId: number, delta: 1 | -1) => void;
  handleClose: (tabId: number) => Promise<void>;
  openNewPrivateTab: () => void;
  openNewTab: () => void;
  openPreviewTab: (url: string) => number;
  searchInlineRef: MutableRefObject<{ focus: () => void } | null>;
  selectByIndex: (index: number) => void;
  setActiveId: (id: number) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setNewEditorOpen: (open: boolean) => void;
  setShortcutsOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  splitActivePane: (tabId: number, dir: "row" | "col") => void;
  tabs: Tab[];
  tabsRef: MutableRefObject<Tab[]>;
  toggleExplorerFocus: () => void;
  togglePanelAndFocus: () => void;
  toggleSidebar: () => void;
  toggleSourceControl: () => void;
  editorRefs: MutableRefObject<Map<number, EditorPaneHandle>>;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
};

export function useAppShortcuts({
  activeId,
  activeTab,
  askFromSelection,
  captureActiveSelection,
  closeActivePane,
  editorRefs,
  focusNextPaneInTab,
  handleClose,
  openNewPrivateTab,
  openNewTab,
  openPreviewTab,
  searchInlineRef,
  selectByIndex,
  setActiveId,
  setCommandPaletteOpen,
  setNewEditorOpen,
  setShortcutsOpen,
  splitActivePane,
  tabs,
  tabsRef,
  toggleExplorerFocus,
  togglePanelAndFocus,
  toggleSidebar,
  toggleSourceControl,
  zoomIn,
  zoomOut,
  zoomReset,
}: UseAppShortcutsInput) {
  const [zenMode, setZenMode] = useState(false);

  const cycleTab = useCallback(
    (delta: 1 | -1) => {
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((tab) => tab.id === activeId);
      const nextIdx = (idx + delta + tabs.length) % tabs.length;
      setActiveId(tabs[nextIdx].id);
    },
    [activeId, setActiveId, tabs],
  );

  const splitActivePaneInActiveTab = useCallback(
    (dir: "row" | "col") => {
      const tab = tabsRef.current.find(
        (candidate) => candidate.id === activeId,
      );
      if (!tab || tab.kind !== "terminal") return;
      splitActivePane(activeId, dir);
    },
    [activeId, splitActivePane, tabsRef],
  );

  const handleCloseTabOrPane = useCallback(() => {
    const tab = tabsRef.current.find((candidate) => candidate.id === activeId);
    if (tab?.kind === "terminal" && leafIds(tab.paneTree).length > 1) {
      closeActivePane(activeId);
      return;
    }
    void handleClose(activeId);
  }, [activeId, closeActivePane, handleClose, tabsRef]);

  const shortcutHandlers = useMemo<ShortcutHandlers>(
    () => ({
      "commandPalette.open": () => setCommandPaletteOpen(true),
      "tab.new": openNewTab,
      "tab.newPrivate": openNewPrivateTab,
      "tab.newPreview": () => openPreviewTab(""),
      "tab.newEditor": () => setNewEditorOpen(true),
      "tab.close": handleCloseTabOrPane,
      "tab.next": () => cycleTab(1),
      "tab.prev": () => cycleTab(-1),
      "tab.selectByIndex": (event) =>
        selectByIndex(parseInt(event.key, 10) - 1),
      "pane.splitRight": () => splitActivePaneInActiveTab("row"),
      "pane.splitDown": () => splitActivePaneInActiveTab("col"),
      "pane.focusNext": () => focusNextPaneInTab(activeId, 1),
      "pane.focusPrev": () => focusNextPaneInTab(activeId, -1),
      "pane.source": toggleSourceControl,
      "terminal.clear": () => clearFocusedTerminal(),
      "search.focus": () => searchInlineRef.current?.focus(),
      "ai.toggle": togglePanelAndFocus,
      "ai.askSelection": askFromSelection,
      "shortcuts.open": () => setShortcutsOpen((value) => !value),
      "settings.open": () => void openSettingsWindow(),
      "sidebar.toggle": toggleSidebar,
      "explorer.focus": toggleExplorerFocus,
      "view.zoomIn": zoomIn,
      "view.zoomOut": zoomOut,
      "view.zoomReset": zoomReset,
      "view.zenMode": () => setZenMode((value) => !value),
      "editor.undo": () => editorRefs.current.get(activeId)?.undo(),
      "editor.redo": () => editorRefs.current.get(activeId)?.redo(),
    }),
    [
      activeId,
      askFromSelection,
      cycleTab,
      editorRefs,
      focusNextPaneInTab,
      handleCloseTabOrPane,
      openNewPrivateTab,
      openNewTab,
      openPreviewTab,
      searchInlineRef,
      selectByIndex,
      setCommandPaletteOpen,
      setNewEditorOpen,
      setShortcutsOpen,
      splitActivePaneInActiveTab,
      toggleExplorerFocus,
      togglePanelAndFocus,
      toggleSidebar,
      toggleSourceControl,
      zoomIn,
      zoomOut,
      zoomReset,
    ],
  );

  const shortcutsDisabled = useCallback(
    (id: ShortcutId, event: KeyboardEvent) => {
      if (id === "editor.undo" || id === "editor.redo") {
        return activeTab?.kind !== "editor";
      }
      if (id === "ai.askSelection") {
        const target =
          (event.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!target?.closest?.(".xterm");
        if (!inTerminal) return false;
        const selection = captureActiveSelection();
        return !selection || !selection.trim();
      }
      if (id === "terminal.clear") {
        // Only intercept ⌘K while a terminal is focused; elsewhere let the key
        // fall through (we never preventDefault when disabled).
        const target =
          (event.target as HTMLElement | null) ?? document.activeElement;
        return !target?.closest?.(".xterm");
      }
      if (id === "sidebar.toggle") {
        // Ctrl+B is also Claude Code's "run in background" key. While a terminal
        // is focused, let Ctrl+B reach the shell/Claude instead of toggling the
        // sidebar. Ctrl+Shift+B (second binding) still toggles it from anywhere.
        const target =
          (event.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!target?.closest?.(".xterm");
        return inTerminal && !event.shiftKey;
      }
      return false;
    },
    [activeTab, captureActiveSelection],
  );

  useGlobalShortcuts(shortcutHandlers, { isDisabled: shortcutsDisabled });

  return {
    cycleTab,
    handleCloseTabOrPane,
    splitActivePaneInActiveTab,
    zenMode,
  };
}
