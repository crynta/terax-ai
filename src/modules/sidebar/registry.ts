import ChatIcon from "@hugeicons/core-free-icons/ChatIcon";
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon";
import FlashIcon from "@hugeicons/core-free-icons/FlashIcon";
import FolderGitTwoIcon from "@hugeicons/core-free-icons/FolderGitTwoIcon";
import FolderTreeIcon from "@hugeicons/core-free-icons/FolderTreeIcon";
import GitCompareIcon from "@hugeicons/core-free-icons/GitCompareIcon";
import InboxIcon from "@hugeicons/core-free-icons/InboxIcon";
import Timer02Icon from "@hugeicons/core-free-icons/Timer02Icon";
import UserCircleIcon from "@hugeicons/core-free-icons/UserCircleIcon";
import type { HugeiconsIcon } from "@hugeicons/react";

export type SidebarViewSlot = "primary" | "secondary";

type SidebarIcon = Parameters<typeof HugeiconsIcon>[0]["icon"];

export type SidebarViewItem<T extends SidebarViewId = SidebarViewId> = {
  id: T;
  label: string;
};

export type SidebarViewMetadata<T extends SidebarViewId = SidebarViewId> = {
  id: T;
  label: string;
  slot: SidebarViewSlot;
  icon: SidebarIcon;
};

export const SIDEBAR_VIEW_REGISTRY = {
  explorer: {
    id: "explorer",
    label: "Files",
    slot: "primary",
    icon: FolderTreeIcon,
  },
  "source-control": {
    id: "source-control",
    label: "Git",
    slot: "primary",
    icon: FolderGitTwoIcon,
  },
  automation: {
    id: "automation",
    label: "Automation",
    slot: "primary",
    icon: Timer02Icon,
  },
  "agent-manager": {
    id: "agent-manager",
    label: "Agents",
    slot: "primary",
    icon: UserCircleIcon,
  },
  "skill-browser": {
    id: "skill-browser",
    label: "Skills",
    slot: "primary",
    icon: FlashIcon,
  },
  code: {
    id: "code",
    label: "Code",
    slot: "secondary",
    icon: CodeIcon,
  },
  chat: {
    id: "chat",
    label: "Chat",
    slot: "secondary",
    icon: ChatIcon,
  },
  compare: {
    id: "compare",
    label: "Compare",
    slot: "secondary",
    icon: GitCompareIcon,
  },
  inbox: {
    id: "inbox",
    label: "Inbox",
    slot: "secondary",
    icon: InboxIcon,
  },
} as const;

export type SidebarViewId = keyof typeof SIDEBAR_VIEW_REGISTRY;
export type PrimarySidebarViewId = ViewIdForSlot<"primary">;
export type SecondarySidebarViewId = ViewIdForSlot<"secondary">;

type ViewIdForSlot<TSlot extends SidebarViewSlot> = {
  [TId in SidebarViewId]: (typeof SIDEBAR_VIEW_REGISTRY)[TId]["slot"] extends TSlot
    ? TId
    : never;
}[SidebarViewId];

function sidebarItemForId<T extends SidebarViewId>(id: T): SidebarViewItem<T> {
  return {
    id,
    label: SIDEBAR_VIEW_REGISTRY[id].label,
  };
}

export const PRIMARY_SIDEBAR_VIEW_ITEMS = [
  sidebarItemForId("explorer"),
  sidebarItemForId("source-control"),
  sidebarItemForId("automation"),
  sidebarItemForId("agent-manager"),
  sidebarItemForId("skill-browser"),
] as const satisfies readonly SidebarViewItem<PrimarySidebarViewId>[];

export const SECONDARY_SIDEBAR_VIEW_ITEMS = [
  sidebarItemForId("code"),
  sidebarItemForId("chat"),
  sidebarItemForId("compare"),
  sidebarItemForId("inbox"),
] as const satisfies readonly SidebarViewItem<SecondarySidebarViewId>[];

export const SIDEBAR_VIEW_ITEMS = [
  ...PRIMARY_SIDEBAR_VIEW_ITEMS,
  ...SECONDARY_SIDEBAR_VIEW_ITEMS,
] as const satisfies readonly SidebarViewItem<SidebarViewId>[];

export function sidebarViewItemsForSlot<TSlot extends SidebarViewSlot>(
  slot: TSlot,
): TSlot extends "primary"
  ? typeof PRIMARY_SIDEBAR_VIEW_ITEMS
  : typeof SECONDARY_SIDEBAR_VIEW_ITEMS {
  return (
    slot === "primary"
      ? PRIMARY_SIDEBAR_VIEW_ITEMS
      : SECONDARY_SIDEBAR_VIEW_ITEMS
  ) as TSlot extends "primary"
    ? typeof PRIMARY_SIDEBAR_VIEW_ITEMS
    : typeof SECONDARY_SIDEBAR_VIEW_ITEMS;
}

export function sidebarViewMetadataForId<T extends SidebarViewId>(
  id: T,
): SidebarViewMetadata<T> {
  return SIDEBAR_VIEW_REGISTRY[id] as SidebarViewMetadata<T>;
}
