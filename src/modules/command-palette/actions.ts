import type { SearchTarget } from "@/modules/header";
import type { ShortcutId } from "@/modules/shortcuts";
import type { Tab } from "@/modules/tabs";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  FileEditIcon,
  Globe02Icon,
  KeyboardIcon,
  Search01Icon,
  Settings01Icon,
  SidebarLeftIcon,
  SparklesIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";

type CommandIcon = typeof TerminalIcon;

export type CommandPaletteActionGroup =
  | "General"
  | "Tabs"
  | "View"
  | "Search"
  | "AI";

export type CommandPaletteAction = {
  id: string;
  label: string;
  group: CommandPaletteActionGroup;
  keywords: string[];
  icon: CommandIcon;
  shortcutId?: ShortcutId;
  disabledReason?: string;
  run: () => void;
  deferRun?: boolean;
};

export const COMMAND_PALETTE_ACTION_GROUPS: readonly CommandPaletteActionGroup[] =
  ["General", "Tabs", "View", "Search", "AI"] as const;

export type CommandPaletteActionContext = {
  tabs: Tab[];
  activeId: number;
  searchTarget: SearchTarget;
  explorerRoot: string | null;
  home: string | null;
  openNewTab: () => void;
  openNewEditor: () => void;
  openNewPreview: () => void;
  closeActiveTab: () => void;
  nextTab: () => void;
  previousTab: () => void;
  focusSearch: () => void;
  toggleSidebar: () => void;
  toggleAi: () => void;
  openSettings: () => void;
  openShortcuts: () => void;
};

export function createCommandPaletteActions(
  ctx: CommandPaletteActionContext,
): CommandPaletteAction[] {
  const onlyOneTab = ctx.tabs.length < 2;
  const noWorkspaceRoot = !ctx.explorerRoot && !ctx.home;

  return [
    {
      id: "settings.open",
      label: "Open settings",
      group: "General",
      keywords: ["preferences", "config"],
      icon: Settings01Icon,
      shortcutId: "settings.open",
      run: ctx.openSettings,
      deferRun: true,
    },
    {
      id: "shortcuts.open",
      label: "Show keyboard shortcuts",
      group: "General",
      keywords: ["keys", "keybindings", "help"],
      icon: KeyboardIcon,
      shortcutId: "shortcuts.open",
      run: ctx.openShortcuts,
      deferRun: true,
    },
    {
      id: "tab.new",
      label: "New terminal",
      group: "Tabs",
      keywords: ["shell", "terminal", "new tab"],
      icon: TerminalIcon,
      shortcutId: "tab.new",
      run: ctx.openNewTab,
    },
    {
      id: "tab.newEditor",
      label: "New editor tab",
      group: "Tabs",
      keywords: ["file", "editor", "create"],
      icon: FileEditIcon,
      shortcutId: "tab.newEditor",
      disabledReason: noWorkspaceRoot ? "No workspace root" : undefined,
      run: ctx.openNewEditor,
      deferRun: true,
    },
    {
      id: "tab.newPreview",
      label: "New preview tab",
      group: "Tabs",
      keywords: ["browser", "web", "localhost"],
      icon: Globe02Icon,
      shortcutId: "tab.newPreview",
      run: ctx.openNewPreview,
    },
    {
      id: "tab.close",
      label: "Close current tab",
      group: "Tabs",
      keywords: ["close", "remove"],
      icon: Cancel01Icon,
      shortcutId: "tab.close",
      disabledReason: onlyOneTab ? "Last tab" : undefined,
      run: ctx.closeActiveTab,
    },
    {
      id: "tab.next",
      label: "Next tab",
      group: "Tabs",
      keywords: ["switch", "right"],
      icon: ArrowRight01Icon,
      shortcutId: "tab.next",
      disabledReason: onlyOneTab ? "Only one tab" : undefined,
      run: ctx.nextTab,
    },
    {
      id: "tab.prev",
      label: "Previous tab",
      group: "Tabs",
      keywords: ["switch", "left"],
      icon: ArrowLeft01Icon,
      shortcutId: "tab.prev",
      disabledReason: onlyOneTab ? "Only one tab" : undefined,
      run: ctx.previousTab,
    },
    {
      id: "sidebar.toggle",
      label: "Toggle file explorer",
      group: "View",
      keywords: ["sidebar", "files", "explorer"],
      icon: SidebarLeftIcon,
      shortcutId: "sidebar.toggle",
      run: ctx.toggleSidebar,
    },
    {
      id: "search.focus",
      label: "Focus search",
      group: "Search",
      keywords: ["find", "terminal", "editor"],
      icon: Search01Icon,
      shortcutId: "search.focus",
      disabledReason: ctx.searchTarget ? undefined : "No searchable view",
      run: ctx.focusSearch,
      deferRun: true,
    },
    {
      id: "ai.toggle",
      label: "Toggle AI agent",
      group: "AI",
      keywords: ["assistant", "chat", "agent"],
      icon: SparklesIcon,
      shortcutId: "ai.toggle",
      run: ctx.toggleAi,
    },
  ];
}
