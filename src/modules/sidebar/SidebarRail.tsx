import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import { sidebarViewMetadataForId } from "./registry";
import type { SidebarViewId, SidebarViewItem } from "./types";

export const SIDEBAR_RAIL_HEIGHT = 36;

type Props<T extends SidebarViewId> = {
  activeView: T;
  items?: readonly SidebarViewItem<T>[];
  onSelectView: (view: T) => void;
  badges?: Partial<Record<T, number>>;
  changedCount?: number;
};

const DEFAULT_ITEMS = [
  { id: "explorer", label: "Files" },
  { id: "source-control", label: "Source Control" },
] as const satisfies readonly SidebarViewItem<"explorer" | "source-control">[];

function formatBadge(view: SidebarViewId, badge: number): string | number {
  if (view === "code" && badge > 9) return "9+";
  return badge > 99 ? "99+" : badge;
}

export function SidebarRail<T extends SidebarViewId>({
  activeView,
  items,
  onSelectView,
  badges,
  changedCount,
}: Props<T>) {
  const railItems = (items ?? DEFAULT_ITEMS) as readonly SidebarViewItem<T>[];
  const resolvedBadges = {
    ...(badges ?? {}),
    ...(changedCount ? { "source-control": changedCount } : {}),
  } as Partial<Record<T, number>>;

  return (
    <div
      style={{ height: SIDEBAR_RAIL_HEIGHT }}
      className="flex shrink-0 items-stretch gap-1 border-t border-border/60 bg-card/85 px-1.5 py-1 backdrop-blur"
    >
      {railItems.map((item) => {
        const isActive = item.id === activeView;
        const badge = resolvedBadges[item.id] ?? 0;
        const showBadge = badge > 0;
        const icon = sidebarViewMetadataForId(item.id).icon;
        return (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            aria-pressed={isActive}
            onClick={() => onSelectView(item.id)}
            title={item.label}
            className={cn(
              "group relative flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 overflow-hidden rounded-md px-1 text-[11px] font-medium outline-none transition-colors duration-150",
              "focus-visible:ring-2 focus-visible:ring-primary/40",
              isActive
                ? "bg-foreground/[0.07] text-foreground dark:bg-foreground/[0.09]"
                : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground",
              showBadge && "pr-4",
            )}
          >
            <HugeiconsIcon
              aria-hidden="true"
              focusable="false"
              icon={icon}
              size={14}
              strokeWidth={isActive ? 2 : 1.75}
              className="shrink-0 transition-[stroke-width] duration-150"
            />
            <span className="min-w-0 truncate">{item.label}</span>
            {showBadge ? (
              <span className="pointer-events-none absolute top-0.5 right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/60 bg-card px-1 text-[9px] font-semibold leading-none tabular-nums text-muted-foreground/95">
                {formatBadge(item.id, badge)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
