import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  AiPanel,
  type AiPanelHandle,
  useChatStore,
} from "@/modules/ai";
import { EditorStack, type EditorPaneHandle } from "@/modules/editor";
import { FileExplorer } from "@/modules/explorer";
import {
  Header,
  type SearchInlineHandle,
  type SearchTarget,
} from "@/modules/header";
import {
  ShortcutsDialog,
  useGlobalShortcuts,
  type ShortcutHandlers,
} from "@/modules/shortcuts";
import { StatusBar } from "@/modules/statusbar";
import { useTabs, useWorkspaceCwd } from "@/modules/tabs";
import {
  TerminalStack,
  type TerminalPaneHandle,
} from "@/modules/terminal";
import { ThemeProvider } from "@/modules/theme";
import { homeDir } from "@tauri-apps/api/path";
import type { SearchAddon } from "@xterm/addon-search";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

export default function App() {
  const {
    tabs,
    activeId,
    setActiveId,
    newTab,
    openFileTab,
    closeTab,
    updateTab,
    selectByIndex,
  } = useTabs();

  const searchAddons = useRef<Map<number, SearchAddon>>(new Map());
  const [activeSearchAddon, setActiveSearchAddon] =
    useState<SearchAddon | null>(null);
  const searchInlineRef = useRef<SearchInlineHandle | null>(null);
  const terminalRefs = useRef<Map<number, TerminalPaneHandle>>(new Map());
  const editorRefs = useRef<Map<number, EditorPaneHandle>>(new Map());
  const [activeEditorHandle, setActiveEditorHandle] =
    useState<EditorPaneHandle | null>(null);
  const aiPanelRef = useRef<AiPanelHandle | null>(null);

  const sidebarRef = useRef<PanelImperativeHandle | null>(null);
  const toggleSidebar = useCallback(() => {
    const p = sidebarRef.current;
    if (!p) return;
    if (p.getSize().asPercentage <= 0) p.expand();
    else p.collapse();
  }, []);

  const [home, setHome] = useState<string | null>(null);
  useEffect(() => {
    homeDir()
      .then(setHome)
      .catch(() => setHome(null));
  }, []);

  const [aiOpen, setAiOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const dropChat = useChatStore((s) => s.drop);
  const setLive = useChatStore((s) => s.setLive);

  const activeTab = tabs.find((t) => t.id === activeId);
  const isTerminalTab = activeTab?.kind === "terminal";
  const isEditorTab = activeTab?.kind === "editor";

  const { explorerRoot, inheritedCwdForNewTab } = useWorkspaceCwd(
    activeTab,
    tabs,
    home,
  );

  useEffect(() => {
    setActiveSearchAddon(searchAddons.current.get(activeId) ?? null);
    setActiveEditorHandle(editorRefs.current.get(activeId) ?? null);
  }, [activeId]);

  const handleSearchReady = useCallback(
    (id: number, addon: SearchAddon) => {
      searchAddons.current.set(id, addon);
      if (id === activeId) setActiveSearchAddon(addon);
    },
    [activeId],
  );

  const disposeTab = useCallback(
    (id: number) => {
      searchAddons.current.delete(id);
      terminalRefs.current.delete(id);
      editorRefs.current.delete(id);
      dropChat(id);
      closeTab(id);
    },
    [closeTab, dropChat],
  );

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
      return terminalRefs.current.get(activeId)?.getSelection() ?? null;
    }
    if (t.kind === "editor") {
      return editorRefs.current.get(activeId)?.getSelection() ?? null;
    }
    return null;
  }, [tabs, activeId]);

  const toggleAi = useCallback(() => {
    setAiOpen((prev) => {
      const next = !prev;
      if (next) {
        const selection = captureActiveSelection();
        setTimeout(() => {
          if (selection) {
            const quoted = `> ${selection
              .trim()
              .split("\n")
              .join("\n> ")}\n\n`;
            aiPanelRef.current?.prefill(quoted);
          } else {
            aiPanelRef.current?.focus();
          }
        }, 50);
      }
      return next;
    });
  }, [captureActiveSelection]);

  const openNewTab = useCallback(() => {
    newTab(inheritedCwdForNewTab());
  }, [newTab, inheritedCwdForNewTab]);

  const sendCd = useCallback(
    (path: string) => {
      const term = terminalRefs.current.get(activeId);
      if (!term) return;
      const quoted = path.includes(" ")
        ? `'${path.replace(/'/g, `'\\''`)}'`
        : path;
      term.write(`cd ${quoted}\n`);
      term.focus();
    },
    [activeId],
  );

  const cdInNewTab = useCallback(
    (path: string) => {
      const id = newTab(path);
      // After mount, send cd so the prompt reflects the directory immediately
      // even if the shell init didn't pick up the spawn cwd cleanly.
      setTimeout(() => {
        const t = terminalRefs.current.get(id);
        if (!t) return;
        const quoted = path.includes(" ")
          ? `'${path.replace(/'/g, `'\\''`)}'`
          : path;
        t.write(`cd ${quoted}\n`);
        t.focus();
      }, 80);
    },
    [newTab],
  );

  const handleOpenFile = useCallback(
    (path: string) => {
      openFileTab(path);
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

  const activeFilePath =
    activeTab?.kind === "editor" ? activeTab.path : null;

  const shortcutHandlers = useMemo<ShortcutHandlers>(
    () => ({
      "tab.new": openNewTab,
      "tab.close": () => handleClose(activeId),
      "tab.next": () => cycleTab(1),
      "tab.prev": () => cycleTab(-1),
      "tab.selectByIndex": (e) => selectByIndex(parseInt(e.key, 10) - 1),
      "search.focus": () => searchInlineRef.current?.focus(),
      "ai.toggle": toggleAi,
      "shortcuts.open": () => setShortcutsOpen((v) => !v),
      "sidebar.toggle": toggleSidebar,
    }),
    [
      activeId,
      cycleTab,
      handleClose,
      openNewTab,
      selectByIndex,
      toggleAi,
      toggleSidebar,
    ],
  );

  useGlobalShortcuts(shortcutHandlers);

  const registerTerminalHandle = useCallback(
    (id: number, h: TerminalPaneHandle | null) => {
      if (h) terminalRefs.current.set(id, h);
      else terminalRefs.current.delete(id);
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

  const handleTerminalCwd = useCallback(
    (id: number, cwd: string) => updateTab(id, { cwd }),
    [updateTab],
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

  const activeCwd =
    activeTab?.kind === "terminal" ? (activeTab.cwd ?? null) : null;

  useEffect(() => {
    setLive({
      getCwd: () => {
        const t = tabs.find((x) => x.id === activeId);
        return t?.kind === "terminal" ? (t.cwd ?? null) : null;
      },
      getTerminalContext: () => {
        const t = tabs.find((x) => x.id === activeId);
        if (t?.kind !== "terminal") return null;
        return terminalRefs.current.get(activeId)?.getBuffer(300) ?? null;
      },
    });
  }, [setLive, activeId, tabs]);

  return (
    <ThemeProvider>
      <TooltipProvider>
        <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
          <Header
            tabs={tabs}
            activeId={activeId}
            onSelect={setActiveId}
            onNew={openNewTab}
            onClose={handleClose}
            onToggleSidebar={toggleSidebar}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            onOpenSettings={() => {}}
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
                defaultSize="22%"
                minSize="14%"
                maxSize="40%"
                collapsible
                collapsedSize={0}
              >
                <div className="h-full border-r border-border/60 bg-card">
                  <FileExplorer
                    rootPath={explorerRoot}
                    onOpenFile={handleOpenFile}
                    onPathRenamed={handlePathRenamed}
                    onPathDeleted={handlePathDeleted}
                    onRevealInTerminal={cdInNewTab}
                  />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel
                id="workspace"
                defaultSize="78%"
                minSize="30%"
              >
                <ResizablePanelGroup
                  orientation="vertical"
                  className="min-h-0 flex-1"
                >
                  <ResizablePanel
                    id="main"
                    defaultSize={aiOpen ? 60 : 100}
                    minSize={25}
                  >
                    <div className="relative h-full">
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
                        />
                      </div>
                    </div>
                  </ResizablePanel>
                  {aiOpen ? (
                    <>
                      <ResizableHandle />
                      <ResizablePanel id="ai" defaultSize={40} minSize={20}>
                        <motion.div
                          key="ai-panel"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            type: "spring",
                            stiffness: 280,
                            damping: 30,
                          }}
                          className="h-full"
                        >
                          <AiPanel
                            ref={aiPanelRef}
                            tabId={activeId}
                            onClose={() => setAiOpen(false)}
                          />
                        </motion.div>
                      </ResizablePanel>
                    </>
                  ) : null}
                </ResizablePanelGroup>
              </ResizablePanel>
            </ResizablePanelGroup>
          </main>

          <StatusBar
            cwd={activeCwd}
            filePath={activeFilePath}
            home={home}
            onCd={sendCd}
            aiOpen={aiOpen}
            canSubmit={true}
            onOpenAi={toggleAi}
            onSubmit={() => {
              aiPanelRef.current?.focus();
            }}
          />

          <ShortcutsDialog
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
          />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}
