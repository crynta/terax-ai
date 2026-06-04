export const PRIMARY_SIDEBAR_VIEW_ITEMS = [
  { id: "explorer", label: "Files" },
  { id: "source-control", label: "Git" },
] as const;

export const SECONDARY_SIDEBAR_VIEW_ITEMS = [
  { id: "code", label: "Code" },
  { id: "chat", label: "Chat" },
  { id: "inbox", label: "Inbox" },
] as const;

export const SIDEBAR_VIEW_ITEMS = [
  ...PRIMARY_SIDEBAR_VIEW_ITEMS,
  ...SECONDARY_SIDEBAR_VIEW_ITEMS,
] as const;

export type PrimarySidebarViewId =
  (typeof PRIMARY_SIDEBAR_VIEW_ITEMS)[number]["id"];
export type SecondarySidebarViewId =
  (typeof SECONDARY_SIDEBAR_VIEW_ITEMS)[number]["id"];
export type SidebarViewId = PrimarySidebarViewId | SecondarySidebarViewId;

export type SidebarViewItem<T extends SidebarViewId = SidebarViewId> = {
  id: T;
  label: string;
};

export function isPrimarySidebarViewId(
  value: string | null | undefined,
): value is PrimarySidebarViewId {
  return PRIMARY_SIDEBAR_VIEW_ITEMS.some((item) => item.id === value);
}

export function isSecondarySidebarViewId(
  value: string | null | undefined,
): value is SecondarySidebarViewId {
  return SECONDARY_SIDEBAR_VIEW_ITEMS.some((item) => item.id === value);
}

export function isSidebarViewId(
  value: string | null | undefined,
): value is SidebarViewId {
  return isPrimarySidebarViewId(value) || isSecondarySidebarViewId(value);
}

export function normalizePrimarySidebarView(
  value: string | null | undefined,
  fallback: PrimarySidebarViewId = "explorer",
): PrimarySidebarViewId {
  return isPrimarySidebarViewId(value) ? value : fallback;
}

export function normalizeSecondarySidebarView(
  value: string | null | undefined,
  fallback: SecondarySidebarViewId = "code",
): SecondarySidebarViewId {
  if (value === "pi") return "code";
  return isSecondarySidebarViewId(value) ? value : fallback;
}
