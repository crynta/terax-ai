import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setSidebarPanelExplorer,
  setSidebarPanelOutline,
  setSidebarPanelRecent,
  setSidebarPanelSearch,
  setSidebarPanelSourceControl,
  setSidebarPanelTabs,
} from "@/modules/settings/store";
import type { SidebarPanelPrefKey } from "@/modules/sidebar";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

type PanelDef = {
  title: string;
  description: string;
  prefKey: SidebarPanelPrefKey;
  setter: (v: boolean) => Promise<void>;
};

const PANELS: PanelDef[] = [
  {
    title: "Files",
    description: "File tree and project explorer.",
    prefKey: "sidebarPanelExplorer",
    setter: setSidebarPanelExplorer,
  },
  {
    title: "Source Control",
    description: "Git status, stage changes, and commit.",
    prefKey: "sidebarPanelSourceControl",
    setter: setSidebarPanelSourceControl,
  },
  {
    title: "Tabs",
    description: "Vertical tab list. Hides the top tab bar while enabled.",
    prefKey: "sidebarPanelTabs",
    setter: setSidebarPanelTabs,
  },
  {
    title: "Search",
    description: "Find in files across the workspace.",
    prefKey: "sidebarPanelSearch",
    setter: setSidebarPanelSearch,
  },
  {
    title: "Outline",
    description: "Symbol tree for the active editor file (functions, classes, headings).",
    prefKey: "sidebarPanelOutline",
    setter: setSidebarPanelOutline,
  },
  {
    title: "Recent Files",
    description: "Quick access to recently opened files.",
    prefKey: "sidebarPanelRecent",
    setter: setSidebarPanelRecent,
  },
];

export function PanelSection() {
  const sidebarPanelExplorer = usePreferencesStore((s) => s.sidebarPanelExplorer);
  const sidebarPanelSourceControl = usePreferencesStore((s) => s.sidebarPanelSourceControl);
  const sidebarPanelTabs = usePreferencesStore((s) => s.sidebarPanelTabs);
  const sidebarPanelSearch = usePreferencesStore((s) => s.sidebarPanelSearch);
  const sidebarPanelOutline = usePreferencesStore((s) => s.sidebarPanelOutline);
  const sidebarPanelRecent = usePreferencesStore((s) => s.sidebarPanelRecent);

  const prefs = {
    sidebarPanelExplorer,
    sidebarPanelSourceControl,
    sidebarPanelTabs,
    sidebarPanelSearch,
    sidebarPanelOutline,
    sidebarPanelRecent,
  };

  const enabledCount = Object.values(prefs).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Panel"
        description="Choose which tools appear in the sidebar."
      />
      <TooltipProvider delayDuration={400}>
        <div className="flex flex-col gap-2">
          {PANELS.map((panel) => {
            const isEnabled = prefs[panel.prefKey];
            const isLastEnabled = enabledCount === 1 && isEnabled;
            return (
              <Tooltip key={panel.prefKey} open={isLastEnabled ? undefined : false}>
                <TooltipTrigger asChild>
                  <div>
                    <SettingRow title={panel.title} description={panel.description}>
                      <Switch
                        checked={isEnabled}
                        disabled={isLastEnabled}
                        onCheckedChange={(v) => void panel.setter(v)}
                      />
                    </SettingRow>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-[11px]">
                  At least one panel must remain enabled.
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    </div>
  );
}
