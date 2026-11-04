import { cn } from "@/lib/utils";
import { useAgentActivityStore } from "@/modules/terminal/lib/agentActivity";
import {
  AiChat02Icon,
  FolderGitTwoIcon,
  FolderTreeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SidebarViewId } from "./types";

const SIDEBAR_RAIL_HEIGHT = 36;

type RailItem = {
  id: SidebarViewId;
  label: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  badge?: number;
  /** Badge drawn in the attention colour: something is waiting on the user. */
  urgent?: boolean;
};

/** Agent panes waiting on the user; one number, so the rail re-renders rarely. */
function useNeedsInputCount(): number {
  return useAgentActivityStore((s) => {
    let count = 0;
    for (const phase of Object.values(s.phases)) {
      if (phase === "attention") count += 1;
    }
    return count;
  });
}

type Props = {
  activeView: SidebarViewId;
  onSelectView: (view: SidebarViewId) => void;
  changedCount: number;
};

export function SidebarRail({ activeView, onSelectView, changedCount }: Props) {
  const needsInput = useNeedsInputCount();
  const items: RailItem[] = [
    { id: "explorer", label: "Files", icon: FolderTreeIcon },
    {
      id: "source-control",
      label: "Git",
      icon: FolderGitTwoIcon,
      badge: changedCount,
    },
    {
      id: "sessions",
      label: "Agents",
      icon: AiChat02Icon,
      badge: needsInput,
      urgent: true,
    },
  ];

  return (
    <div
      style={{ height: SIDEBAR_RAIL_HEIGHT }}
      className="flex shrink-0 items-stretch gap-1 border-t border-border/60 bg-foreground/[0.025] px-1.5 py-1"
    >
      {items.map((item) => {
        const isActive = item.id === activeView;
        const showBadge = !!item.badge && item.badge > 0;
        return (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            aria-pressed={isActive}
            onClick={() => onSelectView(item.id)}
            className={cn(
              "group relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[11px] font-medium outline-none transition-colors duration-[var(--dur-base)]",
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
              className="shrink-0 transition-[stroke-width] duration-[var(--dur-base)]"
            />
            <span>{item.label}</span>
            {showBadge ? (
              <span
                className={cn(
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-full border px-1 text-[9px] font-semibold leading-none tabular-nums",
                  item.urgent
                    ? "border-transparent bg-agent-attention text-background"
                    : "border-border/60 bg-card text-muted-foreground/95",
                )}
              >
                {item.badge! > 99 ? "99+" : item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
