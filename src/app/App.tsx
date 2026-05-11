import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import { remoteUriPath } from "@/lib/paths";
import { useAutoUiScale } from "@/lib/useAutoUiScale";
import { cn } from "@/lib/utils";
import {
  AgentRunBridge,
  AiInputBar,
  AiMiniWindow,
  getAllKeys,
  hasAnyKey,
  SelectionAskAi,
  useChatStore,
} from "@/modules/ai";
import { AiInputBarConnect } from "@/modules/ai/components/AiInputBar";
import { AiComposerProvider } from "@/modules/ai/lib/composer";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import { useSnippetsStore } from "@/modules/ai/store/snippetsStore";
import {
  AiDiffStack,
  EditorStack,
  NewEditorDialog,
  type EditorPaneHandle,
} from "@/modules/editor";
import { FileExplorer } from "@/modules/explorer";
import {
  Header,
  type SearchInlineHandle,
  type SearchTarget,
} from "@/modules/header";
import { PreviewStack, type PreviewPaneHandle } from "@/modules/preview";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { onKeysChanged } from "@/modules/settings/store";
import {
  ShortcutsDialog,
  useGlobalShortcuts,
  type ShortcutHandlers,
} from "@/modules/shortcuts";
import { StatusBar } from "@/modules/statusbar";
import { MAX_PANES_PER_TAB, useTabs, useWorkspaceCwd } from "@/modules/tabs";
import {
  disposeSession,
  findLeafCwd,
  hasLeaf,
  leafIds,
  respawnSession,
  TerminalStack,
  type DetectedSshCommand,
  type TerminalPaneHandle,
  type TeraxOpenInput,
} from "@/modules/terminal";
import { ThemeProvider } from "@/modules/theme";
import { UpdaterDialog } from "@/modules/updater";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { SearchAddon } from "@xterm/addon-search";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.host === ub.host && ua.protocol === ub.protocol;
  } catch {
    return a === b;
  }
}

type RemoteUploadResult = {
  local_path: string;
  remote_uri: string;
  remote_path: string;
  size: number;
};

function isRemotePath(path: string | null | undefined): path is string {
  return !!path?.startsWith("ssh://");
}

function shellQuote(path: string): string {
  if (path.length === 0) return "''";
  if (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(path)) return path;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

function hasUnsafeShellControl(path: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(path);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function dragPositionToElement(
  position: { x: number; y: number } | undefined,
): Element | null {
  if (!position) return null;
  const ratio = window.devicePixelRatio || 1;
  return document.elementFromPoint(position.x / ratio, position.y / ratio);
}

export default function App() {
  const {
    tabs,
    activeId,
    setActiveId,
    newTab,
    openFileTab,
    pinTab,
    newPreviewTab,
    openAiDiffTab,
    setAiDiffStatus,
    closeTab,
    updateTab,
    selectByIndex,
    setLeafCwd,
    focusPane,
    focusNextPaneInTab,
    splitActivePane,
    closeActivePane,
    closePaneByLeaf,
  } = useTabs();

  // Mirror `tabs` into a ref so callbacks scheduled with `setTimeout`
  // (e.g. cdInNewTab) read the latest pane state instead of a stale closure.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const activeTerminalTab = useMemo(() => {
    const t = tabs.find((x) => x.id === activeId);
    return t && t.kind === "terminal" ? t : null;
  }, [tabs, activeId]);
  const activeLeafId = activeTerminalTab?.activeLeafId ?? null;

  const searchAddons = useRef<Map<number, SearchAddon>>(new Map());
  const [activeSearchAddon, setActiveSearchAddon] =
    useState<SearchAddon | null>(null);
  const searchInlineRef = useRef<SearchInlineHandle | null>(null);
  const terminalRefs = useRef<Map<number, TerminalPaneHandle>>(new Map());
  const editorRefs = useRef<Map<number, EditorPaneHandle>>(new Map());
  const previewRefs = useRef<Map<number, PreviewPaneHandle>>(new Map());
  const detectedUrls = useRef<Map<number, string>>(new Map());
  const detectedSsh = useRef<Map<number, DetectedSshCommand>>(new Map());
  const [activeDetectedUrl, setActiveDetectedUrl] = useState<string | null>(
    null,
  );
  const [activeDetectedSsh, setActiveDetectedSsh] =
    useState<DetectedSshCommand | null>(null);
  const [activeEditorHandle, setActiveEditorHandle] =
    useState<EditorPaneHandle | null>(null);
  const refitTerminals = useCallback(() => {
    terminalRefs.current.forEach((terminal) => terminal.refit());
  }, []);
  useAutoUiScale(refitTerminals);
  const sidebarRef = useRef<PanelImperativeHandle | null>(null);
  const toggleSidebar = useCallback(() => {
    const p = sidebarRef.current;
    if (!p) return;
    if (p.getSize().asPercentage <= 0) p.expand();
    else p.collapse();
  }, []);

  const [home, setHome] = useState<string | null>(null);
  useEffect(() => {
    // Forward-slash form so explorerRoot stays equal across home → OSC 7.
    homeDir()
      .then((p) => setHome(p.replace(/\\/g, "/")))
      .catch(() => setHome(null));
  }, []);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newEditorOpen, setNewEditorOpen] = useState(false);
  const miniOpen = useChatStore((s) => s.mini.open);
  const openMini = useChatStore((s) => s.openMini);
  const focusInput = useChatStore((s) => s.focusInput);
  const openPanel = useChatStore((s) => s.openPanel);
  const panelOpen = useChatStore((s) => s.panelOpen);
  const apiKeys = useChatStore((s) => s.apiKeys);
  const setApiKeys = useChatStore((s) => s.setApiKeys);
  const setSelectedModelId = useChatStore((s) => s.setSelectedModelId);
  const setLive = useChatStore((s) => s.setLive);
  const respondToApproval = useChatStore((s) => s.respondToApproval);
  const hasComposer = hasAnyKey(apiKeys);

  const [keysLoaded, setKeysLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const reload = () => {
      void getAllKeys().then((keys) => {
        if (!alive) return;
        setApiKeys(keys);
        setKeysLoaded(true);
      });
    };
    reload();
    const unlistenP = onKeysChanged(reload);
    return () => {
      alive = false;
      void unlistenP.then((fn) => fn());
    };
  }, [setApiKeys]);

  // Hydrate the cross-window preference store and mirror the default model
  // into chatStore so the dropdown reflects what the user picked in Settings.
  const initPrefs = usePreferencesStore((s) => s.init);
  const prefDefaultModel = usePreferencesStore((s) => s.defaultModelId);
  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  useEffect(() => {
    void initPrefs();
  }, [initPrefs]);
  useEffect(() => {
    if (!prefsHydrated) return;
    setSelectedModelId(prefDefaultModel);
  }, [prefsHydrated, prefDefaultModel, setSelectedModelId]);

  const hydrateSessions = useChatStore((s) => s.hydrateSessions);
  useEffect(() => {
    void hydrateSessions();
    void useAgentsStore.getState().hydrate();
    void useSnippetsStore.getState().hydrate();
  }, [hydrateSessions]);

  const activeTab = tabs.find((t) => t.id === activeId);
  const isTerminalTab = activeTab?.kind === "terminal";
  const isEditorTab = activeTab?.kind === "editor";
  const isPreviewTab = activeTab?.kind === "preview";
  const isAiDiffTab = activeTab?.kind === "ai-diff";

  // When an AI diff is approved (write_file applied to disk), reload any
  // open editor tabs for that path so the user sees the new content. We
  // track which approvalIds we've already handled to fire the reload only
  // once per applied diff.
  const appliedDiffsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const t of tabs) {
      if (t.kind !== "ai-diff") continue;
      if (t.status !== "approved") continue;
      if (appliedDiffsRef.current.has(t.approvalId)) continue;
      appliedDiffsRef.current.add(t.approvalId);
      for (const e of tabs) {
        if (e.kind !== "editor") continue;
        if (e.path !== t.path) continue;
        editorRefs.current.get(e.id)?.reload();
      }
    }
  }, [tabs]);

  const { explorerRoot, inheritedCwdForNewTab } = useWorkspaceCwd(
    activeTab,
    tabs,
    home,
  );
  const [explorerRootOverride, setExplorerRootOverride] = useState<
    string | null
  >(null);
  const activeExplorerRoot = explorerRootOverride ?? explorerRoot;
  const activeLeafCwd =
    activeTerminalTab && activeLeafId !== null
      ? (findLeafCwd(activeTerminalTab.paneTree, activeLeafId) ??
        activeTerminalTab.cwd ??
        null)
      : null;

  useEffect(() => {
    setActiveSearchAddon(
      activeLeafId !== null ? (searchAddons.current.get(activeLeafId) ?? null) : null,
    );
    setActiveEditorHandle(editorRefs.current.get(activeId) ?? null);
    setActiveDetectedUrl(
      activeLeafId !== null ? (detectedUrls.current.get(activeLeafId) ?? null) : null,
    );
    setActiveDetectedSsh(
      activeLeafId !== null ? (detectedSsh.current.get(activeLeafId) ?? null) : null,
    );
  }, [activeId, activeLeafId]);

  const handleDetectedLocalUrl = useCallback(
    (leafId: number, url: string) => {
      detectedUrls.current.set(leafId, url);
      if (leafId === activeLeafId) setActiveDetectedUrl(url);
    },
    [activeLeafId],
  );

  const openRemoteRootForSsh = useCallback(
    async (leafId: number, detected: DetectedSshCommand) => {
      let root = detected.uri;
      try {
        root = await invoke<string>("fs_remote_home", { uri: detected.uri });
      } catch (err) {
        console.warn("Failed to resolve remote SSH home:", err);
      }
      setLeafCwd(leafId, root);
      if (leafId === activeLeafId) {
        setExplorerRootOverride(root);
        setActiveDetectedSsh(detected);
      }
      return root;
    },
    [activeLeafId, setLeafCwd],
  );

  const handleDetectedSsh = useCallback(
    (leafId: number, detected: DetectedSshCommand) => {
      detectedSsh.current.set(leafId, detected);
      if (leafId === activeLeafId) setActiveDetectedSsh(detected);
      void openRemoteRootForSsh(leafId, detected).catch((err) => {
        console.warn("Failed to open SSH remote root:", err);
      });
    },
    [activeLeafId, openRemoteRootForSsh],
  );

  // Suppress the chip once a preview tab already targets the detected URL —
  // avoids prompting users to re-open a tab they already have.
  const detectedPreviewUrl = useMemo(() => {
    if (!isTerminalTab || !activeDetectedUrl) return null;
    const alreadyOpen = tabs.some(
      (t) => t.kind === "preview" && sameOrigin(t.url, activeDetectedUrl),
    );
    return alreadyOpen ? null : activeDetectedUrl;
  }, [isTerminalTab, activeDetectedUrl, tabs]);

  const detectedRemoteRoot = useMemo(() => {
    if (!isTerminalTab || !activeDetectedSsh) return null;
    if (isRemotePath(activeExplorerRoot)) return null;
    return activeDetectedSsh.uri;
  }, [isTerminalTab, activeDetectedSsh, activeExplorerRoot]);

  const handleSearchReady = useCallback(
    (leafId: number, addon: SearchAddon) => {
      searchAddons.current.set(leafId, addon);
      if (leafId === activeLeafId) setActiveSearchAddon(addon);
    },
    [activeLeafId],
  );

  const disposeTab = useCallback(
    (id: number) => {
      // Terminal-leaf-keyed maps (terminalRefs/searchAddons/detectedUrls)
      // are pruned by the effect below as the pane tree changes; only the
      // tab-id-keyed handles need explicit cleanup here.
      editorRefs.current.delete(id);
      previewRefs.current.delete(id);
      closeTab(id);
    },
    [closeTab],
  );

  // Drives session disposal off the pane tree, not React lifecycles —
  // split/unsplit re-mount components but the leaf is still live.
  const liveLeavesRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const live = new Set<number>();
    for (const t of tabs) {
      if (t.kind === "terminal") {
        for (const id of leafIds(t.paneTree)) live.add(id);
      }
    }
    for (const id of liveLeavesRef.current) {
      if (!live.has(id)) disposeSession(id);
    }
    liveLeavesRef.current = live;
    for (const k of [...terminalRefs.current.keys()])
      if (!live.has(k)) terminalRefs.current.delete(k);
    for (const k of [...searchAddons.current.keys()])
      if (!live.has(k)) searchAddons.current.delete(k);
    for (const k of [...detectedUrls.current.keys()])
      if (!live.has(k)) detectedUrls.current.delete(k);
    for (const k of [...detectedSsh.current.keys()])
      if (!live.has(k)) detectedSsh.current.delete(k);
  }, [tabs]);

  const handleClose = useCallback(
    (id: number) => {
      const t = tabs.find((x) => x.id === id);
      if (t?.kind === "editor" && t.dirty) {
        const ok = window.confirm(
          `"${t.title}" has unsaved changes. Close anyway?`,
        );
        if (!ok) return;
      }
      disposeTab(id);
    },
    [tabs, disposeTab],
  );

  const cycleTab = useCallback(
    (delta: 1 | -1) => {
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeId);
      const nextIdx = (idx + delta + tabs.length) % tabs.length;
      setActiveId(tabs[nextIdx].id);
    },
    [tabs, activeId, setActiveId],
  );

  const captureActiveSelection = useCallback((): string | null => {
    const t = tabs.find((x) => x.id === activeId);
    if (!t) return null;
    if (t.kind === "terminal") {
      const lid = t.activeLeafId;
      return terminalRefs.current.get(lid)?.getSelection() ?? null;
    }
    if (t.kind === "editor") {
      return editorRefs.current.get(activeId)?.getSelection() ?? null;
    }
    return null;
  }, [tabs, activeId]);

  const togglePanelAndFocus = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    if (panelOpen) {
      useChatStore.getState().closePanel();
    } else {
      openPanel();
      focusInput(null);
    }
  }, [hasComposer, panelOpen, openPanel, focusInput]);

  const attachSelection = useChatStore((s) => s.attachSelection);

  const handleAttachFileToAgent = useCallback(
    (path: string) => {
      if (!hasComposer) {
        void openSettingsWindow("models");
        return;
      }
      // Dispatch a window event the composer listens for. Same pattern as
      // selections — keeps file-explorer decoupled from the AI module.
      window.dispatchEvent(
        new CustomEvent<string>("terax:ai-attach-file", { detail: path }),
      );
      openPanel();
      focusInput(null);
    },
    [hasComposer, openPanel, focusInput],
  );

  const askFromSelection = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    const selection = captureActiveSelection();
    if (!selection || !selection.trim()) {
      focusInput(null);
      return;
    }
    const source: "terminal" | "editor" =
      activeTab?.kind === "editor" ? "editor" : "terminal";
    attachSelection(selection, source);
  }, [
    hasComposer,
    captureActiveSelection,
    focusInput,
    attachSelection,
    activeTab,
  ]);

  const [askPopup, setAskPopup] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dropStatus, setDropStatus] = useState<string | null>(null);
  const dropStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showDropStatus = useCallback((message: string) => {
    setDropStatus(message);
    if (dropStatusTimer.current) clearTimeout(dropStatusTimer.current);
    dropStatusTimer.current = setTimeout(() => {
      dropStatusTimer.current = null;
      setDropStatus(null);
    }, 3_000);
  }, []);

  useEffect(() => {
    const isInsideAi = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      return !!(
        el.closest("[data-selection-ask-ai]") ||
        el.closest("[data-ai-input-bar]") ||
        el.closest("[data-ai-mini-window]")
      );
    };

    const onDown = (e: MouseEvent) => {
      if (isInsideAi(e.target)) return;
      setAskPopup(null);
    };
    const onUp = (e: MouseEvent) => {
      if (isInsideAi(e.target)) return;
      // Defer one tick so xterm/CodeMirror finalize the selection.
      setTimeout(() => {
        const text = captureActiveSelection();
        if (text && text.trim().length > 0) {
          setAskPopup({ x: e.clientX, y: e.clientY });
        } else {
          setAskPopup(null);
        }
      }, 0);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
    };
  }, [captureActiveSelection]);

  useEffect(
    () => () => {
      if (dropStatusTimer.current) clearTimeout(dropStatusTimer.current);
    },
    [],
  );

  const onAskFromSelection = useCallback(() => {
    askFromSelection();
    setAskPopup(null);
  }, [askFromSelection]);

  const openNewTab = useCallback(() => {
    newTab(inheritedCwdForNewTab());
  }, [newTab, inheritedCwdForNewTab]);

  const sendCd = useCallback(
    (path: string) => {
      if (activeLeafId === null) return;
      const term = terminalRefs.current.get(activeLeafId);
      if (!term) return;
      const target = remoteUriPath(path) ?? path;
      if (hasUnsafeShellControl(target)) {
        showDropStatus("Path contains unsupported control characters");
        return;
      }
      const quoted = shellQuote(target);
      term.write(`cd ${quoted}\r`);
      term.focus();
    },
    [activeLeafId, showDropStatus],
  );

  const cdInNewTab = useCallback(
    (path: string) => {
      if (hasUnsafeShellControl(path)) {
        showDropStatus("Path contains unsupported control characters");
        return;
      }
      const tabId = newTab(path);
      setTimeout(() => {
        const tab = tabsRef.current.find((x) => x.id === tabId);
        if (!tab || tab.kind !== "terminal") return;
        const t = terminalRefs.current.get(tab.activeLeafId);
        if (!t) return;
        const target = remoteUriPath(path) ?? path;
        if (!hasUnsafeShellControl(target)) t.write(`cd ${shellQuote(target)}\r`);
        t.focus();
      }, 80);
    },
    [newTab, showDropStatus],
  );

  const handleTerminalFileDrop = useCallback(
    async (leafId: number, paths: string[]) => {
      const term = terminalRefs.current.get(leafId);
      const tab = tabsRef.current.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (!term || !tab || tab.kind !== "terminal" || paths.length === 0) return;
      if (paths.some(hasUnsafeShellControl)) {
        showDropStatus("Dropped path contains unsupported control characters");
        return;
      }

      const leafCwd = findLeafCwd(tab.paneTree, leafId) ?? tab.cwd ?? null;
      let remoteDir = isRemotePath(leafCwd) ? leafCwd : null;
      if (!remoteDir && isRemotePath(activeExplorerRoot)) {
        remoteDir = activeExplorerRoot;
      }
      if (!remoteDir && leafId === activeLeafId && activeDetectedSsh) {
        remoteDir = await openRemoteRootForSsh(leafId, activeDetectedSsh);
      }

      if (!remoteDir) {
        term.write(paths.map(shellQuote).join(" "));
        term.focus();
        return;
      }

      try {
        showDropStatus("Uploading dropped files...");
        const uploaded = await invoke<RemoteUploadResult[]>(
          "fs_upload_local_files_to_remote",
          { localPaths: paths, remoteDir },
        );
        term.write(uploaded.map((file) => shellQuote(file.remote_path)).join(" "));
        term.focus();
        setDropStatus(null);
      } catch (err) {
        showDropStatus(`Drop upload failed: ${errorMessage(err)}`);
      }
    },
    [
      activeDetectedSsh,
      activeExplorerRoot,
      activeLeafId,
      openRemoteRootForSsh,
      showDropStatus,
    ],
  );

  const handleTerminalFileDropRef = useRef(handleTerminalFileDrop);
  useEffect(() => {
    handleTerminalFileDropRef.current = handleTerminalFileDrop;
  }, [handleTerminalFileDrop]);

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type !== "drop" || payload.paths.length === 0) return;
      const target = dragPositionToElement(payload.position);
      const zone = target?.closest("[data-terminal-drop-zone]") as
        | HTMLElement
        | null;
      if (!zone) return;
      const leafId = Number(zone.dataset.terminalLeafId);
      if (!Number.isFinite(leafId)) return;
      void handleTerminalFileDropRef.current(leafId, payload.paths);
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const handleOpenFile = useCallback(
    (path: string, pin?: boolean) => {
      // Explorer defaults to preview (pin=false); explicit actions like
      // context-menu "Open" pass pin=true for a persistent tab.
      openFileTab(path, pin ?? false);
    },
    [openFileTab],
  );

  const handlePathRenamed = useCallback(
    (from: string, to: string) => {
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path === from) {
          const i = to.lastIndexOf("/");
          updateTab(t.id, { path: to, title: i === -1 ? to : to.slice(i + 1) });
        } else if (t.path.startsWith(`${from}/`)) {
          const suffix = t.path.slice(from.length);
          const newPath = `${to}${suffix}`;
          const i = newPath.lastIndexOf("/");
          updateTab(t.id, {
            path: newPath,
            title: i === -1 ? newPath : newPath.slice(i + 1),
          });
        }
      }
    },
    [tabs, updateTab],
  );

  const handlePathDeleted = useCallback(
    (path: string) => {
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path === path || t.path.startsWith(`${path}/`)) {
          disposeTab(t.id);
        }
      }
    },
    [tabs, disposeTab],
  );

  const activeFilePath = activeTab?.kind === "editor" ? activeTab.path : null;

  const openPreviewTab = useCallback(
    (url: string) => {
      const id = newPreviewTab(url);
      // Focus the address bar if the URL is empty so the user can type.
      if (!url) {
        setTimeout(() => previewRefs.current.get(id)?.focusAddressBar(), 0);
      }
      return id;
    },
    [newPreviewTab],
  );

  const splitActivePaneInActiveTab = useCallback(
    (dir: "row" | "col") => {
      const t = tabsRef.current.find((x) => x.id === activeId);
      if (!t || t.kind !== "terminal") return;
      splitActivePane(activeId, dir);
    },
    [activeId, splitActivePane],
  );

  const handleCloseTabOrPane = useCallback(() => {
    const t = tabsRef.current.find((x) => x.id === activeId);
    if (t?.kind === "terminal" && leafIds(t.paneTree).length > 1) {
      closeActivePane(activeId);
      return;
    }
    handleClose(activeId);
  }, [activeId, closeActivePane, handleClose]);

  const shortcutHandlers = useMemo<ShortcutHandlers>(
    () => ({
      "tab.new": openNewTab,
      "tab.newPreview": () => openPreviewTab(""),
      "tab.newEditor": () => setNewEditorOpen(true),
      "tab.close": handleCloseTabOrPane,
      "tab.next": () => cycleTab(1),
      "tab.prev": () => cycleTab(-1),
      "tab.selectByIndex": (e) => selectByIndex(parseInt(e.key, 10) - 1),
      "pane.splitRight": () => splitActivePaneInActiveTab("row"),
      "pane.splitDown": () => splitActivePaneInActiveTab("col"),
      "pane.focusNext": () => focusNextPaneInTab(activeId, 1),
      "pane.focusPrev": () => focusNextPaneInTab(activeId, -1),
      "search.focus": () => searchInlineRef.current?.focus(),
      "ai.toggle": togglePanelAndFocus,
      "ai.askSelection": askFromSelection,
      "shortcuts.open": () => setShortcutsOpen((v) => !v),
      "settings.open": () => void openSettingsWindow(),
      "sidebar.toggle": toggleSidebar,
    }),
    [
      activeId,
      cycleTab,
      handleCloseTabOrPane,
      openNewTab,
      openPreviewTab,
      selectByIndex,
      splitActivePaneInActiveTab,
      focusNextPaneInTab,
      togglePanelAndFocus,
      askFromSelection,
      toggleSidebar,
    ],
  );

  useGlobalShortcuts(shortcutHandlers);

  const registerTerminalHandle = useCallback(
    (leafId: number, h: TerminalPaneHandle | null) => {
      if (h) terminalRefs.current.set(leafId, h);
      else terminalRefs.current.delete(leafId);
    },
    [],
  );

  const registerEditorHandle = useCallback(
    (id: number, h: EditorPaneHandle | null) => {
      if (h) editorRefs.current.set(id, h);
      else editorRefs.current.delete(id);
      if (id === activeId) setActiveEditorHandle(h);
    },
    [activeId],
  );

  const registerPreviewHandle = useCallback(
    (id: number, h: PreviewPaneHandle | null) => {
      if (h) previewRefs.current.set(id, h);
      else previewRefs.current.delete(id);
    },
    [],
  );

  const handlePreviewUrl = useCallback(
    (id: number, url: string) => updateTab(id, { url }),
    [updateTab],
  );

  const handleTerminalCwd = useCallback(
    (leafId: number, cwd: string) => setLeafCwd(leafId, cwd),
    [setLeafCwd],
  );

  const handleFocusLeaf = useCallback(
    (tabId: number, leafId: number) => focusPane(tabId, leafId),
    [focusPane],
  );

  const handleLeafExit = useCallback(
    (leafId: number, _code: number) => {
      const all = tabsRef.current;
      const tab = all.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (!tab || tab.kind !== "terminal") return;
      const isLast =
        leafIds(tab.paneTree).length === 1 &&
        all.filter((t) => t.kind === "terminal").length === 1;
      if (isLast) {
        void respawnSession(leafId, tab.cwd);
      } else {
        closePaneByLeaf(leafId);
      }
    },
    [closePaneByLeaf],
  );

  const handleTeraxOpen = useCallback(
    (leafId: number, input: TeraxOpenInput) => {
      if (input.kind === "file") {
        openFileTab(input.file);
        return;
      }
      if (input.kind === "url") {
        if (input.target === "browser") void openUrl(input.url);
        else openPreviewTab(input.url);
        return;
      }
      setLeafCwd(leafId, input.cwd);
      if (leafId === activeLeafId) setExplorerRootOverride(input.cwd);
    },
    [activeLeafId, openFileTab, openPreviewTab, setLeafCwd],
  );

  const handleEditorDirty = useCallback(
    (id: number, dirty: boolean) => updateTab(id, { dirty }),
    [updateTab],
  );

  const searchTarget = useMemo<SearchTarget>(() => {
    if (isTerminalTab && activeSearchAddon)
      return { kind: "terminal", addon: activeSearchAddon };
    if (isEditorTab && activeEditorHandle)
      return { kind: "editor", handle: activeEditorHandle };
    return null;
  }, [isTerminalTab, isEditorTab, activeSearchAddon, activeEditorHandle]);

  const activeCwd = activeTab?.kind === "terminal" ? activeLeafCwd : null;

  useEffect(() => {
    const findCwd = () => {
      const active = tabs.find((x) => x.id === activeId);
      if (active?.kind === "terminal") {
        return (
          findLeafCwd(active.paneTree, active.activeLeafId) ??
          active.cwd ??
          activeExplorerRoot ??
          home ??
          null
        );
      }
      for (let i = tabs.length - 1; i >= 0; i--) {
        const t = tabs[i];
        if (t.kind === "terminal" && t.cwd) return t.cwd;
      }
      return activeExplorerRoot ?? home ?? null;
    };

    setLive({
      getCwd: findCwd,
      getTerminalContext: () => {
        const t = tabs.find((x) => x.id === activeId);
        if (t?.kind !== "terminal") return null;
        return terminalRefs.current.get(t.activeLeafId)?.getBuffer(300) ?? null;
      },
      injectIntoActivePty: (text) => {
        const t = tabs.find((x) => x.id === activeId);
        if (t?.kind !== "terminal") return false;
        const term = terminalRefs.current.get(t.activeLeafId);
        if (!term) return false;
        term.write(text);
        term.focus();
        return true;
      },
      getWorkspaceRoot: () => activeExplorerRoot ?? home ?? null,
      getActiveFile: () => {
        const t = tabs.find((x) => x.id === activeId);
        return t?.kind === "editor" ? t.path : null;
      },
      openPreview: (url: string) => {
        openPreviewTab(url);
        return true;
      },
    });
  }, [setLive, activeId, tabs, activeExplorerRoot, home, openPreviewTab]);

  const shell = (
    <ThemeProvider>
      <TooltipProvider>
        <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
          <Header
            tabs={tabs}
            activeId={activeId}
            onSelect={setActiveId}
            onNew={openNewTab}
            onNewPreview={() => openPreviewTab("")}
            onNewEditor={() => setNewEditorOpen(true)}
            onClose={handleClose}
            onPin={pinTab}
            onToggleSidebar={toggleSidebar}
            onSplit={splitActivePaneInActiveTab}
            canSplit={
              activeTerminalTab !== null &&
              leafIds(activeTerminalTab.paneTree).length < MAX_PANES_PER_TAB
            }
            onOpenShortcuts={() => setShortcutsOpen(true)}
            onOpenSettings={() => void openSettingsWindow()}
            searchTarget={searchTarget}
            searchRef={searchInlineRef}
          />

          <main className="flex min-h-0 flex-1 flex-col">
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-h-0 flex-1"
            >
              <ResizablePanel
                id="sidebar"
                panelRef={sidebarRef}
                defaultSize="225px"
                minSize="130px"
                maxSize="450px"
                collapsible
                collapsedSize={0}
              >
                <div className="h-full border-r border-border/60 bg-card">
                  <FileExplorer
                    rootPath={activeExplorerRoot}
                    onChangeRoot={setExplorerRootOverride}
                    onOpenFile={handleOpenFile}
                    onPathRenamed={handlePathRenamed}
                    onPathDeleted={handlePathDeleted}
                    onRevealInTerminal={cdInNewTab}
                    onAttachToAgent={handleAttachFileToAgent}
                  />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="workspace" defaultSize="78%" minSize="30%">
                <div className="flex h-full min-h-0 flex-col">
                  <div className="relative min-h-0 flex-1">
                    <div
                      className={cn(
                        "absolute inset-0 px-3 pt-2 pb-2",
                        !isTerminalTab && "invisible pointer-events-none",
                      )}
                      aria-hidden={!isTerminalTab}
                    >
                      <TerminalStack
                        tabs={tabs}
                        activeId={activeId}
                        registerHandle={registerTerminalHandle}
                        onSearchReady={handleSearchReady}
                        onCwd={handleTerminalCwd}
                        onDetectedLocalUrl={handleDetectedLocalUrl}
                        onDetectedSsh={handleDetectedSsh}
                        onExit={handleLeafExit}
                        onTeraxOpen={handleTeraxOpen}
                        onFocusLeaf={handleFocusLeaf}
                      />
                    </div>
                    <div
                      className={cn(
                        "absolute inset-0 px-3 pt-2 pb-2",
                        !isEditorTab && "invisible pointer-events-none",
                      )}
                      aria-hidden={!isEditorTab}
                    >
                      <EditorStack
                        tabs={tabs}
                        activeId={activeId}
                        registerHandle={registerEditorHandle}
                        onDirtyChange={handleEditorDirty}
                        onCloseTab={disposeTab}
                      />
                    </div>
                    <div
                      className={cn(
                        "absolute inset-0 px-3 pt-2 pb-2",
                        !isPreviewTab && "invisible pointer-events-none",
                      )}
                      aria-hidden={!isPreviewTab}
                    >
                      <PreviewStack
                        tabs={tabs}
                        activeId={activeId}
                        registerHandle={registerPreviewHandle}
                        onUrlChange={handlePreviewUrl}
                      />
                    </div>
                    <div
                      className={cn(
                        "absolute inset-0 px-3 pt-2 pb-2",
                        !isAiDiffTab && "invisible pointer-events-none",
                      )}
                      aria-hidden={!isAiDiffTab}
                    >
                      <AiDiffStack
                        tabs={tabs}
                        activeId={activeId}
                        onAccept={(id) => respondToApproval(id, true)}
                        onReject={(id) => respondToApproval(id, false)}
                      />
                    </div>
                  </div>

                  {keysLoaded ? (
                    <motion.div
                      data-ai-input-bar
                      initial={false}
                      animate={{
                        height: panelOpen ? "auto" : 0,
                        opacity: panelOpen ? 1 : 0,
                      }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                      aria-hidden={!panelOpen}
                    >
                      {hasComposer ? (
                        <AiInputBar />
                      ) : (
                        <AiInputBarConnect
                          onAdd={() => void openSettingsWindow("models")}
                        />
                      )}
                    </motion.div>
                  ) : null}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </main>

          <StatusBar
            cwd={activeCwd}
            filePath={activeFilePath}
            home={home}
            onCd={sendCd}
            onOpenMini={openMini}
            hasComposer={hasComposer}
            detectedPreviewUrl={detectedPreviewUrl}
            onOpenPreview={() => {
              if (detectedPreviewUrl) openPreviewTab(detectedPreviewUrl);
            }}
            detectedRemoteRoot={detectedRemoteRoot}
            onOpenRemoteRoot={() => {
              if (activeLeafId === null || !activeDetectedSsh) return;
              void openRemoteRootForSsh(activeLeafId, activeDetectedSsh);
            }}
          />

          <AnimatePresence>
            {dropStatus ? (
              <motion.div
                key="drop-status"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="pointer-events-none fixed bottom-12 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-lg"
              >
                {dropStatus}
              </motion.div>
            ) : null}
          </AnimatePresence>

          {hasComposer ? (
            <AgentRunBridge
              openAiDiffTab={openAiDiffTab}
              setAiDiffStatus={setAiDiffStatus}
            />
          ) : null}

          <AnimatePresence>
            {miniOpen && hasComposer ? <AiMiniWindow key="ai-mini" /> : null}
            {askPopup ? (
              <SelectionAskAi
                key="ask-ai-popup"
                x={askPopup.x}
                y={askPopup.y}
                onAsk={onAskFromSelection}
                onDismiss={() => setAskPopup(null)}
              />
            ) : null}
          </AnimatePresence>

          <ShortcutsDialog
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
          />

          <NewEditorDialog
            open={newEditorOpen}
            onOpenChange={setNewEditorOpen}
            rootPath={activeExplorerRoot ?? home}
            onCreated={(path) => openFileTab(path)}
          />

          <UpdaterDialog />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );

  return <AiComposerProvider>{shell}</AiComposerProvider>;
}
