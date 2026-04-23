import { ThemeProvider } from "@/components/ThemeProvider";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AiInput,
  type AiInputHandle,
  AiSessionView,
  useSessions,
} from "@/modules/ai";
import { Header, type SearchInlineHandle } from "@/modules/header";
import { ShortcutsDialog } from "@/modules/shortcuts";
import { StatusBar } from "@/modules/statusbar";
import { useTabs } from "@/modules/tabs";
import { TerminalPane, type TerminalPaneHandle } from "@/modules/terminal";
import { homeDir } from "@tauri-apps/api/path";
import type { SearchAddon } from "@xterm/addon-search";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export default function App() {
  const {
    tabs,
    activeId,
    setActiveId,
    newTab,
    closeTab,
    updateTab,
    selectByIndex,
  } = useTabs();

  const searchAddons = useRef<Map<number, SearchAddon>>(new Map());
  const [activeSearchAddon, setActiveSearchAddon] =
    useState<SearchAddon | null>(null);
  const searchInlineRef = useRef<SearchInlineHandle | null>(null);
  const terminalRefs = useRef<Map<number, TerminalPaneHandle>>(new Map());
  const aiInputRef = useRef<AiInputHandle | null>(null);

  const [home, setHome] = useState<string | null>(null);
  useEffect(() => {
    homeDir()
      .then(setHome)
      .catch(() => setHome(null));
  }, []);

  const [aiOpen, setAiOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const sessions = useSessions();

  const activeTab = tabs.find((t) => t.id === activeId);
  const activeSession = sessions.get(activeId);

  useEffect(() => {
    setActiveSearchAddon(searchAddons.current.get(activeId) ?? null);
  }, [activeId]);

  const handleSearchReady = useCallback(
    (id: number, addon: SearchAddon) => {
      searchAddons.current.set(id, addon);
      if (id === activeId) setActiveSearchAddon(addon);
    },
    [activeId],
  );

  const handleClose = useCallback(
    (id: number) => {
      searchAddons.current.delete(id);
      terminalRefs.current.delete(id);
      sessions.clear(id);
      closeTab(id);
    },
    [closeTab, sessions],
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

  const toggleAi = useCallback(() => {
    setAiOpen((prev) => {
      const next = !prev;
      if (next) setTimeout(() => aiInputRef.current?.focus(), 50);
      return next;
    });
  }, []);

  const openNewTab = useCallback(() => {
    const inherited = tabs.find((t) => t.id === activeId)?.cwd ?? home ?? undefined;
    newTab(inherited);
  }, [tabs, activeId, home, newTab]);

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

  const handleAiSubmit = useCallback(
    (prompt: string) => {
      sessions.start(activeId, prompt);
    },
    [sessions, activeId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const ctrl = e.ctrlKey;
      const consume = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };

      if (ctrl && e.key === "Tab") {
        consume();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      if (!mod) return;

      if (e.key === "t") {
        consume();
        openNewTab();
      } else if (e.key === "w") {
        consume();
        handleClose(activeId);
      } else if (e.key === "f") {
        consume();
        searchInlineRef.current?.focus();
      } else if (e.key === "i") {
        consume();
        toggleAi();
      } else if (e.key === "k") {
        consume();
        setShortcutsOpen((v) => !v);
      } else if (/^[1-9]$/.test(e.key)) {
        consume();
        selectByIndex(parseInt(e.key, 10) - 1);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [activeId, cycleTab, handleClose, openNewTab, selectByIndex, toggleAi]);

  const terminalStack = useMemo(
    () => (
      <div className="relative h-full w-full">
        {tabs.map((t) => (
          <div key={t.id} className="absolute inset-0">
            <TerminalPane
              tabId={t.id}
              visible={t.id === activeId}
              initialCwd={t.cwd}
              ref={(h) => {
                if (h) terminalRefs.current.set(t.id, h);
                else terminalRefs.current.delete(t.id);
              }}
              onSearchReady={handleSearchReady}
              onCwd={(id, cwd) => updateTab(id, { cwd })}
            />
          </div>
        ))}
      </div>
    ),
    [tabs, activeId, handleSearchReady, updateTab],
  );

  return (
    <ThemeProvider>
      <TooltipProvider>
        <div className="dark relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
          <Header
            tabs={tabs}
            activeId={activeId}
            onSelect={setActiveId}
            onNew={openNewTab}
            onClose={handleClose}
            onToggleSidebar={() => {}}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            onOpenSettings={() => {}}
            searchAddon={activeSearchAddon}
            searchRef={searchInlineRef}
          />

          <main className="flex min-h-0 flex-1 flex-col">
            <ResizablePanelGroup
              orientation="vertical"
              className="min-h-0 flex-1"
            >
              <ResizablePanel
                id="terminal"
                defaultSize={aiOpen && activeSession ? 65 : 100}
                minSize={25}
              >
                <div className="h-full px-3 pt-2 pb-2">{terminalStack}</div>
              </ResizablePanel>
              {aiOpen && activeSession ? (
                <>
                  <ResizableHandle />
                  <ResizablePanel
                    id="ai"
                    defaultSize={35}
                    minSize={15}
                  >
                    <motion.div
                      key="ai-session"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        type: "spring",
                        stiffness: 280,
                        damping: 30,
                      }}
                      className="h-full"
                    >
                      <AiSessionView session={activeSession} />
                    </motion.div>
                  </ResizablePanel>
                </>
              ) : null}
            </ResizablePanelGroup>

            <AnimatePresence initial={false}>
              {aiOpen && (
                <motion.div
                  key="ai-input"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{
                    type: "spring",
                    stiffness: 320,
                    damping: 32,
                  }}
                  className="overflow-hidden"
                >
                  <AiInput
                    ref={aiInputRef}
                    onSubmit={handleAiSubmit}
                    onClose={() => setAiOpen(false)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </main>

          <StatusBar
            cwd={activeTab?.cwd ?? null}
            home={home}
            onCd={sendCd}
            aiOpen={aiOpen}
            canSubmit={activeSession?.status !== "thinking"}
            onOpenAi={toggleAi}
            onSubmit={() => {
              aiInputRef.current?.focus();
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
