import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import IncognitoIcon from "@hugeicons/core-free-icons/IncognitoIcon";
import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import { PiSection } from "@/modules/pi/components/PiSection";
import type { PiContextPreviewItem } from "@/modules/pi/lib/view";

type PiContextBarProps = {
  collapsed: boolean;
  items: PiContextPreviewItem[];
  onCollapsedChange: (collapsed: boolean) => void;
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

export function PiContextBar({
  collapsed,
  items,
  onCollapsedChange,
}: PiContextBarProps) {
  return (
    <PiSection
      title="Context"
      collapsed={collapsed}
      summary="Sent with the next prompt"
      contentClassName="px-2.5 pb-2"
      onCollapsedChange={onCollapsedChange}
    >
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
    </PiSection>
  );
}
