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

// All tones render monochrome (color next to the terminal reads as noise);
// the tone prop stays so call sites keep their semantics.
type Tone = { box: string; icon: string };

const BOX = "border-border/40 bg-foreground/[0.03] text-foreground/75";
const TONE: Tone = { box: BOX, icon: "text-foreground/60" };

const TONES: Record<ChipTone, Tone> = {
  neutral: TONE,
  blue: TONE,
  violet: TONE,
  emerald: TONE,
  sky: TONE,
  amber: TONE,
  primary: TONE,
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
  children?: ReactNode;
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
        "group inline-flex h-6 items-center gap-1.5 rounded-md border text-[11.5px] leading-none",
        children ? "px-2.5" : "px-2",
        "animate-in fade-in-0 zoom-in-95 duration-[calc(150ms*var(--terax-anim,1))]",
        !onRemove && "pointer-events-none select-none",
        TONES[tone].box,
      )}
    >
      {iconNode ??
        (icon && (
          <HugeiconsIcon
            icon={icon}
            size={12}
            strokeWidth={1.75}
            className={cn("shrink-0", TONES[tone].icon)}
          />
        ))}
      {label && <span className="opacity-55">{label}</span>}
      {children != null && (
        <span className="max-w-[12rem] truncate font-medium">{children}</span>
      )}
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
