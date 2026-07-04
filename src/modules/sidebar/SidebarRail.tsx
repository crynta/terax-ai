import { cn } from "@/lib/utils";
import type { ShortcutId } from "@/modules/shortcuts/shortcuts";
import { useShortcutText } from "@/modules/shortcuts/useShortcutText";
import { FolderGitTwoIcon, FolderTreeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SidebarViewId } from "./types";

export const SIDEBAR_RAIL_HEIGHT = 42;

type RailItem = {
  id: SidebarViewId;
  label: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  shortcutId: ShortcutId;
  badge?: number;
};

type Props = {
  activeView: SidebarViewId;
  onSelectView: (view: SidebarViewId) => void;
  changedCount: number;
};

export function SidebarRail({ activeView, onSelectView, changedCount }: Props) {
  const items: RailItem[] = [
    {
      id: "explorer",
      label: "Files",
      icon: FolderTreeIcon,
      shortcutId: "explorer.focus",
    },
    {
      id: "source-control",
      label: "Source Control",
      icon: FolderGitTwoIcon,
      shortcutId: "pane.source",
      badge: changedCount,
    },
  ];

  return (
    <div
      style={{ height: SIDEBAR_RAIL_HEIGHT }}
      className="flex shrink-0 items-stretch gap-1.5 border-t border-border/60 bg-card/85 px-2 py-1.5 backdrop-blur"
    >
      {items.map((item) => (
        <RailButton
          key={item.id}
          item={item}
          isActive={item.id === activeView}
          onClick={() => onSelectView(item.id)}
        />
      ))}
    </div>
  );
}

function RailButton({
  item,
  isActive,
  onClick,
}: {
  item: RailItem;
  isActive: boolean;
  onClick: () => void;
}) {
  const shortcutText = useShortcutText(item.shortcutId);
  const showBadge = !!item.badge && item.badge > 0;
  return (
    <button
      type="button"
      aria-label={item.label}
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        "group relative flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium outline-none transition-[color,background-color,padding] duration-[var(--dur-base)]",
        "focus-visible:ring-2 focus-visible:ring-primary/40",
        // Reserve room for the right-pinned keybinding chip whenever it can
        // be visible, so a truncated label never runs underneath it.
        "hover:pr-10",
        isActive
          ? "bg-foreground/[0.07] pr-10 text-foreground dark:bg-foreground/[0.09]"
          : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground",
      )}
    >
      <HugeiconsIcon
        icon={item.icon}
        size={14}
        strokeWidth={isActive ? 2 : 1.75}
        className="shrink-0 transition-[stroke-width] duration-[var(--dur-base)]"
      />
      <span className="truncate whitespace-nowrap">{item.label}</span>
      {showBadge && item.badge ? (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/60 bg-card px-1 text-[9px] font-semibold leading-none tabular-nums text-muted-foreground/95">
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      ) : null}
      {shortcutText && (
        <span
          className={cn(
            // Pinned to the button's right edge so the centered label never
            // shifts and the chip doesn't crowd the text.
            "absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity duration-[calc(250ms*var(--terax-anim,1))] ease-out group-hover:opacity-100",
            // Active view keeps its keybinding visible, not just on hover.
            isActive && "opacity-100",
          )}
        >
          <kbd className="rounded border border-border/50 bg-card px-1 py-px font-sans text-[10px] font-medium leading-none whitespace-nowrap text-muted-foreground select-none">
            {shortcutText}
          </kbd>
        </span>
      )}
    </button>
  );
}
