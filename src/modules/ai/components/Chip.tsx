import { cn } from "@/lib/utils";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";

export type ChipTone =
  | "neutral"
  | "blue"
  | "violet"
  | "emerald"
  | "sky"
  | "amber"
  | "primary";

// Catppuccin-soft tones: normal text, a barely-there tinted background, and the
// accent carried by the icon (theme-adaptive: deeper in light, pastel in dark).
type Tone = { box: string; icon: string };

const TONES: Record<ChipTone, Tone> = {
  neutral: {
    box: "border-border/45 bg-foreground/[0.03] text-muted-foreground",
    icon: "text-muted-foreground",
  },
  blue: {
    box: "border-border/40 bg-blue-400/5 text-foreground/80",
    icon: "text-blue-500 dark:text-blue-300",
  },
  violet: {
    box: "border-border/40 bg-violet-400/5 text-foreground/80",
    icon: "text-violet-500 dark:text-violet-300",
  },
  emerald: {
    box: "border-border/40 bg-emerald-400/5 text-foreground/80",
    icon: "text-emerald-500 dark:text-emerald-300",
  },
  sky: {
    box: "border-border/40 bg-cyan-400/5 text-foreground/80",
    icon: "text-cyan-500 dark:text-cyan-300",
  },
  amber: {
    box: "border-border/40 bg-amber-400/5 text-foreground/80",
    icon: "text-amber-500 dark:text-amber-300",
  },
  primary: {
    box: "border-border/40 bg-primary/[0.05] text-foreground/80",
    icon: "text-primary",
  },
};

type Props = {
  tone?: ChipTone;
  icon?: typeof Cancel01Icon;
  iconNode?: ReactNode;
  /** Dimmed prefix before the value (e.g. "on" before a branch). */
  label?: string;
  title?: string;
  onRemove?: () => void;
  removeLabel?: string;
  children: ReactNode;
};

export function Chip({
  tone = "neutral",
  icon,
  iconNode,
  label,
  title,
  onRemove,
  removeLabel = "Remove",
  children,
}: Props) {
  return (
    <div
      title={title}
      className={cn(
        "group inline-flex h-[22px] items-center gap-1.5 rounded-md border px-2 text-[11px] leading-none",
        "animate-in fade-in-0 zoom-in-95 duration-150",
        !onRemove && "pointer-events-none select-none",
        TONES[tone].box,
      )}
    >
      {iconNode ??
        (icon && (
          <HugeiconsIcon
            icon={icon}
            size={11}
            strokeWidth={1.75}
            className={cn("shrink-0", TONES[tone].icon)}
          />
        ))}
      {label && <span className="opacity-55">{label}</span>}
      <span className="max-w-[12rem] truncate font-medium">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-mr-0.5 ml-0.5 grid size-3.5 shrink-0 place-items-center rounded-sm opacity-0 transition-opacity hover:!opacity-100 group-hover:opacity-60"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
