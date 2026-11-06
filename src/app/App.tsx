import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { consumeLaunchFiles, getLaunchDir } from "@/lib/launchDir";
import { IS_MAC } from "@/lib/platform";
import { quoteShellArg } from "@/lib/shellQuote";
import { usePresence } from "@/lib/usePresence";
import { useZoom } from "@/lib/useZoom";
import {
  type AgentLaunchRequest,
  AgentNotificationsBridge,
  findAgentLauncher,
  nextAttentionTarget,
  validateAgentLaunchCommand,
} from "@/modules/agents";
import {
  AgentRunBridge,
  AiMiniWindow,
  LocalAgentNotificationsBridge,
  SelectionAskAi,
  useAiBootstrap,
  useAiLiveBridge,
  useChatStore,
  useSelectionAskAi,
} from "@/modules/ai";
import { AiComposerProvider } from "@/modules/ai/lib/composer";
import {
  CommandPalette,
  createCommandItems,
  type OpenFileTarget,
  type PaletteInitialMode,
} from "@/modules/command-palette";
import { useControlBridge } from "@/modules/control";
import {
  NewEditorDialog,
  useApplyEditorFontSize,
  useEditorFileSync,
} from "@/modules/editor";
import { FileExplorer, type FileExplorerHandle } from "@/modules/explorer";
import {
  Header,
  type SearchInlineHandle,
  type SearchTarget,
} from "@/modules/header";
import { setLspNavigator } from "@/modules/lsp";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setShowHidden } from "@/modules/settings/store";
import {
  type ShortcutHandlers,
  type ShortcutId,
  shouldDisableAskSelection,
  shouldDisablePaneSwapShortcut,
  tabDigit,
  useGlobalShortcuts,
} from "@/modules/shortcuts";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SidebarRail,
  useSidebarPanel,
} from "@/modules/sidebar";
import {
  SourceControlPanel,
  useRepositoryTargeting,
  useSourceControlContext,
} from "@/modules/source-control";
import { SpaceSwitcher, useSpaces } from "@/modules/spaces";
import type { SwitcherTask } from "@/modules/spaces/SpaceSwitcher";
import { StatusBar } from "@/modules/statusbar";
import {
  type AiDiffTab,
  labelFor,
  type Tab,
  TabSwitcherHud,
  useTabSwitcher,
  useWindowTitle,
  useWorkspaceCwd,
} from "@/modules/tabs";
import {
  clearFocusedTerminal,
  isTerminalSurfaceTarget,
  navigateFocusedBlocks,
  ptyIdForLeaf,
  useAgentActivityStore,
  useTerminalFileDrop,
  whenSessionReady,
  writeToSession,
} from "@/modules/terminal";
import { bindTerminalWindowFocus } from "@/modules/terminal/ghostty/renderScheduling";
import { subscribeWindowPresentation } from "@/modules/terminal/ghostty/windowPresentation";
import {
  LivePageResizeBridge,
  ThemeProvider,
  useThemeFileEditing,
  WindowActivityBridge,
  WindowVibrancyBridge,
} from "@/modules/theme";
import { UpdaterDialog } from "@/modules/updater";
import {
  DEFAULT_PROJECT_ID,
  navigateEditor,
  planClose,
  projectTasks,
  snapshot,
  TaskStrip,
  taskCloseIds,
  useActiveTabId,
  useProjectSync,
  useViewHandle,
  useWorkbench,
  useWorkbenchBoot,
  useWorkbenchPersistence,
  viewHandle,
  type WorkbenchChrome,
  WorkbenchChromeContext,
  WorkbenchSurface,
  workbench,
} from "@/modules/workbench";
import { cards, tabIdsOf } from "@/modules/workbench/model/layout";
import {
  activeTask as activeTaskOf,
  activeTabId as currentTabId,
  focusedTabId,
  type Task,
  tabById,
  taskLabel,
} from "@/modules/workbench/model/workbench";
import {
  useWorkspaceEnvStore,
  type WorkspaceEnv,
  workspaceScopeKey,
} from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  type ComponentProps,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { CloseDialogs } from "./components/CloseDialogs";
import {
  TOGGLE_BLOCK_INPUT_EVENT,
  WorkspaceInputBar,
} from "./components/WorkspaceInputBar";
import { hasOpenPathTab, renamedPath } from "./hooks/tabCloseGuards";
import { PinnedHeight } from "./components/PinnedHeight";
import { useAppCloseGuard } from "./hooks/useAppCloseGuard";
import { useTabCloseGuards } from "./hooks/useTabCloseGuards";
import { useWorkspaceSwitcher } from "./hooks/useWorkspaceSwitcher";

// Real-application benchmark driver (scripts/app-lab). `__TERAX_BENCH__` is the literal `false`
// in a normal build, so this is `null` and neither the import nor its chunk is emitted.
const BenchBridge = __TERAX_BENCH__
  ? lazy(() => import("@/bench/BenchBridge"))
  : null;

/** Reads the live tab list on demand; App never subscribes to all of it. */
const tabsRef = {
  get current(): Tab[] {
    return snapshot().tabs;
  },
};
const getTabs = () => snapshot().tabs;

const isGitTab = (t: Tab) =>
  t.kind === "git-diff" ||
  t.kind === "git-history" ||
  t.kind === "git-commit-file";

export default function App() {
  const activeId = useActiveTabId();
  const activeTab = useWorkbench((s) =>
    activeId === null ? undefined : tabById(s, activeId),
  );
  // Narrow selectors: App re-renders for what it shows, never for a divider
  // drag (the layout changes every frame) or another tab's cwd.
  const editorPaths = useWorkbench(
    useShallow((s) =>
      s.tabs.flatMap((t) => (t.kind === "editor" ? [t.path] : [])),
    ),
  );
  const aiDiffs = useWorkbench(
    useShallow((s) =>
      s.tabs.filter((t): t is AiDiffTab => t.kind === "ai-diff"),
    ),
  );
  const hasOpenGitTab = useWorkbench((s) => s.tabs.some(isGitTab));
  const activeProjectId = useWorkbench((s) => s.activeProjectId);
  const projectRoot = useSpaces(
    (s) => s.spaces.find((p) => p.id === activeProjectId)?.root,
  );
  const fallbackTerminalCwd = useWorkbench((s) => {
    for (const t of s.tabs)
      if (t.kind === "terminal" && t.cwd && t.spaceId === s.activeProjectId)
        return t.cwd;
    return undefined;
  });
  const taskTabIds = useWorkbench(
    useShallow((s) => {
      const task = activeTaskOf(s);
      return task ? tabIdsOf(task.layout) : [];
    }),
  );
  const shownTabIds = useWorkbench(
    useShallow((s) => {
      const task = activeTaskOf(s);
      return task ? cards(task.layout).map((c) => c.activeTabId) : [];
    }),
  );
  const cardCount = shownTabIds.length;
  const booted = useWorkbench((s) => s.booted);

  // Refs for callbacks that run outside render (timers, event listeners).
  const activeIdRef = useRef(activeId ?? -1);

  const activeLeafId = activeTab?.kind === "terminal" ? activeTab.id : null;
  const activeSearchAddon = useViewHandle(activeLeafId, "search") ?? null;
  const activeEditorHandle = useViewHandle(activeId, "editor") ?? null;
  const gitHistoryHandle = useViewHandle(activeId, "gitHistory") ?? null;

  const searchInlineRef = useRef<SearchInlineHandle | null>(null);
  const { zoomIn, zoomOut, zoomReset } = useZoom();
  useApplyEditorFontSize();
  const terminalPathDropTarget = useTerminalFileDrop();
  const explorerRef = useRef<FileExplorerHandle>(null);

  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const setWorkspaceEnv = useWorkspaceEnvStore((s) => s.setEnv);
  const resetWorkspace = useCallback(
    (projectId: string, home: string, env: WorkspaceEnv) => {
      useSpaces.getState().setEnv(projectId, env);
      workbench.resetProject(projectId, home);
    },
    [],
  );
  const {
    home,
    launchCwd,
    launchCwdResolved,
    switchWorkspace,
    adoptWorkspaceEnv,
  } = useWorkspaceSwitcher({ workspaceEnv, setWorkspaceEnv, resetWorkspace });

  const activeSpaceId = useSpaces((s) => s.activeId);
  const spacesHydrated = useSpaces((s) => s.hydrated);
  const activeSpaceIdRef = useRef(activeSpaceId);
  useLayoutEffect(() => {
    activeIdRef.current = activeId ?? -1;
    activeSpaceIdRef.current = activeSpaceId;
  }, [activeId, activeSpaceId]);
  const projectId = activeSpaceId ?? DEFAULT_PROJECT_ID;

  const handleWorkspaceChange = useCallback(
    async (env: WorkspaceEnv) => {
      if (!activeSpaceId) return;
      await switchWorkspace(activeSpaceId, env);
    },
    [switchWorkspace, activeSpaceId],
  );

  useWorkbenchBoot({
    ready: launchCwdResolved,
    launchCwd: getLaunchDir() ?? launchCwd,
    home,
    adoptWorkspaceEnv,
  });
  useWorkbenchPersistence(spacesHydrated && booted);
  useProjectSync();

  // A project switch adopts that project's workspace env (local or WSL).
  const prevSpaceRef = useRef(activeSpaceId);
  useEffect(() => {
    if (!spacesHydrated || !activeSpaceId) return;
    const prev = prevSpaceRef.current;
    prevSpaceRef.current = activeSpaceId;
    if (prev === null || prev === activeSpaceId) return;
    const meta = useSpaces
      .getState()
      .spaces.find((s) => s.id === activeSpaceId);
    if (meta) void adoptWorkspaceEnv(meta.env, activeSpaceId);
  }, [activeSpaceId, spacesHydrated, adoptWorkspaceEnv]);

  const [switcherOpen, setSwitcherOpen] = useState(false);

  const {
    sidebarRef,
    sidebarWidthRef,
    sidebarView,
    sidebarCollapsed,
    initialSidebarCollapsed,
    persistSidebarView,
    persistSidebarCollapsed,
    toggleSidebar,
    cycleSidebarView,
    openSidebarView,
    persistSidebarWidth,
    toggleExplorerFocus,
  } = useSidebarPanel(explorerRef);

  const [newEditorOpen, setNewEditorOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [paletteInitialMode, setPaletteInitialMode] =
    useState<PaletteInitialMode>("commands");
  const openCommandPalette = useCallback(
    (mode: PaletteInitialMode = "commands") => {
      setPaletteInitialMode(mode);
      setCommandPaletteOpen(true);
    },
    [],
  );
  const miniOpen = useChatStore((s) => s.mini.open);
  const miniPresence = usePresence(miniOpen, 200);
  const openMini = useChatStore((s) => s.openMini);
  const toggleMini = useChatStore((s) => s.toggleMini);
  const focusInput = useChatStore((s) => s.focusInput);
  const openPanel = useChatStore((s) => s.openPanel);
  const panelOpen = useChatStore((s) => s.panelOpen);
  const setLive = useChatStore((s) => s.setLive);

  const { hasComposer, keysLoaded } = useAiBootstrap();

  const isTerminalTab = activeTab?.kind === "terminal";
  // The input bar belongs to the task's terminal: focusing an editor card
  // keeps it (and the terminal area's height) as it was.
  const activeTaskId = useWorkbench((s) => activeTaskOf(s)?.id ?? null);
  const barTerminal = useWorkbench((s) => {
    const task = activeTaskOf(s);
    if (!task) return undefined;
    const focused = tabById(s, focusedTabId(task));
    if (focused?.kind === "terminal") return focused;
    for (const c of cards(task.layout)) {
      const tab = tabById(s, c.activeTabId);
      if (tab?.kind === "terminal") return tab;
    }
    return undefined;
  });
  const isEditorTab = activeTab?.kind === "editor";
  const isGitHistoryTab = activeTab?.kind === "git-history";

  useEditorFileSync({ editorPaths, aiDiffs, tabsRef });
  useThemeFileEditing({ tabsRef, openFileTab: workbench.openFile });

  const { explorerRoot, inheritedCwdForNewTab } = useWorkspaceCwd(
    activeTab,
    fallbackTerminalCwd,
    projectRoot ?? launchCwd ?? home,
    activeProjectId,
  );

  useWindowTitle(activeTab, explorerRoot);

  const {
    pendingCloseTab,
    pendingTerminalCloseTab,
    pendingDeleteTabs,
    pendingCloseMany,
    closeManyConfirming,
    handleClose,
    handleCloseMany,
    handleDeleteProject,
    confirmClose,
    cancelClose,
    confirmTerminalClose,
    cancelTerminalClose,
    confirmDeleteClose,
    cancelDeleteClose,
    confirmCloseMany,
    cancelCloseMany,
    handlePathsDeleted,
  } = useTabCloseGuards();

  const { pendingAppClose, confirmAppClose, cancelAppClose } =
    useAppCloseGuard();

  // Seeing a terminal acknowledges its agent's attention.
  useEffect(() => {
    const ptyIds = shownTabIds.flatMap((id) => {
      const pty = ptyIdForLeaf(id);
      return pty === null ? [] : [pty];
    });
    if (ptyIds.length > 0)
      useAgentActivityStore.getState().acknowledgeAttention(ptyIds);
  }, [shownTabIds]);

  // Most-recently-used tab ids of the active task, most recent first. Drives
  // the Ctrl+Tab quick switcher so it cycles by recency, not strip order.
  const mruRef = useRef<number[]>([]);
  useEffect(() => {
    if (activeId === null) return;
    const live = new Set(snapshot().tabs.map((t) => t.id));
    mruRef.current = [
      activeId,
      ...mruRef.current.filter((id) => id !== activeId && live.has(id)),
    ];
  }, [activeId]);

  const getSwitcherOrder = useCallback(() => {
    const present = new Set(taskTabIds);
    const ordered = mruRef.current.filter((id) => present.has(id));
    for (const id of taskTabIds) if (!ordered.includes(id)) ordered.push(id);
    if (activeId === null) return ordered;
    return [activeId, ...ordered.filter((id) => id !== activeId)];
  }, [activeId, taskTabIds]);

  const { state: switcherState, step: stepSwitcher } = useTabSwitcher({
    getOrder: getSwitcherOrder,
    onCommit: (id) => workbench.activateTab(id),
  });
  const switcherTabs = switcherState
    ? taskTabIds.flatMap((id) => {
        const tab = tabById(snapshot(), id);
        return tab ? [tab] : [];
      })
    : [];

  const cycleSpace = useCallback((delta: 1 | -1) => {
    const { spaces, activeId: sid, setActive } = useSpaces.getState();
    if (spaces.length < 2) return;
    const idx = spaces.findIndex((s) => s.id === sid);
    const next = (idx + delta + spaces.length) % spaces.length;
    setActive(spaces[next].id);
  }, []);

  const captureActiveSelection = useCallback((): string | null => {
    if (!activeTab) return null;
    if (activeTab.kind === "terminal")
      return viewHandle(activeTab.id, "terminal")?.getSelection() ?? null;
    if (activeTab.kind === "editor")
      return viewHandle(activeTab.id, "editor")?.getSelection() ?? null;
    return null;
  }, [activeTab]);

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

  const { askPopup, setAskPopup, onAskFromSelection } = useSelectionAskAi({
    captureActiveSelection,
    askFromSelection,
  });
  const askPresence = usePresence(Boolean(askPopup), 120);

  const openNewTab = useCallback(() => {
    workbench.newTerminal({ cwd: inheritedCwdForNewTab() });
  }, [inheritedCwdForNewTab]);

  const openNewPrivateTab = useCallback(() => {
    workbench.newTerminal({ cwd: inheritedCwdForNewTab(), private: true });
  }, [inheritedCwdForNewTab]);

  const openNewBlockTab = useCallback(() => {
    workbench.newTerminal({ cwd: inheritedCwdForNewTab(), blocks: true });
  }, [inheritedCwdForNewTab]);

  const openNewTask = useCallback(() => {
    workbench.newTask({ cwd: inheritedCwdForNewTab() });
  }, [inheritedCwdForNewTab]);

  const launchAgentGroup = useCallback(
    (request: AgentLaunchRequest) => {
      const command = validateAgentLaunchCommand(request.command);
      if (!command.ok) return;
      const launcher = findAgentLauncher(request.agent);
      const title =
        request.instances === 1
          ? launcher.label
          : `${launcher.label} × ${request.instances}`;
      const { leafIds } = workbench.newAgentTask(
        inheritedCwdForNewTab(),
        title,
        request.instances,
      );
      const hooksReady = launcher.supportsHooks
        ? invoke("agent_enable_hooks", {
            agent: request.agent,
          }).catch((error) => {
            console.warn(
              `[terax] could not enable ${request.agent} notifications:`,
              error,
            );
          })
        : Promise.resolve();

      for (const leafId of leafIds) {
        void (async () => {
          await Promise.all([whenSessionReady(leafId), hooksReady]);
          if (!writeToSession(leafId, `${command.command}\r`)) {
            console.error(
              `[terax] agent terminal ${leafId} closed before launch`,
            );
          }
        })();
      }
    },
    [inheritedCwdForNewTab],
  );

  const sendCd = useCallback(
    (path: string) => {
      const term = viewHandle(activeLeafId, "terminal");
      if (!term) return;
      void term.writeAtPrompt(`cd ${quoteShellArg(path)}\r`).then((typed) => {
        if (typed) {
          term.focus();
          return;
        }
        toast("Terminal is busy", {
          description:
            "Open a new tab to go there, or exit the running program.",
        });
      });
    },
    [activeLeafId],
  );

  const cdInNewTab = useCallback((path: string) => {
    const id = workbench.newTerminal({ cwd: path });
    if (id === null) return;
    void whenSessionReady(id).then(() => {
      const term = viewHandle(id, "terminal");
      if (!term) return;
      term.write(`cd ${quoteShellArg(path)}\r`);
      term.focus();
    });
  }, []);

  const handleOpenFile = useCallback((path: string, pin?: boolean) => {
    // Markdown opens rendered; other files open as a preview (pin=false)
    // unless an explicit action like context-menu "Open" pins them.
    workbench.openPath(path, pin);
  }, []);

  const openLaunchFiles = useCallback((paths: string[]) => {
    for (const path of paths) workbench.openPath(path, true);
  }, []);

  // Warm start: the backend emits once the window already exists. Attach on
  // mount so an "Open With" that lands mid-restore isn't dropped — the backend
  // also seeds the drain-once state, so the boot drain below is the safety net.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      const off = await listen<string[]>("terax:open-file", (e) => {
        openLaunchFiles(e.payload);
      });
      if (disposed) off();
      else unlisten = off;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openLaunchFiles]);

  // Cold start: files arrive as CLI args (Linux/Windows) or the macOS open-files
  // event and are drained once, after the restore so they land in the restored
  // active task and dedupe against files it already had open.
  useEffect(() => {
    if (!booted) return;
    void (async () => {
      openLaunchFiles(await consumeLaunchFiles());
    })();
  }, [booted, openLaunchFiles]);

  const handleExplorerPathRenamed = useCallback((from: string, to: string) => {
    for (const tab of snapshot().tabs) {
      if (tab.kind !== "editor" && tab.kind !== "markdown") continue;
      const path = renamedPath(tab.path, from, to);
      if (path === null) continue;
      const i = path.lastIndexOf("/");
      workbench.updateTab(tab.id, {
        path,
        title: i === -1 ? path : path.slice(i + 1),
      });
    }
  }, []);

  const canReplaceExplorerPath = useCallback(
    (path: string) => !hasOpenPathTab(snapshot().tabs, path),
    [],
  );

  const activeTerminalLeafCwd =
    activeTab?.kind === "terminal" ? (activeTab.cwd ?? null) : null;

  const activeFilePath = (() => {
    if (activeTab?.kind === "editor") return activeTab.path;
    if (activeTab?.kind === "git-diff") {
      if (/^([A-Za-z]:|\/|\\)/.test(activeTab.path)) return activeTab.path;
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    if (activeTab?.kind === "git-commit-file") {
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    return null;
  })();
  const explorerActiveFilePath =
    activeTab?.kind === "editor" || activeTab?.kind === "markdown"
      ? activeTab.path
      : null;
  const isRepositoryContextCurrent = useCallback(
    (spaceId: string, workspaceKey: string) => {
      const currentSpaceId =
        useSpaces.getState().activeId ?? DEFAULT_PROJECT_ID;
      const currentWorkspaceKey = workspaceScopeKey(
        useWorkspaceEnvStore.getState().env,
      );
      return spaceId === currentSpaceId && workspaceKey === currentWorkspaceKey;
    },
    [],
  );
  const openSourceControl = useCallback(() => {
    openSidebarView("source-control");
  }, [openSidebarView]);
  const toggleHiddenFiles = useCallback(() => {
    openSidebarView("explorer");
    void setShowHidden(!usePreferencesStore.getState().showHidden);
  }, [openSidebarView]);
  const {
    repositoryTarget: sourceControlRepositoryTarget,
    openInSourceControl: handleOpenRepositoryInSourceControl,
    openGitHistory: handleOpenGitHistoryForPath,
    followActiveContext: handleFollowRepositoryContext,
  } = useRepositoryTargeting({
    spaceId: projectId,
    workspaceKey: workspaceScopeKey(workspaceEnv),
    isContextCurrent: isRepositoryContextCurrent,
    openSourceControl,
    openCommitHistoryTab: workbench.openCommitHistory,
  });
  const explorerGitDecorations = usePreferencesStore(
    (s) => s.explorerGitDecorations,
  );
  const { sourceControl, toggleSourceControl, openGitGraphFromContext } =
    useSourceControlContext({
      activeTab,
      hasOpenGitTab,
      activeTerminalLeafCwd,
      explorerRoot,
      launchCwd,
      launchCwdResolved,
      home,
      sidebarView,
      sidebarCollapsed,
      explorerGitDecorations,
      repositoryTarget: sourceControlRepositoryTarget,
      cycleSidebarView,
      openCommitHistoryTab: workbench.openCommitHistory,
    });

  const splitFocusedCard = useCallback(
    (dir: "row" | "col") => {
      workbench.splitTerminal(dir, inheritedCwdForNewTab());
    },
    [inheritedCwdForNewTab],
  );

  const closeFocusedTab = useCallback(() => {
    if (activeId !== null) void handleClose(activeId);
  }, [activeId, handleClose]);

  const closeTask = useCallback(
    (taskId: number) => {
      const ids = taskCloseIds(snapshot(), taskId);
      if (ids.length > 0) void handleCloseMany("task", ids[0], ids);
    },
    [handleCloseMany],
  );

  const closeOtherTasks = useCallback(
    (taskId: number) => {
      const s = snapshot();
      const keep = s.tasks.find((t) => t.id === taskId);
      if (!keep) return;
      const ids = projectTasks(s, keep.projectId)
        .filter((t) => t.id !== taskId)
        .flatMap((t) => taskCloseIds(s, t.id));
      if (ids.length > 0) void handleCloseMany("tasks", ids[0], ids);
    },
    [handleCloseMany],
  );

  const selectTaskByIndex = useCallback((index: number) => {
    const s = snapshot();
    const task = projectTasks(s, s.activeProjectId)[index];
    if (task) workbench.activateTask(task.id);
  }, []);

  const [zenMode, setZenMode] = useState(false);

  const activateAgentTarget = useCallback(
    (_tabId: number, leafId: number) => workbench.activateTab(leafId),
    [],
  );

  const shortcutHandlers = useMemo<ShortcutHandlers>(
    () => ({
      "commandPalette.open": () => openCommandPalette("commands"),
      "commandPalette.files": () => openCommandPalette("files"),
      "commandPalette.content": () => openCommandPalette("content"),
      "tab.new": openNewTab,
      "tab.newBlock": openNewBlockTab,
      "tab.newPrivate": openNewPrivateTab,
      "tab.newPreview": () => workbench.openPreview(""),
      "tab.newEditor": () => setNewEditorOpen(true),
      "tab.close": closeFocusedTab,
      "tab.next": () => stepSwitcher(1),
      "tab.prev": () => stepSwitcher(-1),
      "tab.selectByIndex": (e) =>
        selectTaskByIndex((tabDigit(e, e.shiftKey) ?? 1) - 1),
      "task.new": openNewTask,
      "space.next": () => cycleSpace(1),
      "space.prev": () => cycleSpace(-1),
      "space.overview": () => setSwitcherOpen(true),
      "pane.splitRight": () => splitFocusedCard("row"),
      "pane.splitDown": () => splitFocusedCard("col"),
      "pane.focusNext": () => workbench.cycleFocus(1),
      "pane.focusPrev": () => workbench.cycleFocus(-1),
      "pane.focusLeft": () => workbench.focusDirection("left"),
      "pane.focusRight": () => workbench.focusDirection("right"),
      "pane.focusUp": () => workbench.focusDirection("up"),
      "pane.focusDown": () => workbench.focusDirection("down"),
      "pane.maximize": () => workbench.toggleMaximize(),
      "pane.swapLeft": () => workbench.swapDirection("left"),
      "pane.swapRight": () => workbench.swapDirection("right"),
      "pane.swapUp": () => workbench.swapDirection("up"),
      "pane.swapDown": () => workbench.swapDirection("down"),
      "pane.source": toggleSourceControl,
      "terminal.clear": () => {
        clearFocusedTerminal();
      },
      "terminal.toggleInput": () =>
        window.dispatchEvent(new CustomEvent(TOGGLE_BLOCK_INPUT_EVENT)),
      "blocks.prev": () => navigateFocusedBlocks(-1),
      "blocks.next": () => navigateFocusedBlocks(1),
      "search.focus": () => {
        const editor = viewHandle(activeId, "editor");
        if (editor) editor.openSearch();
        else searchInlineRef.current?.focus();
      },
      "ai.toggle": togglePanelAndFocus,
      "ai.toggleMini": () => {
        if (!hasComposer) {
          void openSettingsWindow("models");
          return;
        }
        toggleMini();
      },
      "ai.askSelection": onAskFromSelection,
      "agent.focusAttention": () => {
        const t = nextAttentionTarget();
        if (t) activateAgentTarget(t.tabId, t.leafId);
      },
      "settings.open": () => void openSettingsWindow(),
      "sidebar.toggle": toggleSidebar,
      "explorer.focus": toggleExplorerFocus,
      "explorer.toggleHidden": toggleHiddenFiles,
      "view.zoomIn": zoomIn,
      "view.zoomOut": zoomOut,
      "view.zoomReset": zoomReset,
      "view.zenMode": () => setZenMode((v) => !v),
      "editor.undo": () => viewHandle(activeId, "editor")?.undo(),
      "editor.redo": () => viewHandle(activeId, "editor")?.redo(),
      "editor.save": () => {
        void viewHandle(activeId, "editor")?.save();
      },
      "editor.aiComplete": () =>
        viewHandle(activeId, "editor")?.triggerAiComplete(),
      "editor.codeComplete": () =>
        viewHandle(activeId, "editor")?.triggerCodeComplete(),
    }),
    [
      activeId,
      openCommandPalette,
      stepSwitcher,
      cycleSpace,
      closeFocusedTab,
      openNewTab,
      openNewBlockTab,
      openNewPrivateTab,
      openNewTask,
      selectTaskByIndex,
      splitFocusedCard,
      toggleSourceControl,
      hasComposer,
      togglePanelAndFocus,
      toggleMini,
      onAskFromSelection,
      toggleSidebar,
      toggleExplorerFocus,
      toggleHiddenFiles,
      zoomIn,
      zoomOut,
      zoomReset,
      activateAgentTarget,
    ],
  );

  const shortcutsDisabled = useCallback(
    (id: ShortcutId, e: KeyboardEvent) => {
      if (
        shouldDisablePaneSwapShortcut(
          id,
          !IS_MAC && isEditorTab ? null : cardCount,
        )
      )
        return true;
      if (
        (id === "pane.focusLeft" ||
          id === "pane.focusRight" ||
          id === "pane.focusUp" ||
          id === "pane.focusDown" ||
          id === "pane.maximize") &&
        cardCount < 2
      )
        return true;
      if (
        id === "editor.undo" ||
        id === "editor.redo" ||
        id === "editor.save" ||
        id === "editor.aiComplete" ||
        id === "editor.codeComplete"
      ) {
        return activeTab?.kind !== "editor";
      }
      if (id === "ai.askSelection") {
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        return shouldDisableAskSelection(
          e,
          () => isTerminalSurfaceTarget(target),
          () => !!captureActiveSelection()?.trim(),
        );
      }
      if (id === "terminal.clear") {
        // Only intercept ⌘K while a terminal is focused; elsewhere let the key
        // fall through (we never preventDefault when disabled).
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        return !isTerminalSurfaceTarget(target);
      }
      if (
        id === "terminal.toggleInput" ||
        id === "blocks.prev" ||
        id === "blocks.next"
      ) {
        return !(activeTab?.kind === "terminal" && activeTab.blocks === true);
      }
      if (id === "sidebar.toggle") {
        // Ctrl+B is also Claude Code's "run in background" key. While a terminal
        // is focused, let Ctrl+B reach the shell/Claude instead of toggling the
        // sidebar. Ctrl+Shift+B (second binding) still toggles it from anywhere.
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        return isTerminalSurfaceTarget(target) && !e.shiftKey;
      }
      return false;
    },
    [activeTab, cardCount, captureActiveSelection, isEditorTab],
  );

  useGlobalShortcuts(shortcutHandlers, { isDisabled: shortcutsDisabled });

  const onActivateLocalAgent = useCallback(() => {
    openPanel();
    focusInput(null);
  }, [openPanel, focusInput]);

  const searchTarget = useMemo<SearchTarget>(() => {
    if (isTerminalTab && activeLeafId !== null && activeSearchAddon)
      return {
        kind: "terminal",
        addon: activeSearchAddon,
        focus: () => viewHandle(activeLeafId, "terminal")?.focus(),
      };
    if (isEditorTab && activeEditorHandle)
      return {
        kind: "editor",
        handle: activeEditorHandle,
        focus: () => activeEditorHandle.focus(),
      };
    if (isGitHistoryTab && gitHistoryHandle)
      return {
        kind: "git-history",
        handle: gitHistoryHandle,
        focus: () => {},
      };
    return null;
  }, [
    isTerminalTab,
    isEditorTab,
    isGitHistoryTab,
    activeLeafId,
    activeSearchAddon,
    activeEditorHandle,
    gitHistoryHandle,
  ]);

  const activeCwd = activeTerminalLeafCwd;

  const handleNewSpace = useCallback(() => {
    const { spaces, create, setActive } = useSpaces.getState();
    const meta = create({
      name: `Project ${spaces.length + 1}`,
      root: activeCwd ?? home ?? null,
      env: workspaceEnv,
    });
    workbench.ensureProjectHasMain(meta.id, activeCwd ?? home ?? undefined);
    setActive(meta.id);
    return meta.id;
  }, [activeCwd, home, workspaceEnv]);

  const handleNewTaskInSpace = useCallback((spaceId: string) => {
    const root = useSpaces
      .getState()
      .spaces.find((s) => s.id === spaceId)?.root;
    workbench.newTask({
      projectId: spaceId,
      cwd: root ?? undefined,
      activate: false,
    });
  }, []);

  const jumpToTask = useCallback((taskId: number) => {
    workbench.activateTask(taskId);
    setSwitcherOpen(false);
  }, []);

  const spaceSwitcher = (
    <ProjectOverview
      open={switcherOpen}
      onOpenChange={setSwitcherOpen}
      onNewSpace={() => void handleNewSpace()}
      onDeleteSpace={handleDeleteProject}
      onNewTabInSpace={handleNewTaskInSpace}
      onJumpTab={jumpToTask}
      onFocusView={() => {
        const id = currentTabId(snapshot());
        if (id === null) return;
        const handle = viewHandle(id, "terminal") ?? viewHandle(id, "editor");
        if (handle) handle.focus();
        else
          document
            .querySelector<HTMLElement>(`[data-tab-slot="${id}"]`)
            ?.focus();
      }}
      onCloseTab={closeTask}
      onMoveTabToSpace={workbench.moveTaskToProject}
      onReorderTab={workbench.placeTask}
      onReorderSpaces={(ids: string[]) => useSpaces.getState().reorder(ids)}
    />
  );

  const canCloseActive =
    activeId !== null && planClose(snapshot(), [activeId]).close.length > 0;

  const commandPaletteItems = useMemo(
    () =>
      commandPaletteOpen
        ? createCommandItems({
            tabs: snapshot().tabs,
            activeId,
            canCloseActive,
            searchTarget,
            explorerRoot,
            home,
            openNewTab,
            openNewBlock: openNewBlockTab,
            openNewPrivate: openNewPrivateTab,
            openNewEditor: () => setNewEditorOpen(true),
            openNewPreview: () => workbench.openPreview(""),
            openGitGraph: openGitGraphFromContext,
            toggleSourceControl,
            closeActiveTabOrPane: closeFocusedTab,
            splitPaneRight: () => splitFocusedCard("row"),
            splitPaneDown: () => splitFocusedCard("col"),
            focusSearch: () => searchInlineRef.current?.focus(),
            focusExplorerSearch: () => explorerRef.current?.focusSearch(),
            toggleSidebar,
            toggleHiddenFiles,
            toggleAi: togglePanelAndFocus,
            askAiSelection: askFromSelection,
            openSettings: () => void openSettingsWindow(),
            openKeyboardShortcuts: () => void openSettingsWindow("shortcuts"),
            spaces: useSpaces.getState().spaces,
            activeSpaceId,
            openSpacesOverview: () => setSwitcherOpen(true),
            newSpace: () => void handleNewSpace(),
            switchSpace: (id) => useSpaces.getState().setActive(id),
            newTask: openNewTask,
            toggleMaximizeCard: () => workbench.toggleMaximize(),
          })
        : [],
    [
      commandPaletteOpen,
      activeId,
      canCloseActive,
      searchTarget,
      explorerRoot,
      home,
      openNewTab,
      openNewBlockTab,
      openNewPrivateTab,
      openNewTask,
      openGitGraphFromContext,
      toggleSourceControl,
      closeFocusedTab,
      splitFocusedCard,
      toggleSidebar,
      toggleHiddenFiles,
      togglePanelAndFocus,
      askFromSelection,
      activeSpaceId,
      handleNewSpace,
    ],
  );

  const openContentHit = useCallback((path: string, line: number) => {
    const id = workbench.openFile(path, true);
    if (id !== null) navigateEditor(id, { line, focus: true });
  }, []);

  // `target.side` (open to the side) has no host support yet: plain open.
  const openPaletteFile = useCallback(
    (path: string, target: OpenFileTarget) => {
      if (target.line !== undefined) openContentHit(path, target.line);
      else handleOpenFile(path, true);
    },
    [openContentHit, handleOpenFile],
  );

  const openControlFile = useCallback(
    ({
      path,
      line,
      focus,
      spaceId,
    }: {
      path: string;
      line?: number;
      focus: boolean;
      spaceId: string;
    }) => {
      if (focus && useSpaces.getState().activeId !== spaceId) {
        useSpaces.getState().setActive(spaceId);
      }
      const id = workbench.openFile(path, true, {
        projectId: spaceId,
        activate: focus,
      });
      if (id === null) return -1;
      if (line !== undefined) navigateEditor(id, { line, focus });
      else if (focus) navigateEditor(id, { focus: true });
      return id;
    },
    [],
  );

  useControlBridge({
    ready: spacesHydrated && launchCwdResolved,
    tabsRef,
    activeTabIdRef: activeIdRef,
    activeSpaceIdRef,
    onOpen: openControlFile,
  });

  useEffect(() => {
    setLspNavigator({ openFile: openContentHit });
    return () => setLspNavigator(null);
  }, [openContentHit]);

  const insertHistoryCommand = useMemo(
    () =>
      activeLeafId !== null
        ? (cmd: string) => {
            writeToSession(activeLeafId, cmd);
            viewHandle(activeLeafId, "terminal")?.focus();
          }
        : null,
    [activeLeafId],
  );

  useAiLiveBridge({
    setLive,
    activeId,
    getTabs,
    explorerRoot,
    launchCwd,
    home,
    openPreviewTab: workbench.openPreview,
    newAgentTab: (cwd, title) => {
      const { leafIds } = workbench.newAgentTask(cwd, title, 1);
      return { tabId: leafIds[0], leafId: leafIds[0] };
    },
  });

  const chrome = useMemo<WorkbenchChrome>(
    () => ({
      closeTab: (id) => void handleClose(id),
      closeTabs: (kind, anchorId, ids) =>
        void handleCloseMany(kind, anchorId, ids),
      newEditor: () => setNewEditorOpen(true),
      newGitGraph: openGitGraphFromContext,
      launchAgents: launchAgentGroup,
      newTerminalCwd: inheritedCwdForNewTab,
    }),
    [
      handleClose,
      handleCloseMany,
      openGitGraphFromContext,
      launchAgentGroup,
      inheritedCwdForNewTab,
    ],
  );

  const shell = (
    <ThemeProvider>
      <TooltipProvider>
        {BenchBridge && (
          <Suspense fallback={null}>
            <BenchBridge />
          </Suspense>
        )}
        <div className="relative flex h-screen flex-col overflow-hidden bg-frame text-foreground">
          {!zenMode && (
            <Header
              taskStrip={
                <TaskStrip
                  onNewTask={openNewTask}
                  onCloseTask={closeTask}
                  onCloseOtherTasks={closeOtherTasks}
                />
              }
              onToggleSidebar={toggleSidebar}
              onOpenCommandPalette={() => openCommandPalette("commands")}
              onActivateAgent={activateAgentTarget}
              onActivateLocalAgent={onActivateLocalAgent}
              onOpenSettings={() => void openSettingsWindow()}
              spaceSwitcher={spaceSwitcher}
              searchTarget={searchTarget}
              searchRef={searchInlineRef}
            />
          )}

          <main className="zoom-content flex min-h-0 flex-1 flex-col">
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-h-0 flex-1"
              onLayoutChanged={(_, { isUserInteraction }) => {
                const width = sidebarRef.current?.getSize().inPixels ?? 0;
                persistSidebarWidth(width, isUserInteraction);
              }}
            >
              <ResizablePanel
                id="sidebar"
                panelRef={sidebarRef}
                defaultSize={
                  initialSidebarCollapsed
                    ? "0px"
                    : `${sidebarWidthRef.current}px`
                }
                minSize={`${SIDEBAR_MIN_WIDTH}px`}
                maxSize={`${SIDEBAR_MAX_WIDTH}px`}
                collapsible
                collapsedSize={0}
                onResize={(size) => {
                  persistSidebarCollapsed(size.inPixels <= 0);
                }}
              >
                <div className="h-full min-h-0 pl-2 pr-0.5">
                  <div className="terax-pane flex h-full min-h-0 flex-col">
                    <div
                      key={sidebarView}
                      className="min-h-0 flex-1 terax-panel-in"
                    >
                      {sidebarView === "explorer" ? (
                        <FileExplorer
                          ref={explorerRef}
                          rootPath={explorerRoot}
                          gitStatus={
                            explorerGitDecorations ? sourceControl.status : null
                          }
                          activeFilePath={explorerActiveFilePath}
                          onOpenFile={handleOpenFile}
                          onPathRenamed={handleExplorerPathRenamed}
                          onPathsDeleted={handlePathsDeleted}
                          canReplacePath={canReplaceExplorerPath}
                          onRevealInTerminal={cdInNewTab}
                          onOpenInSourceControl={
                            handleOpenRepositoryInSourceControl
                          }
                          onOpenGitHistory={handleOpenGitHistoryForPath}
                          onAttachToAgent={handleAttachFileToAgent}
                          pathDropTarget={terminalPathDropTarget}
                          visible={!sidebarCollapsed}
                        />
                      ) : (
                        <SourceControlPanel
                          open
                          sourceControl={sourceControl}
                          onOpenDiff={workbench.openGitDiff}
                          onOpenGitGraph={openGitGraphFromContext}
                          onOpenFile={handleOpenFile}
                          onNavigateToPath={cdInNewTab}
                          repositoryTarget={sourceControlRepositoryTarget}
                          onFollowRepositoryContext={
                            handleFollowRepositoryContext
                          }
                        />
                      )}
                    </div>
                    <SidebarRail
                      activeView={sidebarView}
                      onSelectView={persistSidebarView}
                      changedCount={sourceControl.changedCount}
                    />
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle className="w-1 rounded-full bg-transparent transition-colors duration-[var(--dur-fast)] after:w-4 hover:bg-border" />
              <ResizablePanel id="workspace" defaultSize="78%" minSize="30%">
                <div className="flex h-full min-h-0 flex-col pr-1.5 pl-0">
                  <div className="relative min-h-0 flex-1">
                    <WorkbenchChromeContext.Provider value={chrome}>
                      <WorkbenchSurface />
                    </WorkbenchChromeContext.Provider>
                  </div>
                  <PinnedHeight
                    resetKey={`${activeTaskId}:${panelOpen}:${keysLoaded}:${hasComposer}`}
                    className="shrink-0"
                  >
                    <div className="terax-pane mx-[3px] mb-[3px] empty:hidden [&>:first-child]:border-t-0">
                      <WorkspaceInputBar
                        isBlockTab={barTerminal?.blocks === true}
                        isTerminalTab={barTerminal !== undefined}
                        activeLeafId={barTerminal?.id ?? null}
                        cwd={barTerminal?.cwd ?? null}
                        home={home}
                        hasComposer={hasComposer}
                        panelOpen={panelOpen}
                        keysLoaded={keysLoaded}
                        onConnect={() => void openSettingsWindow("models")}
                      />
                    </div>
                  </PinnedHeight>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </main>

          {!zenMode && (
            <StatusBar
              cwd={activeCwd}
              filePath={activeFilePath}
              home={home}
              onCd={sendCd}
              onWorkspaceChange={handleWorkspaceChange}
              onOpenMini={openMini}
              onOpenAi={togglePanelAndFocus}
              hasComposer={hasComposer}
              privateActive={
                activeTab?.kind === "terminal" && activeTab.private === true
              }
            />
          )}

          <WindowVibrancyBridge />
          {IS_MAC ? <LivePageResizeBridge /> : null}
          <WindowActivityBridge
            bindFocus={bindTerminalWindowFocus}
            subscribePresentation={subscribeWindowPresentation}
          />

          <AgentNotificationsBridge
            getTabs={getTabs}
            activeId={activeId ?? -1}
            onActivate={activateAgentTarget}
          />
          <Toaster position="bottom-right" />

          {hasComposer ? (
            <>
              <AgentRunBridge
                openAiDiffTab={workbench.openAiDiff}
                closeAiDiffTab={workbench.closeAiDiff}
              />
              <LocalAgentNotificationsBridge />
            </>
          ) : null}

          {hasComposer && miniPresence.mounted ? (
            <AiMiniWindow state={miniPresence.state} />
          ) : null}
          {askPresence.mounted ? (
            <SelectionAskAi
              state={askPresence.state}
              x={askPopup?.x ?? 0}
              y={askPopup?.y ?? 0}
              onAsk={onAskFromSelection}
              onDismiss={() => setAskPopup(null)}
            />
          ) : null}

          {switcherState && (
            <TabSwitcherHud tabs={switcherTabs} state={switcherState} />
          )}

          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
            initialMode={paletteInitialMode}
            commandItems={commandPaletteItems}
            workspaceRoot={explorerRoot}
            onOpenContentHit={openContentHit}
            onOpenFile={openPaletteFile}
            insertCommand={insertHistoryCommand}
          />

          <NewEditorDialog
            open={newEditorOpen}
            onOpenChange={setNewEditorOpen}
            rootPath={explorerRoot ?? home}
            onCreated={(path) => workbench.openFile(path)}
          />

          <UpdaterDialog />

          <CloseDialogs
            tabs={snapshot().tabs}
            pendingCloseTab={pendingCloseTab}
            onCancelClose={cancelClose}
            onConfirmClose={confirmClose}
            pendingTerminalCloseTab={pendingTerminalCloseTab}
            onCancelTerminalClose={cancelTerminalClose}
            onConfirmTerminalClose={confirmTerminalClose}
            pendingDeleteTabs={pendingDeleteTabs}
            onCancelDeleteClose={cancelDeleteClose}
            onConfirmDeleteClose={confirmDeleteClose}
            pendingCloseMany={pendingCloseMany}
            closeManyConfirming={closeManyConfirming}
            onCancelCloseMany={cancelCloseMany}
            onConfirmCloseMany={confirmCloseMany}
            pendingAppClose={pendingAppClose}
            onCancelAppClose={cancelAppClose}
            onConfirmAppClose={confirmAppClose}
          />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );

  return <AiComposerProvider>{shell}</AiComposerProvider>;
}

const NO_TASKS: Task[] = [];
const NO_TABS: Tab[] = [];

/** The project overview; it follows the workbench only while open. */
function ProjectOverview(
  props: Omit<ComponentProps<typeof SpaceSwitcher>, "tabs">,
) {
  const tasks = useWorkbench((s) => (props.open ? s.tasks : NO_TASKS));
  const tabs = useWorkbench((s) => (props.open ? s.tabs : NO_TABS));
  const entries = useMemo<SwitcherTask[]>(
    () =>
      tasks.flatMap((task) => {
        const tab = tabs.find((t) => t.id === focusedTabId(task));
        return tab
          ? [
              {
                id: task.id,
                spaceId: task.projectId,
                label: taskLabel(task, tabs, labelFor),
                tab,
                main: task.kind === "main",
              },
            ]
          : [];
      }),
    [tasks, tabs],
  );
  return <SpaceSwitcher {...props} tabs={entries} />;
}
