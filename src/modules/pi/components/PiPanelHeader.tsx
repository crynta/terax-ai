import AiChat02Icon from "@hugeicons/core-free-icons/AiChat02Icon";
import MenuCollapseIcon from "@hugeicons/core-free-icons/MenuCollapseIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { statusToneDotClass } from "@/modules/pi/components/classes";
import type { PiStatusView } from "@/modules/pi/lib/status";

type PiPanelHeaderProps = {
  status: PiStatusView;
  supportingSectionsHidden: boolean;
  supportingSectionsToggleLabel: string;
  surfaceLabel: string;
  onSupportingSectionsHiddenChange: (
    updater: (current: boolean) => boolean,
  ) => void;
};

export function PiPanelHeader({
  status,
  supportingSectionsHidden,
  supportingSectionsToggleLabel,
  surfaceLabel,
  onSupportingSectionsHiddenChange,
}: PiPanelHeaderProps) {
  return (
    <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-2">
      <div className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-foreground/5 px-2 py-1 text-[11.5px] font-medium leading-none text-foreground">
        <HugeiconsIcon
          icon={AiChat02Icon}
          size={12}
          strokeWidth={1.9}
          className="shrink-0 text-muted-foreground"
        />
        <span className="truncate">{surfaceLabel}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Badge
          variant="outline"
          className="h-5 gap-1 rounded-md border-border/55 px-1.5 text-[10.5px] text-muted-foreground"
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              statusToneDotClass(status.tone),
            )}
          />
          {status.label}
        </Badge>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={supportingSectionsToggleLabel}
          aria-pressed={supportingSectionsHidden}
          title={supportingSectionsToggleLabel}
          onClick={() =>
            onSupportingSectionsHiddenChange((current) => !current)
          }
          className="size-5 rounded-md text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon
            data-icon="inline-start"
            icon={MenuCollapseIcon}
            strokeWidth={1.8}
            className={cn(
              "transition-transform duration-150",
              supportingSectionsHidden && "rotate-180",
            )}
          />
        </Button>
      </div>
    </header>
  );
}
