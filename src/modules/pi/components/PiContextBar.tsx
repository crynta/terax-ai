import {
  File01Icon,
  Folder01Icon,
  IncognitoIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import type { PiContextPreviewItem } from "@/modules/pi/lib/view";

type PiContextBarProps = {
  items: PiContextPreviewItem[];
};

const contextIcons: Record<
  PiContextPreviewItem["key"],
  Parameters<typeof HugeiconsIcon>[0]["icon"]
> = {
  workspace: Folder01Icon,
  terminal: TerminalIcon,
  file: File01Icon,
  mode: IncognitoIcon,
};

export function PiContextBar({ items }: PiContextBarProps) {
  return (
    <div className="shrink-0 border-b border-border/35 bg-card/45 px-2.5 py-2">
      <div className="mb-1.5 flex min-w-0 items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/85">
          Context
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/65">
          Sent with the next prompt
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((item) => (
          <div
            key={item.key}
            title={item.detail ?? item.value}
            className={cn(
              "flex min-w-0 items-center gap-1.5 rounded-md border border-border/40 bg-background/70 px-1.5 py-1 text-[10.5px] transition-colors",
              item.missing && "text-muted-foreground/70",
              item.tone === "private" && "border-border/60 bg-muted/45",
            )}
          >
            <HugeiconsIcon
              icon={contextIcons[item.key]}
              size={11}
              strokeWidth={1.8}
              className="shrink-0 text-muted-foreground"
            />
            <span className="shrink-0 font-medium text-muted-foreground/85">
              {item.label}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-right font-medium",
                item.missing
                  ? "text-muted-foreground/65"
                  : "text-foreground/90",
              )}
            >
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
