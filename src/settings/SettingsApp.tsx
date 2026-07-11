import { Input } from "@/components/ui/input";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { useAnimationScale } from "@/lib/useAnimationScale";
import { cn } from "@/lib/utils";
import type { SettingsTab } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  AiScanIcon,
  CommandLineIcon,
  DashboardSquare01Icon,
  FileEditIcon,
  Folder01Icon,
  InformationCircleIcon,
  KeyboardIcon,
  PaintBoardIcon,
  PlugIcon,
  Search01Icon,
  Settings01Icon,
  SparklesIcon,
  TerminalIcon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type JSX, useEffect, useMemo, useState } from "react";
import { AboutSection } from "./sections/AboutSection";
import { AgentsSection } from "./sections/AgentsSection";
import {
  AssistSettingsSection,
  EditorSettingsSection,
  ExplorerSettingsSection,
  GeneralSection,
  InterfaceSettingsSection,
  LspSettingsSection,
  ShellToolsSection,
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
      "toasts",
    ],
    component: GeneralSection,
  },
  {
    id: "interface",
    label: "Interface",
    icon: DashboardSquare01Icon,
    keywords: [
      "status bar",
      "sidebar",
      "animation",
      "speed",
      "chrome",
      "tabs",
      "titles",
      "progress",
      "keybind hints",
    ],
    component: InterfaceSettingsSection,
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
      "ssh",
      "padding",
      "letter spacing",
    ],
    component: TerminalSettingsSection,
  },
  {
    id: "assist",
    label: "AI assist",
    icon: SparklesIcon,
    keywords: [
      "suggestions",
      "completion",
      "autocomplete",
      "natural language",
      "fix",
      "ai",
    ],
    component: AssistSettingsSection,
  },
  {
    id: "shelltools",
    label: "Shell tools",
    icon: CommandLineIcon,
    keywords: ["nvim", "tui", "overrides", "keybindings", "rebind"],
    component: ShellToolsSection,
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
    id: "explorer",
    label: "Explorer",
    icon: Folder01Icon,
    keywords: ["files", "hidden", "git", "decorations", "tree"],
    component: ExplorerSettingsSection,
  },
  {
    id: "themes",
    label: "Themes",
    icon: PaintBoardIcon,
    keywords: ["color", "background", "dark", "light", "editor theme"],
    component: ThemesSection,
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
    id: "shortcuts",
    label: "Shortcuts",
    icon: KeyboardIcon,
    keywords: ["keybindings", "keyboard", "keys", "hotkeys"],
    component: ShortcutsSection,
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

const NAV_GROUPS: { label: string; ids: SettingsTab[] }[] = [
  { label: "App", ids: ["general", "interface", "themes"] },
  {
    label: "Workspace",
    ids: ["terminal", "editor", "explorer", "lsp", "shelltools"],
  },
  { label: "Intelligence", ids: ["assist", "models", "agents"] },
  { label: "System", ids: ["shortcuts", "about"] },
];

const NAV_BY_ID = new Map(NAV.map((n) => [n.id, n]));

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
  // Own window: the --terax-anim scale must be applied here too, or every
  // calc()-based duration in Settings falls back to normal speed.
  useAnimationScale();
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
    // The emit fired while this webview was still booting is lost — pull
    // the stashed tab once the listener is up.
    void invoke<string | null>("settings_take_pending_tab")
      .then((t) => {
        const tab = normalizeTab(t);
        if (tab) setActive(tab);
      })
      .catch(() => {});
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, []);

  const visibleIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return new Set(NAV.map((n) => n.id));
    return new Set(
      NAV.filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.keywords.some((k) => k.includes(q)),
      ).map((n) => n.id),
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
          {visibleIds.size === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">
              No matching sections
            </p>
          ) : (
            NAV_GROUPS.map((group) => {
              const ids = group.ids.filter((id) => visibleIds.has(id));
              if (ids.length === 0) return null;
              return (
                <div key={group.label} className="mb-1">
                  <div className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground/60 uppercase">
                    {group.label}
                  </div>
                  {ids.map((id) => {
                    const n = NAV_BY_ID.get(id);
                    if (!n) return null;
                    return (
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
                    );
                  })}
                </div>
              );
            })
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
