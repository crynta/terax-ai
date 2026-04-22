import type { SearchAddon } from "@xterm/addon-search";
import { useEffect, useRef, useState } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header, type SearchInlineHandle } from "@/modules/header";
import { TerminalPane } from "@/modules/terminal";
import { useTabs } from "@/modules/tabs";

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

  useEffect(() => {
    setActiveSearchAddon(searchAddons.current.get(activeId) ?? null);
  }, [activeId]);

  const handleSearchReady = (id: number, addon: SearchAddon) => {
    searchAddons.current.set(id, addon);
    if (id === activeId) setActiveSearchAddon(addon);
  };

  const handleClose = (id: number) => {
    searchAddons.current.delete(id);
    closeTab(id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "t") {
        e.preventDefault();
        newTab();
      } else if (e.key === "w") {
        e.preventDefault();
        handleClose(activeId);
      } else if (e.key === "f") {
        e.preventDefault();
        searchInlineRef.current?.focus();
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        selectByIndex(parseInt(e.key, 10) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <ThemeProvider>
      <TooltipProvider>
        <div className="dark relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
          <Header
            tabs={tabs}
            activeId={activeId}
            onSelect={setActiveId}
            onNew={newTab}
            onClose={handleClose}
            onToggleSidebar={() => {}}
            onOpenSettings={() => {}}
            searchAddon={activeSearchAddon}
            searchRef={searchInlineRef}
          />

          <div className="relative min-h-0 flex-1 px-3 pt-2 pb-2.5">
            {tabs.map((t) => (
              <div key={t.id} className="absolute inset-x-3 inset-y-2.5">
                <TerminalPane
                  tabId={t.id}
                  visible={t.id === activeId}
                  onSearchReady={handleSearchReady}
                  onCwd={(id, cwd) => updateTab(id, { cwd })}
                />
              </div>
            ))}
          </div>
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}
