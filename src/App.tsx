import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "@xterm/xterm/css/xterm.css";
import "./App.css";

import type { SearchAddon } from "@xterm/addon-search";
import { useCallback, useEffect, useRef, useState } from "react";
import { Header, type Tab } from "./Header";
import { SearchBar } from "./SearchBar";
import { TerminalPane } from "./TerminalPane";
import { ThemeProvider } from "./components/theme-provider";
import { TooltipProvider } from "./components/ui/tooltip";
import { shadcnDark } from "./themes";

const ACTIVE_THEME = shadcnDark;

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([{ id: 1, title: "shell" }]);
  const [activeId, setActiveId] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const nextIdRef = useRef(2);
  const searchAddonsRef = useRef<Map<number, SearchAddon>>(new Map());
  const [activeSearchAddon, setActiveSearchAddon] =
    useState<SearchAddon | null>(null);

  // Keep the active search addon in sync when tab changes.
  useEffect(() => {
    setActiveSearchAddon(searchAddonsRef.current.get(activeId) ?? null);
  }, [activeId, tabs]);

  const newTab = useCallback(() => {
    const id = nextIdRef.current++;
    setTabs((t) => [...t, { id, title: "shell" }]);
    setActiveId(id);
  }, []);

  const closeTab = useCallback(
    (id: number) => {
      setTabs((curr) => {
        if (curr.length <= 1) return curr;
        const idx = curr.findIndex((t) => t.id === id);
        const next = curr.filter((t) => t.id !== id);
        searchAddonsRef.current.delete(id);
        if (id === activeId) {
          // Activate neighbour: prefer the one to the left.
          const fallback = next[Math.max(0, idx - 1)];
          if (fallback) setActiveId(fallback.id);
        }
        return next;
      });
    },
    [activeId],
  );

  const handleSearchReady = useCallback(
    (id: number, addon: SearchAddon) => {
      searchAddonsRef.current.set(id, addon);
      if (id === activeId) setActiveSearchAddon(addon);
    },
    [activeId],
  );

  // Keyboard shortcuts: ⌘T new, ⌘W close, ⌘F search, ⌘1-9 jump.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === "t") {
        e.preventDefault();
        newTab();
      } else if (e.key === "w") {
        e.preventDefault();
        closeTab(activeId);
      } else if (e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const target = tabs[idx];
        if (target) {
          e.preventDefault();
          setActiveId(target.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, newTab, closeTab, tabs]);

  return (
    <ThemeProvider>
      <TooltipProvider>
        <div
          className="dark"
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            height: "100vh",
            background: ACTIVE_THEME.background,
            color: "#fafafa",
            overflow: "hidden",
          }}
        >
          <Header
            tabs={tabs}
            activeId={activeId}
            onSelect={setActiveId}
            onNew={newTab}
            onClose={closeTab}
            onToggleSidebar={() => {
              /* TODO: file explorer */
            }}
            onOpenSearch={() => setSearchOpen(true)}
            onOpenSettings={() => {
              /* TODO: settings */
            }}
          />

          <div
            style={{
              flex: 1,
              minHeight: 0,
              padding: "8px 12px 10px",
              boxSizing: "border-box",
              position: "relative",
            }}
          >
            {tabs.map((t) => (
              <div
                key={t.id}
                style={{
                  position: "absolute",
                  inset: "8px 12px 10px",
                  // All panes live in DOM; only active is `display: block`.
                }}
              >
                <TerminalPane
                  tabId={t.id}
                  visible={t.id === activeId}
                  onSearchReady={handleSearchReady}
                />
              </div>
            ))}
          </div>

          <SearchBar
            addon={activeSearchAddon}
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
          />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}
