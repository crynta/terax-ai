export {
  PRIMARY_SIDEBAR_VIEW_ITEMS,
  type PrimarySidebarViewId,
  SECONDARY_SIDEBAR_VIEW_ITEMS,
  type SecondarySidebarViewId,
  SIDEBAR_VIEW_ITEMS,
  type SidebarViewId,
  type SidebarViewItem,
} from "./registry";

import type {
  PrimarySidebarViewId,
  SecondarySidebarViewId,
  SidebarViewId,
} from "./registry";
import {
  PRIMARY_SIDEBAR_VIEW_ITEMS,
  SECONDARY_SIDEBAR_VIEW_ITEMS,
} from "./registry";

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
