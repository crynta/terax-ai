import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { SettingsSection } from "@/modules/settings/types";
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
import { type JSX, useCallback, useEffect, useState } from "react";
import { AboutSection } from "./sections/AboutSection";
import { AgentsSection } from "./sections/AgentsSection";
import { GeneralSection } from "./sections/GeneralSection";
import { ModelsSection } from "./sections/ModelsSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { ThemesSection } from "./sections/ThemesSection";

const TABS: {
  id: SettingsSection;
  label: string;
  icon: typeof Settings01Icon;
  component: () => JSX.Element;
}[] = [
  {
    id: "general",
    label: "General",
    icon: Settings01Icon,
    component: GeneralSection,
  },
  {
    id: "themes",
    label: "Themes",
    icon: PaintBoardIcon,
    component: ThemesSection,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    icon: KeyboardIcon,
    component: ShortcutsSection,
  },
  { id: "models", label: "Models", icon: AiScanIcon, component: ModelsSection },
  {
    id: "agents",
    label: "Agents",
    icon: UserMultiple02Icon,
    component: AgentsSection,
  },
  {
    id: "about",
    label: "About",
    icon: InformationCircleIcon,
    component: AboutSection,
  },
];

const VALID_TABS: SettingsSection[] = [
  "general",
  "themes",
  "shortcuts",
  "models",
  "agents",
  "about",
];

function normalizeSection(
  section: SettingsSection | undefined,
): SettingsSection | null {
  return section && (VALID_TABS as string[]).includes(section) ? section : null;
}

function readInitialTab(): SettingsSection {
  if (typeof window === "undefined") return "general";
  const url = new URL(window.location.href);
  const t = url.searchParams.get("tab");
  // Back-compat: legacy "ai" / "connections" → "models".
  if (t === "ai" || t === "connections") return "models";
  if (t && (VALID_TABS as string[]).includes(t)) return t as SettingsSection;
  return "general";
}

type SettingsAppProps = {
  embedded?: boolean;
  activeSection?: SettingsSection;
  onActiveSectionChange?: (section: SettingsSection) => void;
};

export function SettingsApp({
  embedded = false,
  activeSection,
  onActiveSectionChange,
}: SettingsAppProps) {
  const [active, setActive] = useState<SettingsSection>(
    normalizeSection(activeSection) ?? readInitialTab,
  );
  const init = usePreferencesStore((s) => s.init);
  const ActiveSection = TABS.find((t) => t.id === active)?.component;
  const setSection = useCallback(
    (section: SettingsSection) => {
      setActive((current) => (current === section ? current : section));
      onActiveSectionChange?.(section);
    },
    [onActiveSectionChange],
  );

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const nextSection = normalizeSection(activeSection);
    if (nextSection)
      setActive((current) => (current === nextSection ? current : nextSection));
  }, [activeSection]);

  useEffect(() => {
    if (embedded) return;
    const apply = (detail: string) => {
      if (detail === "ai" || detail === "connections") {
        setSection("models");
        return;
      }
      if ((VALID_TABS as string[]).includes(detail)) {
        setSection(detail as SettingsSection);
      }
    };
    const unlistenPromise = getCurrentWebviewWindow().listen<string>(
      "terax:settings-tab",
      (e) => apply(e.payload),
    );
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, [embedded, setSection]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground select-none">
      <header
        data-tauri-drag-region={!embedded ? true : undefined}
        className={`flex h-11 shrink-0 items-center border-b border-border/60 bg-card/60 ${
          IS_MAC ? "pr-3 pl-22" : "pr-0 pl-3"
        }`}
      >
        <Tabs
          value={active}
          onValueChange={(v) => setSection(v as SettingsSection)}
          orientation="horizontal"
          className="flex-1 items-center"
          data-tauri-drag-region={!embedded ? true : undefined}
        >
          <TabsList className="mx-auto h-7 bg-muted/40 px-2">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="h-6 gap-1.5 px-2.5 text-[11.5px]"
              >
                <HugeiconsIcon icon={t.icon} size={12} strokeWidth={1.75} />
                <span>{t.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {!embedded && USE_CUSTOM_WINDOW_CONTROLS && (
          <WindowControls closeOnly />
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-7 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto w-full max-w-160">
          {ActiveSection && <ActiveSection />}
        </div>
      </main>
    </div>
  );
}
