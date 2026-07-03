import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import type { SettingsTab } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  AiScanIcon,
  InformationCircleIcon,
  PaintBoardIcon,
  Settings01Icon,
  UserMultiple02Icon,
  KeyboardIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type JSX, useEffect, useState } from "react";
import { AboutSection } from "./sections/AboutSection";
import { AgentsSection } from "./sections/AgentsSection";
import { GeneralSection } from "./sections/GeneralSection";
import { ModelsSection } from "./sections/ModelsSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { ThemesSection } from "./sections/ThemesSection";
import {
  useI18nStore,
  useTranslation,
  AVAILABLE_LOCALES,
  type Locale,
} from "@/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Globe02Icon } from "@hugeicons/core-free-icons";

const TABS: { id: SettingsTab; labelKey: string; icon: typeof Settings01Icon, component: () => JSX.Element }[] =
  [
    { id: "general", labelKey: "settings.tabs.general", icon: Settings01Icon, component: GeneralSection },
    { id: "themes", labelKey: "settings.tabs.themes", icon: PaintBoardIcon, component: ThemesSection },
    { id: "shortcuts", labelKey: "settings.tabs.shortcuts", icon: KeyboardIcon, component: ShortcutsSection },
    { id: "models", labelKey: "settings.tabs.models", icon: AiScanIcon, component: ModelsSection },
    { id: "agents", labelKey: "settings.tabs.agents", icon: UserMultiple02Icon, component: AgentsSection },
    { id: "about", labelKey: "settings.tabs.about", icon: InformationCircleIcon, component: AboutSection },
  ];

const VALID_TABS: SettingsTab[] = [
  "general",
  "themes",
  "shortcuts",
  "models",
  "agents",
  "about",
];

function readInitialTab(): SettingsTab {
  if (typeof window === "undefined") return "general";
  const url = new URL(window.location.href);
  const t = url.searchParams.get("tab");
  // Back-compat: legacy "ai" / "connections" → "models".
  if (t === "ai" || t === "connections") return "models";
  if (t && (VALID_TABS as string[]).includes(t)) return t as SettingsTab;
  return "general";
}

export function SettingsApp() {
  const [active, setActive] = useState<SettingsTab>(readInitialTab);
  const init = usePreferencesStore((s) => s.init);
  const ActiveSection = TABS.find(t => t.id === active)?.component;
  const t = useTranslation();
  const currentLocale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const apply = (detail: string) => {
      if (detail === "ai" || detail === "connections") {
        setActive("models");
        return;
      }
      if ((VALID_TABS as string[]).includes(detail)) {
        setActive(detail as SettingsTab);
      }
    };
    const unlistenPromise = getCurrentWebviewWindow().listen<string>(
      "terax:settings-tab",
      (e) => apply(e.payload),
    );
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground select-none">
      <header
        data-tauri-drag-region
        className={`flex h-11 shrink-0 items-center border-b border-border/60 bg-card/60 ${IS_MAC ? "pr-3 pl-22" : "pr-0 pl-3"
          }`}
      >
        <Tabs
          value={active}
          onValueChange={(v) => setActive(v as SettingsTab)}
          orientation="horizontal"
          className="flex-1 items-center"
          data-tauri-drag-region
        >
          <TabsList className="mx-auto h-7 bg-muted/40 px-2">
            {TABS.map((t_item) => (
              <TabsTrigger
                key={t_item.id}
                value={t_item.id}
                className="h-6 gap-1.5 px-2.5 text-[11.5px]"
              >
                <HugeiconsIcon icon={t_item.icon} size={12} strokeWidth={1.75} />
                <span>{t(t_item.labelKey)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        
        {/* Language Selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="mr-2 size-7 text-muted-foreground hover:text-foreground"
              title="Language"
            >
              <HugeiconsIcon icon={Globe02Icon} size={14} strokeWidth={1.75} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-32 p-1">
            {AVAILABLE_LOCALES.map((locale) => (
              <DropdownMenuItem
                key={locale.value}
                onSelect={() => setLocale(locale.value as Locale)}
                className="flex items-center justify-between gap-2 text-[12px]"
              >
                <span>{locale.label}</span>
                {currentLocale === locale.value && (
                  <span className="text-[10px] text-muted-foreground">✓</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {USE_CUSTOM_WINDOW_CONTROLS && <WindowControls closeOnly />}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-7 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto w-full max-w-160">
          {ActiveSection && <ActiveSection />}
        </div>
      </main>
    </div>
  );
}
