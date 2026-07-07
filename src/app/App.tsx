import type { SearchAddon } from "@xterm/addon-search";
import { AnimatePresence, MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getLaunchDir } from "@/lib/launchDir";
import { quoteShellArg } from "@/lib/shellQuote";
import { useZoom } from "@/lib/useZoom";
import type { AgentStatusContext } from "@/modules/agents/lib/statusSurface";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { AiComposerProvider } from "@/modules/ai/lib/composer";
import { isPiComposerRuntimeEnabled } from "@/modules/ai/lib/composerRuntime";
import type { EditorPaneHandle } from "@/modules/editor";
import type { FileExplorerHandle } from "@/modules/explorer";
import type { GitHistorySearchHandle } from "@/modules/git-history";
import { Header, type SearchInlineHandle } from "@/modules/header";
import { PiControllerProvider } from "@/modules/pi/lib/PiControllerProvider";
import { usePiProviderConfig } from "@/modules/pi/lib/usePiProviderConfig";
import type { PreviewPaneHandle } from "@/modules/preview";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { StatusBar } from "@/modules/statusbar";
import {
  MAX_PANES_PER_TAB,
  useTabs,
  useWindowTitle,
  useWorkspaceCwd,
} from "@/modules/tabs";
import {
  findLeafCwd,
  hasLeaf,
  leafIds,
  respawnSession,
  type TerminalPaneHandle,
  useTerminalFileDrop,
} from "@/modules/terminal";
import { ThemeProvider } from "@/modules/theme";
import { AppBridges } from "./AppBridges";
import { AppComposerDock } from "./AppComposerDock";
import { AppOverlays } from "./AppOverlays";
import { AppSidebars } from "./AppSidebars";
import {
  AppFloatingSurfaces,
  AppWorkspaceSurface,
  type SurfaceTabKind,
} from "./AppWorkspaceSurface";
import {
  piSessionActivationPlan,
  resolveCodeSurfaceAfterWorkspaceClose,
} from "./codeSurface";
import { useAppActiveContext } from "./useAppActiveContext";
import { useAppAiBootstrap } from "./useAppAiBootstrap";
import { useAppAiSelection } from "./useAppAiSelection";
import { useAppCommandPalette } from "./useAppCommandPalette";
import { useAppEditorFileSync } from "./useAppEditorFileSync";
import { useAppFileTabs } from "./useAppFileTabs";
import { useAppInbox } from "./useAppInbox";
import { useAppManagedAgents } from "./useAppManagedAgents";
import { useAppShortcuts } from "./useAppShortcuts";
import { useAppSourceControl } from "./useAppSourceControl";
import { useAppSurfaceHandles } from "./useAppSurfaceHandles";
import { useAppTabLifecycle } from "./useAppTabLifecycle";
import { useAppThemeEditing } from "./useAppThemeEditing";
import { useAppWorkspaceBootstrap } from "./useAppWorkspaceBootstrap";
import { useCodeSurfaceManager } from "./useCodeSurfaceManager";
import { useSidebarManager } from "./useSidebarManager";
import { useWorkflowTabPersistence } from "./useWorkflowTabPersistence";

function pathBasename(path: string | null | undefined): string | null {
  const cleaned = path?.replace(/[\\/]+$/, "");
  if (!cleaned) return null;
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? cleaned;
}

export default function App() {
  const {
    tabs,
    activeId,
    setActiveId,
    newTab,
    newAgentTab,
    newPrivateTab,
    newWorkflowTab,
    openWorkflowDocumentTab,
    updateWorkflowDocument,
    openFileTab,
    pinTab,
    newPreviewTab,
    newMarkdownTab,
    openPiWorkspaceTab,
    openArtifactHubTab,
    openArtifactWorkspaceTab,
    openAiDiffTab,
    closeAiDiffTab,
    openGitDiffTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    closeTab,
    updateTab,
    selectByIndex,
    setLeafCwd,
    focusPane,
    focusNextPaneInTab,
    splitActivePane,
    closeActivePane,
    closePaneByLeaf,
    resetWorkspace,
  } = useTabs(getLaunchDir() ? { cwd: getLaunchDir() } : undefined);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const { recentWorkflowFiles, rememberWorkflowFile } =
    useWorkflowTabPersistence({
      activeId,
      openWorkflowDocumentTab,
      setActiveId,
      tabs,
      updateWorkflowDocument,
    });

  const activeTerminalTab = useMemo(() => {
    const t = tabs.find((x) => x.id === activeId);
    return t && t.kind === "terminal" ? t : null;
  }, [tabs, activeId]);
  const activeLeafId = activeTerminalTab?.activeLeafId ?? null;

  const searchAddons = useRef<Map<number, SearchAddon>>(new Map());
  const searchInlineRef = useRef<SearchInlineHandle | null>(null);
  const terminalRefs = useRef<Map<number, TerminalPaneHandle>>(new Map());
  const editorRefs = useRef<Map<number, EditorPaneHandle>>(new Map());
  const previewRefs = useRef<Map<number, PreviewPaneHandle>>(new Map());
  const [gitHistoryHandle, setGitHistoryHandle] =
    useState<GitHistorySearchHandle | null>(null);
  const {
    activeEditorHandle,
    activeSearchAddon,
    cancelClose,
    setActiveEditorHandle,
    confirmClose,
    disposeTab,
    handleClose,
    handleSearchReady,
    pendingCloseTab,
    pendingTerminalCloseTab,
    setPendingTerminalCloseTab,
  } = useAppTabLifecycle({
    activeId,
    activeLeafId,
    closeTab,
    editorRefs,
    previewRefs,
    searchAddons,
    tabs,
    terminalRefs,
  });
  const { zoomIn, zoomOut, zoomReset } = useZoom();
  useTerminalFileDrop();
  const explorerRef = useRef<FileExplorerHandle>(null);
  const explorerReturnFocusRef = useRef<HTMLElement | null>(null);

  const {
    closeSecondarySidebarPanel,
    cycleSidebarView,
    handleSidebarResize,
    openSecondarySidebarView,
    openSidebarPanel,
    persistSecondarySidebarView,
    persistSidebarView,
    secondarySidebarRef,
    secondarySidebarView,
    secondarySidebarVisible,
    secondarySidebarWidthRef,
    sidebarRef,
    sidebarView,
    sidebarVisible,
    sidebarWidthRef,
    toggleSecondarySidebar,
    toggleSidebar,
  } = useSidebarManager();
  const {
    capturedCodeContext,
    chatFocusRequest,
    chatSelectedSessionId,
    chatSidebarVisible,
    codeContextRef,
    codePanelVisible,
    codeSelectedSessionId,
    codeSurface,
    openCodeInSidebar,
    openCodePopOut,
    openCodeWorkspace,
    piFocusRequest,
    piSidebarVisible,
    selectSecondarySidebarView,
    setChatFocusRequest,
    setChatSelectedSessionId,
    setCodeSelectedSessionId,
    setCodeSurface,
    setPiFocusRequest,
  } = useCodeSurfaceManager({
    activeTabKind: tabs.find((tab) => tab.id === activeId)?.kind,
    closeSecondarySidebarPanel,
    openPiWorkspaceTab,
    openSecondarySidebarView,
    persistSecondarySidebarView,
    secondarySidebarView,
    secondarySidebarVisible,
  });
  const agentTerminalContext = useMemo<
    Record<number, AgentStatusContext>
  >(() => {
    const next: Record<number, AgentStatusContext> = {};
    for (const tab of tabs) {
      if (tab.kind !== "terminal") continue;
      for (const leafId of leafIds(tab.paneTree)) {
        const cwd = findLeafCwd(tab.paneTree, leafId) ?? tab.cwd ?? null;
        next[leafId] = {
          branch: null,
          cwd,
          project: pathBasename(cwd),
          title: tab.title,
          worktree: null,
        };
      }
    }
    return next;
  }, [tabs]);
  const toggleExplorerFocus = useCallback(() => {
    const explorer = explorerRef.current;
    const collapsed = sidebarRef.current?.isCollapsed() ?? false;
    const explorerVisible = sidebarView === "explorer";
    if (!explorerVisible || collapsed) {
      openSidebarPanel("primary");
      if (!explorerVisible) persistSidebarView("explorer");
      const active = document.activeElement;
      explorerReturnFocusRef.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      requestAnimationFrame(() => explorerRef.current?.focus());
      return;
    }
    if (!explorer) return;
    if (explorer.isFocused()) {
      const target = explorerReturnFocusRef.current;
      explorerReturnFocusRef.current = null;
      if (target && document.body.contains(target)) {
        target.focus();
      } else {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      return;
    }
    const active = document.activeElement;
    explorerReturnFocusRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    explorer.focus();
  }, [openSidebarPanel, persistSidebarView, sidebarView]);

  const { home, launchCwd, launchCwdResolved, switchWorkspace } =
    useAppWorkspaceBootstrap({ resetWorkspace });

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newEditorOpen, setNewEditorOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const {
    focusInput,
    hasComposer,
    keysLoaded,
    miniOpen,
    openMini,
    openPanel,
    panelOpen,
    respondToApproval,
    setLive,
    sidebarPosition,
  } = useAppAiBootstrap();

  const activeTab = tabs.find((t) => t.id === activeId);
  const isTerminalTab = activeTab?.kind === "terminal";
  const isEditorTab = activeTab?.kind === "editor";
  const isPreviewTab = activeTab?.kind === "preview";
  const isMarkdownTab = activeTab?.kind === "markdown";
  const isAiDiffTab = activeTab?.kind === "ai-diff";
  const isGitDiffTab =
    activeTab?.kind === "git-diff" || activeTab?.kind === "git-commit-file";
  const isGitHistoryTab = activeTab?.kind === "git-history";
  const isPiWorkspaceTab = activeTab?.kind === "pi-workspace";
  const isArtifactTab =
    activeTab?.kind === "artifact" || activeTab?.kind === "artifact-hub";
  const isWorkflowTab = activeTab?.kind === "workflow";

  useEffect(() => {
    const hasPiWorkspaceTab = tabs.some((tab) => tab.kind === "pi-workspace");
    setCodeSurface((current) =>
      resolveCodeSurfaceAfterWorkspaceClose(current, hasPiWorkspaceTab),
    );
  }, [tabs]);

  useEffect(() => {
    void import("@/modules/ai/agents/registry").then((m) =>
      m.loadDynamicAgents(),
    );
  }, []);

  useAppEditorFileSync({ editorRefs, tabs, tabsRef });
  useAppThemeEditing({ openFileTab, tabsRef });

  const { explorerRoot, inheritedCwdForNewTab } = useWorkspaceCwd(
    activeTab,
    tabs,
    launchCwd ?? home,
  );

  useWindowTitle(activeTab, explorerRoot);

  const { result: piComposerProvider } = usePiProviderConfig();
  const piComposerEnabled = isPiComposerRuntimeEnabled();
  const hasDockComposer =
    hasComposer || (piComposerEnabled && piComposerProvider.ok);

  const {
    askFromSelection,
    askPopup,
    captureActiveSelection,
    dismissAskPopup,
    handleAttachFileToAgent,
    onAskFromSelection,
    togglePanelAndFocus,
  } = useAppAiSelection({
    activeId,
    activeTab,
    editorRefs,
    focusInput,
    hasComposer: hasDockComposer,
    openPanel,
    panelOpen,
    tabs,
    terminalRefs,
  });

  const openNewTab = useCallback(() => {
    newTab(inheritedCwdForNewTab());
  }, [newTab, inheritedCwdForNewTab]);

  const openNewPrivateTab = useCallback(() => {
    newPrivateTab(inheritedCwdForNewTab());
  }, [newPrivateTab, inheritedCwdForNewTab]);

  const openNewWorkflowTab = useCallback(() => {
    newWorkflowTab();
  }, [newWorkflowTab]);

  const sendCd = useCallback(
    (path: string) => {
      if (activeLeafId === null) return;
      const term = terminalRefs.current.get(activeLeafId);
      if (!term) return;
      term.write(`cd ${quoteShellArg(path)}
`);
      term.focus();
    },
    [activeLeafId],
  );

  const cdInNewTab = useCallback(
    (path: string) => {
      const tabId = newTab(path);
      setTimeout(() => {
        const tab = tabsRef.current.find((x) => x.id === tabId);
        if (tab?.kind !== "terminal") return;
        const term = terminalRefs.current.get(tab.activeLeafId);
        if (!term) return;
        term.write(`cd ${quoteShellArg(path)}
`);
        term.focus();
      }, 80);
    },
    [newTab],
  );

  const {
    cancelDeleteClose,
    confirmDeleteClose,
    handleOpenFile,
    handlePathDeleted,
    handlePathRenamed,
    handleSaveWorkflowDocument,
    handleSaveWorkflowDocumentAs,
    pendingDeleteTabs,
  } = useAppFileTabs({
    disposeTab,
    openFileTab,
    openWorkflowDocumentTab,
    rememberWorkflowFile,
    tabs,
    tabsRef,
    updateTab,
    updateWorkflowDocument,
  });

  const {
    activeCodeContext,
    activeFilePath,
    activeTerminalLeafCwd,
    codePanelContext,
    explorerActiveFilePath,
    workspaceFallbackPath,
  } = useAppActiveContext({
    activeTab,
    capturedCodeContext,
    codeSurface,
    explorerRoot,
    home,
    launchCwd,
    launchCwdResolved,
  });
  codeContextRef.current = activeCodeContext;

  const {
    launchPiLocalAgent,
    openGitGraphFromContext,
    sourceControl,
    toggleSourceControl,
  } = useAppSourceControl({
    activeTab,
    activeTerminalLeafCwd,
    cycleSidebarView,
    disposeTab,
    explorerRoot,
    newAgentTab,
    openCommitHistoryTab,
    sidebarView,
    tabs,
    workspaceFallbackPath,
  });

  const openPreviewTab = useCallback(
    (url: string) => {
      const id = newPreviewTab(url);
      if (!url) {
        setTimeout(() => previewRefs.current.get(id)?.focusAddressBar(), 0);
      }
      return id;
    },
    [newPreviewTab],
  );

  const openMarkdownPreview = useCallback(
    (path: string) => {
      newMarkdownTab(path);
    },
    [newMarkdownTab],
  );

  const {
    cycleTab,
    handleCloseTabOrPane,
    splitActivePaneInActiveTab,
    zenMode,
  } = useAppShortcuts({
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
  });

  const {
    handleFocusLeaf,
    handlePreviewUrl,
    handleTerminalCwd,
    onActivateAgent,
    onActivateLocalAgent,
    registerEditorHandle,
    registerPreviewHandle,
    registerTerminalHandle,
  } = useAppSurfaceHandles({
    activeId,
    editorRefs,
    focusInput,
    focusPane,
    openPanel,
    previewRefs,
    setActiveEditorHandle,
    setActiveId,
    setLeafCwd,
    terminalRefs,
    updateTab,
  });

  const markPiNotificationsRead = useAgentStore(
    (state) => state.markPiNotificationsRead,
  );

  const onActivatePiSession = useCallback(
    (sessionId: string) => {
      const plan = piSessionActivationPlan(codeSurface);
      if (plan.openWorkspace) openPiWorkspaceTab();
      if (plan.openSidebar) openSecondarySidebarView("code");
      setPiFocusRequest({ sessionId, token: Date.now() });
      markPiNotificationsRead("code-run");
    },
    [
      codeSurface,
      markPiNotificationsRead,
      openPiWorkspaceTab,
      openSecondarySidebarView,
    ],
  );

  const {
    clearReadInboxRows,
    inboxRows,
    inboxUnreadCounts,
    markInboxRowsRead,
    openArtifactWorkspace,
    openInboxRow,
  } = useAppInbox({
    chatSelectedSessionId,
    chatSidebarVisible,
    codePanelVisible,
    codeSelectedSessionId,
    onActivatePiSession: (sessionId) => onActivatePiSession(sessionId),
    openArtifactWorkspaceTab,
    openSecondarySidebarView,
    piSidebarVisible,
    setChatFocusRequest,
  });

  const openNewArtifactsTab = useCallback(() => {
    openArtifactHubTab();
  }, [openArtifactHubTab]);

  const handleLeafExit = useCallback(
    (leafId: number, _code: number) => {
      const all = tabsRef.current;
      const tab = all.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (tab?.kind !== "terminal") return;
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

  const handleEditorDirty = useCallback(
    (id: number, dirty: boolean) => updateTab(id, { dirty }),
    [updateTab],
  );

  const handleRenameTab = useCallback(
    (id: number, title: string) => updateTab(id, { customTitle: title.trim() }),
    [updateTab],
  );

  const { commandPaletteActions, searchTarget } = useAppCommandPalette({
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
  });

  const activeCwd = activeTerminalLeafCwd;
  useAppManagedAgents({
    activeId,
    explorerRoot,
    home,
    launchCwd,
    newAgentTab,
    openPreviewTab,
    setLive,
    tabs,
    terminalRefs,
  });

  const activeSurfaces = useMemo<ReadonlySet<SurfaceTabKind>>(() => {
    const kinds: SurfaceTabKind[] = [];
    if (isTerminalTab) kinds.push("terminal");
    if (isEditorTab) kinds.push("editor");
    if (isPreviewTab) kinds.push("preview");
    if (isMarkdownTab) kinds.push("markdown");
    if (isAiDiffTab) kinds.push("ai-diff");
    if (isGitDiffTab) kinds.push("git-diff");
    if (isGitHistoryTab) kinds.push("git-history");
    if (isWorkflowTab) kinds.push("workflow");
    if (isArtifactTab) kinds.push("artifact");
    if (isPiWorkspaceTab) kinds.push("pi-workspace");
    return new Set(kinds);
  }, [
    isTerminalTab,
    isEditorTab,
    isPreviewTab,
    isMarkdownTab,
    isAiDiffTab,
    isGitDiffTab,
    isGitHistoryTab,
    isWorkflowTab,
    isArtifactTab,
    isPiWorkspaceTab,
  ]);

  const workspaceSurface = (
    <AppWorkspaceSurface
      activeId={activeId}
      activeTab={activeTab}
      codePanelContext={codePanelContext}
      codeSurface={codeSurface}
      activeSurfaces={activeSurfaces}
      tabs={tabs}
      terminal={{
        registerHandle: registerTerminalHandle,
        onSearchReady: handleSearchReady,
        onCwd: handleTerminalCwd,
        onExit: handleLeafExit,
        onFocusLeaf: handleFocusLeaf,
      }}
      editor={{
        registerHandle: registerEditorHandle,
        onDirtyChange: handleEditorDirty,
        onCloseTab: disposeTab,
      }}
      preview={{
        registerHandle: registerPreviewHandle,
        onUrlChange: handlePreviewUrl,
      }}
      aiDiff={{
        onAccept: (id) => respondToApproval(id, true),
        onReject: (id) => respondToApproval(id, false),
      }}
      gitHistory={{
        onOpenCommitFile: openCommitFileDiffTab,
        onSearchHandle: setGitHistoryHandle,
      }}
      workflow={{
        onDocumentChange: updateWorkflowDocument,
        onSaveDocument: handleSaveWorkflowDocument,
        onSaveAsDocument: handleSaveWorkflowDocumentAs,
        recentWorkflowFiles,
        onOpenWorkflowPath: (path) => handleOpenFile(path, true),
      }}
      artifact={{
        onOpenArtifact: openArtifactWorkspace,
        onSelectedSlugChange: (tabId, slug) =>
          updateTab(tabId, { selectedSlug: slug }),
      }}
      pi={{
        focusRequest: piFocusRequest,
        onOpenLocalAgent: launchPiLocalAgent,
        onPopOut: openCodePopOut,
        onSelectedSessionChange: setCodeSelectedSessionId,
      }}
    />
  );

  const shell = (
    <ThemeProvider>
      <PiControllerProvider>
        <TooltipProvider>
          <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
            <a
              href="#main-content"
              className="sr-only z-[100] rounded-md bg-background px-3 py-2 text-sm text-foreground shadow focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:ring-2 focus:ring-ring"
            >
              Skip to main content
            </a>
            {!zenMode && (
              <Header
                tabs={tabs}
                activeId={activeId}
                onSelect={setActiveId}
                onNew={openNewTab}
                onNewPrivate={openNewPrivateTab}
                onNewPreview={() => openPreviewTab("")}
                onNewEditor={() => setNewEditorOpen(true)}
                onNewArtifacts={openNewArtifactsTab}
                onNewWorkflow={openNewWorkflowTab}
                onNewGitGraph={openGitGraphFromContext}
                onClose={handleClose}
                onPin={pinTab}
                onRename={handleRenameTab}
                onToggleSidebar={toggleSidebar}
                onToggleSecondarySidebar={toggleSecondarySidebar}
                onSplit={splitActivePaneInActiveTab}
                canSplit={
                  activeTerminalTab !== null &&
                  leafIds(activeTerminalTab.paneTree).length < MAX_PANES_PER_TAB
                }
                agentTerminalContext={agentTerminalContext}
                onActivateAgent={onActivateAgent}
                onActivateLocalAgent={onActivateLocalAgent}
                onActivatePiSession={onActivatePiSession}
                onOpenSettings={() => void openSettingsWindow()}
                searchTarget={searchTarget}
                searchRef={searchInlineRef}
              />
            )}

            <main
              id="main-content"
              tabIndex={-1}
              className="zoom-content flex min-h-0 flex-1 flex-col focus:outline-none"
            >
              <AppSidebars
                primary={{
                  activeFilePath: explorerActiveFilePath,
                  activeView: sidebarView,
                  defaultSize: sidebarWidthRef.current,
                  explorerRef,
                  rootPath: explorerRoot,
                  sourceControl,
                  visible: sidebarVisible,
                  widthRef: sidebarRef,
                  onAttachFileToAgent: handleAttachFileToAgent,
                  onOpenFile: handleOpenFile,
                  onOpenGitDiff: openGitDiffTab,
                  onOpenGitGraph: openGitGraphFromContext,
                  onOpenMarkdownPreview: openMarkdownPreview,
                  onPathDeleted: handlePathDeleted,
                  onPathRenamed: handlePathRenamed,
                  onResize: (sizeInPixels) =>
                    handleSidebarResize("primary", sizeInPixels),
                  onRevealInTerminal: cdInNewTab,
                  onSelectView: persistSidebarView,
                }}
                secondary={{
                  activeView: secondarySidebarView,
                  chatContext: activeCodeContext,
                  chatFocusRequest,
                  codeContext: codePanelContext,
                  codeSurface,
                  defaultSize: secondarySidebarWidthRef.current,
                  inboxRows,
                  piFocusRequest,
                  unreadCounts: inboxUnreadCounts,
                  visible: secondarySidebarVisible,
                  widthRef: secondarySidebarRef,
                  onChatSelectedSessionChange: setChatSelectedSessionId,
                  onClearReadInboxRows: clearReadInboxRows,
                  onCodeSelectedSessionChange: setCodeSelectedSessionId,
                  onMarkInboxRowsRead: markInboxRowsRead,
                  onOpenArtifactWorkspace: openArtifactWorkspace,
                  onOpenCodePopOut: openCodePopOut,
                  onOpenCodeWorkspace: openCodeWorkspace,
                  onOpenInboxRow: openInboxRow,
                  onOpenLocalAgent: launchPiLocalAgent,
                  onResize: (sizeInPixels) =>
                    handleSidebarResize("secondary", sizeInPixels),
                  onSelectView: selectSecondarySidebarView,
                }}
                sidebarPosition={sidebarPosition}
                workspace={
                  <AppComposerDock
                    keysLoaded={keysLoaded}
                    panelOpen={panelOpen}
                    hasComposer={hasDockComposer}
                  >
                    {workspaceSurface}
                  </AppComposerDock>
                }
              />
            </main>

            {!zenMode && (
              <StatusBar
                cwd={activeCwd}
                filePath={activeFilePath}
                home={home}
                onCd={sendCd}
                onWorkspaceChange={switchWorkspace}
                onOpenMini={openMini}
                hasComposer={hasComposer}
                privateActive={
                  activeTab?.kind === "terminal" && activeTab.private === true
                }
              />
            )}

            <AppBridges
              tabs={tabs}
              activeId={activeId}
              hasComposer={hasComposer}
              piSidebarVisible={piSidebarVisible}
              onActivateAgent={onActivateAgent}
              onActivatePiSession={onActivatePiSession}
              openAiDiffTab={openAiDiffTab}
              closeAiDiffTab={closeAiDiffTab}
            />

            <AnimatePresence>
              <AppFloatingSurfaces
                askPopup={askPopup}
                codePanelContext={codePanelContext}
                codeSurface={codeSurface}
                hasComposer={hasComposer}
                miniOpen={miniOpen}
                onAskFromSelection={onAskFromSelection}
                onDismissAskPopup={dismissAskPopup}
                openCodeInSidebar={openCodeInSidebar}
                openCodeWorkspace={openCodeWorkspace}
                pi={{
                  focusRequest: piFocusRequest,
                  onOpenLocalAgent: launchPiLocalAgent,
                  onSelectedSessionChange: setCodeSelectedSessionId,
                }}
              />
            </AnimatePresence>

            <AppOverlays
              commandPalette={{
                open: commandPaletteOpen,
                onOpenChange: setCommandPaletteOpen,
                actions: commandPaletteActions,
                workspaceRoot: explorerRoot,
                onOpenFile: handleOpenFile,
              }}
              shortcuts={{
                open: shortcutsOpen,
                onOpenChange: setShortcutsOpen,
              }}
              newEditor={{
                open: newEditorOpen,
                onOpenChange: setNewEditorOpen,
                rootPath: explorerRoot ?? home,
                onCreated: (path) => openFileTab(path),
              }}
              closeDialogs={{
                pendingCloseTab,
                pendingDeleteTabs,
                pendingTerminalCloseTab,
                tabs,
                onCancelClose: cancelClose,
                onCancelDeleteClose: cancelDeleteClose,
                onConfirmClose: confirmClose,
                onConfirmDeleteClose: confirmDeleteClose,
                onDisposeTab: disposeTab,
                onTerminalCloseTabChange: setPendingTerminalCloseTab,
              }}
            />
          </div>
        </TooltipProvider>
      </PiControllerProvider>
    </ThemeProvider>
  );

  return (
    <AiComposerProvider
      piComposer={{
        enabled: piComposerEnabled,
        context: codePanelContext,
        providerConfig: piComposerProvider.ok
          ? piComposerProvider.config
          : null,
        providerReady: piComposerProvider.ok,
        selectedSessionId: codeSelectedSessionId,
        onActivateSession: onActivatePiSession,
        onSelectedSessionChange: setCodeSelectedSessionId,
      }}
    >
      <MotionConfig reducedMotion="user">{shell}</MotionConfig>
    </AiComposerProvider>
  );
}
