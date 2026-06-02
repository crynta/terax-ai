import type { SearchTarget } from "@/modules/header";
import type { ShortcutId } from "@/modules/shortcuts";
import { MAX_PANES_PER_TAB, type Tab } from "@/modules/tabs";
import { leafIds } from "@/modules/terminal";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  FileEditIcon,
  Globe02Icon,
  IncognitoIcon,
  KeyboardIcon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
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
  | "Panes"
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
  ["General", "Tabs", "Panes", "View", "Search", "AI"] as const;

export type CommandPaletteActionContext = {
  tabs: Tab[];
  activeId: number;
  searchTarget: SearchTarget;
  explorerRoot: string | null;
  home: string | null;
  openNewTab: () => void;
  openNewPrivate: () => void;
  openNewEditor: () => void;
  openNewPreview: () => void;
  closeActiveTabOrPane: () => void;
  nextTab: () => void;
  previousTab: () => void;
  splitPaneRight: () => void;
  splitPaneDown: () => void;
  focusNextPane: () => void;
  focusPreviousPane: () => void;
  focusSearch: () => void;
  focusExplorerSearch: () => void;
  toggleSidebar: () => void;
  toggleAi: () => void;
  askAiSelection: () => void;
  openSettings: () => void;
  openShortcuts: () => void;
};

export function createCommandPaletteActions(
  ctx: CommandPaletteActionContext,
): CommandPaletteAction[] {
  const activeTab = ctx.tabs.find((tab) => tab.id === ctx.activeId);
  const activeTerminalTab =
    activeTab?.kind === "terminal" ? activeTab : null;
  const activePaneCount = activeTerminalTab
    ? leafIds(activeTerminalTab.paneTree).length
    : 0;
  const onlyOneTab = ctx.tabs.length < 2;
  const noWorkspaceRoot = !ctx.explorerRoot && !ctx.home;
  const splitPaneDisabledReason = !activeTerminalTab
    ? "No terminal tab"
    : activePaneCount >= MAX_PANES_PER_TAB
      ? "Pane limit"
      : undefined;
  const focusPaneDisabledReason = !activeTerminalTab
    ? "No terminal tab"
    : activePaneCount < 2
      ? "Only one pane"
      : undefined;
  const closeDisabledReason =
    onlyOneTab && activePaneCount < 2 ? "Last tab" : undefined;

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
      id: "tab.newPrivate",
      label: "New private terminal",
      group: "Tabs",
      keywords: ["privacy", "private", "incognito", "hidden from ai"],
      icon: IncognitoIcon,
      shortcutId: "tab.newPrivate",
      run: ctx.openNewPrivate,
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
      label: "Close tab or pane",
      group: "Tabs",
      keywords: ["close", "remove", "pane"],
      icon: Cancel01Icon,
      shortcutId: "tab.close",
      disabledReason: closeDisabledReason,
      run: ctx.closeActiveTabOrPane,
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
      id: "pane.splitRight",
      label: "Split pane right",
      group: "Panes",
      keywords: ["terminal", "pane", "split", "right", "column"],
      icon: LayoutTwoColumnIcon,
      shortcutId: "pane.splitRight",
      disabledReason: splitPaneDisabledReason,
      run: ctx.splitPaneRight,
    },
    {
      id: "pane.splitDown",
      label: "Split pane down",
      group: "Panes",
      keywords: ["terminal", "pane", "split", "down", "row"],
      icon: LayoutTwoRowIcon,
      shortcutId: "pane.splitDown",
      disabledReason: splitPaneDisabledReason,
      run: ctx.splitPaneDown,
    },
    {
      id: "pane.focusNext",
      label: "Focus next pane",
      group: "Panes",
      keywords: ["terminal", "pane", "focus", "next"],
      icon: ArrowRight01Icon,
      shortcutId: "pane.focusNext",
      disabledReason: focusPaneDisabledReason,
      run: ctx.focusNextPane,
    },
    {
      id: "pane.focusPrev",
      label: "Focus previous pane",
      group: "Panes",
      keywords: ["terminal", "pane", "focus", "previous"],
      icon: ArrowLeft01Icon,
      shortcutId: "pane.focusPrev",
      disabledReason: focusPaneDisabledReason,
      run: ctx.focusPreviousPane,
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
      id: "explorer.search",
      label: "Search files",
      group: "Search",
      keywords: ["explorer", "workspace", "file search"],
      icon: Search01Icon,
      shortcutId: "explorer.search",
      disabledReason: ctx.explorerRoot ? undefined : "No workspace root",
      run: ctx.focusExplorerSearch,
      deferRun: true,
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
    {
      id: "ai.askSelection",
      label: "Ask AI about selection",
      group: "AI",
      keywords: ["selection", "explain", "assistant", "chat"],
      icon: SparklesIcon,
      shortcutId: "ai.askSelection",
      run: ctx.askAiSelection,
    },
  ];
}
