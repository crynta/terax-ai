import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ArrowTurnBackwardIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Props = {
  title: ReactNode;
  description?: string;
  children: React.ReactNode;
  className?: string;
  onReset?: () => void;
};

export function SettingRow({
  title,
  description,
  children,
  className,
  onReset,
}: Props) {
  return (
    <div
      className={cn(
        "group flex items-center justify-between px-3 py-2.5 transition-colors hover:bg-muted/30",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[12.5px] font-medium">{title}</span>
          {onReset && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5 text-muted-foreground/50 hover:text-foreground"
                    onClick={onReset}
                  >
                    <HugeiconsIcon
                      icon={ArrowTurnBackwardIcon}
                      size={12}
                      strokeWidth={2}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[10px] px-2 py-1">
                  Reset to default
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        {description ? (
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}
