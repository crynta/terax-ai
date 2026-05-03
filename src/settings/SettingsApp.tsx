import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import type { SettingsTab } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  AiScanIcon,
  InformationCircleIcon,
  Settings01Icon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useState } from "react";
import { AboutSection } from "./sections/AboutSection";
import { AgentsSection } from "./sections/AgentsSection";
import { GeneralSection } from "./sections/GeneralSection";
import { ModelsSection } from "./sections/ModelsSection";

const TABS: { id: SettingsTab; label: string; icon: typeof Settings01Icon }[] =
  [
    { id: "general", label: "General", icon: Settings01Icon },
    { id: "models", label: "Models", icon: AiScanIcon },
    { id: "agents", label: "Agents", icon: UserMultiple02Icon },
    { id: "about", label: "About", icon: InformationCircleIcon },
  ];

const VALID_TABS: SettingsTab[] = ["general", "models", "agents", "about"];

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
        className={`flex h-11 shrink-0 items-center border-b border-border/60 bg-card/60 ${
          IS_MAC ? "pr-3 pl-22" : "pr-0 pl-3"
        }`}
      >
        <Tabs
          value={active}
          onValueChange={(v) => setActive(v as SettingsTab)}
          orientation="horizontal"
          className="flex-1 items-center"
          data-tauri-drag-region
        >
          <TabsList className="mx-auto h-7 bg-muted/40">
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
        {USE_CUSTOM_WINDOW_CONTROLS && <WindowControls />}
      </header>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 pt-6 pb-7">
        <div className="mx-auto w-full max-w-[640px]">
          {active === "general" && <GeneralSection />}
          {active === "models" && <ModelsSection />}
          {active === "agents" && <AgentsSection />}
          {active === "about" && <AboutSection />}
        </div>
      </main>
    </div>
  );
}
