import {
  ChatIcon,
  CodeIcon,
  FolderGitTwoIcon,
  FolderTreeIcon,
  InboxIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import type { SidebarViewId, SidebarViewItem } from "./types";

export const SIDEBAR_RAIL_HEIGHT = 36;

type RailItem<T extends SidebarViewId = SidebarViewId> = SidebarViewItem<T> & {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
};

type Props<T extends SidebarViewId> = {
  activeView: T;
  items: readonly SidebarViewItem<T>[];
  onSelectView: (view: T) => void;
  badges?: Partial<Record<T, number>>;
};

const sidebarViewIcons: Record<SidebarViewId, RailItem["icon"]> = {
  explorer: FolderTreeIcon,
  "source-control": FolderGitTwoIcon,
  code: CodeIcon,
  chat: ChatIcon,
  inbox: InboxIcon,
};

function formatBadge(view: SidebarViewId, badge: number): string | number {
  if (view === "code" && badge > 9) return "9+";
  return badge > 99 ? "99+" : badge;
}

export function SidebarRail<T extends SidebarViewId>({
  activeView,
  items,
  onSelectView,
  badges = {},
}: Props<T>) {
  const railItems: RailItem<T>[] = items.map((item) => ({
    ...item,
    icon: sidebarViewIcons[item.id],
  }));

  return (
    <div
      style={{ height: SIDEBAR_RAIL_HEIGHT }}
      className="flex shrink-0 items-stretch gap-1 border-t border-border/60 bg-card/85 px-1.5 py-1 backdrop-blur"
    >
      {railItems.map((item) => {
        const isActive = item.id === activeView;
        const badge = badges[item.id] ?? 0;
        const showBadge = badge > 0;
        return (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            aria-pressed={isActive}
            onClick={() => onSelectView(item.id)}
            className={cn(
              "group relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[11px] font-medium outline-none transition-colors duration-150",
              "focus-visible:ring-2 focus-visible:ring-primary/40",
              isActive
                ? "bg-foreground/[0.07] text-foreground dark:bg-foreground/[0.09]"
                : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground",
            )}
          >
            <HugeiconsIcon
              icon={item.icon}
              size={14}
              strokeWidth={isActive ? 2 : 1.75}
              className="shrink-0 transition-[stroke-width] duration-150"
            />
            <span>{item.label}</span>
            {showBadge ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/60 bg-card px-1 text-[9px] font-semibold leading-none tabular-nums text-muted-foreground/95">
                {formatBadge(item.id, badge)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
