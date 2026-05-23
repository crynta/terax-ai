export type SidebarViewId =
  | "explorer"
  | "source-control"
  | "tabs"
  | "search"
  | "outline"
  | "recent";

export type SidebarPanelPrefKey =
  | "sidebarPanelExplorer"
  | "sidebarPanelSourceControl"
  | "sidebarPanelTabs"
  | "sidebarPanelSearch"
  | "sidebarPanelOutline"
  | "sidebarPanelRecent";

export type SidebarPanelMeta = {
  id: SidebarViewId;
  label: string;
  prefKey: SidebarPanelPrefKey;
};

export const SIDEBAR_PANEL_META: readonly SidebarPanelMeta[] = [
  { id: "explorer", label: "Files", prefKey: "sidebarPanelExplorer" },
  { id: "source-control", label: "Source Control", prefKey: "sidebarPanelSourceControl" },
  { id: "tabs", label: "Tabs", prefKey: "sidebarPanelTabs" },
  { id: "search", label: "Search", prefKey: "sidebarPanelSearch" },
  { id: "outline", label: "Outline", prefKey: "sidebarPanelOutline" },
  { id: "recent", label: "Recent", prefKey: "sidebarPanelRecent" },
];

export const SIDEBAR_VIEW_IDS: readonly SidebarViewId[] =
  SIDEBAR_PANEL_META.map((m) => m.id);
