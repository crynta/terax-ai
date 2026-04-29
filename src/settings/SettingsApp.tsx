import { cn } from "@/lib/utils";
import type { SettingsTab } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  InformationCircleIcon,
  PlugSocketIcon,
  Settings01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { AboutSection } from "./sections/AboutSection";
import { AiSection } from "./sections/AiSection";
import { ConnectionsSection } from "./sections/ConnectionsSection";
import { GeneralSection } from "./sections/GeneralSection";

type AnyTab = SettingsTab | "connections";

type TabDef = {
  id: AnyTab;
  label: string;
  icon: typeof Settings01Icon;
};

const TABS: TabDef[] = [
  { id: "general", label: "General", icon: Settings01Icon },
  { id: "ai", label: "AI", icon: SparklesIcon },
  { id: "connections", label: "Connections", icon: PlugSocketIcon },
  { id: "about", label: "About", icon: InformationCircleIcon },
];

function readInitialTab(): AnyTab {
  if (typeof window === "undefined") return "general";
  const url = new URL(window.location.href);
  const t = url.searchParams.get("tab");
  if (t === "general" || t === "ai" || t === "about" || t === "connections") {
    return t;
  }
  return "general";
}

export function SettingsApp() {
  const [active, setActive] = useState<AnyTab>(readInitialTab);
  const init = usePreferencesStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const onTab = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (
        detail === "general" ||
        detail === "ai" ||
        detail === "about" ||
        detail === "connections"
      ) {
        setActive(detail);
      }
    };
    window.addEventListener("terax:settings-tab", onTab);
    return () => window.removeEventListener("terax:settings-tab", onTab);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground select-none">
      <header
        data-tauri-drag-region
        className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 bg-card/60 pr-3 pl-22"
      >
        <nav
          className="flex flex-1 items-center justify-center gap-0.5"
          data-tauri-drag-region
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] transition-colors",
                active === t.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <HugeiconsIcon icon={t.icon} size={13} strokeWidth={1.75} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 pt-6 pb-7">
        <div className="mx-auto w-full max-w-[560px]">
          {active === "general" && <GeneralSection />}
          {active === "ai" && <AiSection />}
          {active === "connections" && <ConnectionsSection />}
          {active === "about" && <AboutSection />}
        </div>
      </main>
    </div>
  );
}
