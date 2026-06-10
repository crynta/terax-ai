import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

export type PiSectionShellProps = {
  collapsed: boolean;
  disabled: boolean;
  refreshing: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

type PiSectionProps = {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  summary?: ReactNode;
};

export function PiSection({
  title,
  collapsed,
  onCollapsedChange,
  actions,
  children,
  className,
  contentClassName,
  summary,
}: PiSectionProps) {
  const contentId = useId();

  return (
    <section
      className={cn("shrink-0 border-b border-border/35 bg-card/45", className)}
    >
      <div className="flex h-8 shrink-0 items-center gap-1.5 px-2.5">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={contentId}
          className="group -ml-1 flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-left outline-none transition-colors duration-150 hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-primary/30"
          onClick={() => onCollapsedChange(!collapsed)}
        >
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={11}
            strokeWidth={2}
            className={cn(
              "shrink-0 text-muted-foreground transition-transform duration-150",
              !collapsed && "rotate-90",
            )}
          />
          <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/85">
            {title}
          </span>
          {summary ? (
            <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/65">
              {summary}
            </span>
          ) : (
            <span className="flex-1" />
          )}
        </button>
        {actions ? (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {actions}
          </div>
        ) : null}
      </div>
      {!collapsed ? (
        <div id={contentId} className={contentClassName}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
