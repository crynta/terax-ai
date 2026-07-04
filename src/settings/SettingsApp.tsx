import { Input } from "@/components/ui/input";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { SettingsTab } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  AiScanIcon,
  DashboardSquare01Icon,
  FileEditIcon,
  Folder01Icon,
  InformationCircleIcon,
  KeyboardIcon,
  PaintBoardIcon,
  PlugIcon,
  Search01Icon,
  Settings01Icon,
  TerminalIcon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type JSX, useEffect, useMemo, useState } from "react";
import { AboutSection } from "./sections/AboutSection";
import { AgentsSection } from "./sections/AgentsSection";
import {
  EditorSettingsSection,
  ExplorerSettingsSection,
  GeneralSection,
  InterfaceSettingsSection,
  LspSettingsSection,
  TerminalSettingsSection,
} from "./sections/GeneralSection";
import { ModelsSection } from "./sections/ModelsSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { ThemesSection } from "./sections/ThemesSection";

type NavItem = {
  id: SettingsTab;
  label: string;
  icon: typeof Settings01Icon;
  keywords: string[];
  component: () => JSX.Element;
};

const NAV: NavItem[] = [
  {
    id: "general",
    label: "General",
    icon: Settings01Icon,
    keywords: [
      "appearance",
      "zoom",
      "startup",
      "autostart",
      "launch",
      "login",
      "window",
      "notifications",
      "sidebar",
    ],
    component: GeneralSection,
  },
  {
    id: "editor",
    label: "Editor",
    icon: FileEditIcon,
    keywords: ["vim", "word wrap", "auto save", "format", "code"],
    component: EditorSettingsSection,
  },
  {
    id: "lsp",
    label: "Language servers",
    icon: PlugIcon,
    keywords: ["lsp", "diagnostics", "completion", "intellisense"],
    component: LspSettingsSection,
  },
  {
    id: "interface",
    label: "Interface",
    icon: DashboardSquare01Icon,
    keywords: ["status bar", "animation", "speed", "chrome"],
    component: InterfaceSettingsSection,
  },
  {
    id: "explorer",
    label: "Explorer",
    icon: Folder01Icon,
    keywords: ["files", "hidden", "git", "decorations", "tree"],
    component: ExplorerSettingsSection,
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: TerminalIcon,
    keywords: [
      "font",
      "shell",
      "scrollback",
      "webgl",
      "cursor",
      "wsl",
      "letter spacing",
    ],
    component: TerminalSettingsSection,
  },
  {
    id: "themes",
    label: "Themes",
    icon: PaintBoardIcon,
    keywords: ["color", "background", "dark", "light", "editor theme"],
    component: ThemesSection,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    icon: KeyboardIcon,
    keywords: ["keybindings", "keyboard", "keys", "hotkeys"],
    component: ShortcutsSection,
  },
  {
    id: "models",
    label: "Models",
    icon: AiScanIcon,
    keywords: [
      "api key",
      "provider",
      "openai",
      "anthropic",
      "ollama",
      "ai",
      "voice",
    ],
    component: ModelsSection,
  },
  {
    id: "agents",
    label: "Agents",
    icon: UserMultiple02Icon,
    keywords: ["custom instructions", "assistant", "prompt", "ai"],
    component: AgentsSection,
  },
  {
    id: "about",
    label: "About",
    icon: InformationCircleIcon,
    keywords: ["version", "update", "license"],
    component: AboutSection,
  },
];

const VALID_TABS = NAV.map((n) => n.id);

function normalizeTab(t: string | null): SettingsTab | null {
  // Back-compat: legacy "ai" / "connections" → "models".
  if (t === "ai" || t === "connections") return "models";
  if (t && (VALID_TABS as string[]).includes(t)) return t as SettingsTab;
  return null;
}

function readInitialTab(): SettingsTab {
  if (typeof window === "undefined") return "general";
  const url = new URL(window.location.href);
  return normalizeTab(url.searchParams.get("tab")) ?? "general";
}

export function SettingsApp() {
  const [active, setActive] = useState<SettingsTab>(readInitialTab);
  const [query, setQuery] = useState("");
  const init = usePreferencesStore((s) => s.init);
  const ActiveSection = NAV.find((t) => t.id === active)?.component;

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const unlistenPromise = getCurrentWebviewWindow().listen<string>(
      "terax:settings-tab",
      (e) => {
        const tab = normalizeTab(e.payload);
        if (tab) setActive(tab);
      },
    );
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, []);

  const visibleNav = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV;
    return NAV.filter(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        n.keywords.some((k) => k.includes(q)),
    );
  }, [query]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground select-none">
      {/* Left rail: search + navigation */}
      <aside
        className={cn(
          "flex w-52 shrink-0 flex-col border-r border-border/60 bg-card/50",
          IS_MAC ? "pt-9" : "pt-2",
        )}
      >
        {IS_MAC && (
          <div
            data-tauri-drag-region
            className="absolute inset-x-0 top-0 h-9"
          />
        )}
        <div className="relative px-3 pb-2">
          <HugeiconsIcon
            icon={Search01Icon}
            size={12}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-5.5 -translate-y-[calc(50%+4px)] text-muted-foreground/70"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings…"
            className="h-7 rounded-md border-border/50 bg-muted/40 pl-7 text-xs transition-colors placeholder:text-muted-foreground/60 hover:bg-muted/60 focus-visible:border-ring/50 focus-visible:bg-muted/60 focus-visible:ring-0"
          />
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleNav.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">
              No matching sections
            </p>
          ) : (
            visibleNav.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setActive(n.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
                  active === n.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <HugeiconsIcon
                  icon={n.icon}
                  size={14}
                  strokeWidth={1.75}
                  className={cn(
                    "shrink-0",
                    active === n.id
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                />
                <span className="truncate">{n.label}</span>
              </button>
            ))
          )}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          data-tauri-drag-region
          className="flex h-9 shrink-0 items-center justify-end"
        >
          {USE_CUSTOM_WINDOW_CONTROLS && <WindowControls closeOnly />}
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto px-8 pb-8 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="mx-auto w-full max-w-160">
            {ActiveSection && <ActiveSection />}
          </div>
        </main>
      </div>
    </div>
  );
}
