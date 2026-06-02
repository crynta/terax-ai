export const SIDEBAR_VIEW_ITEMS = [
  { id: "explorer", label: "Files" },
  { id: "source-control", label: "Git" },
  { id: "pi", label: "Pi" },
] as const;

export type SidebarViewId = (typeof SIDEBAR_VIEW_ITEMS)[number]["id"];

export function isSidebarViewId(
  value: string | null | undefined,
): value is SidebarViewId {
  return SIDEBAR_VIEW_ITEMS.some((item) => item.id === value);
}
