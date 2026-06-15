import { cn } from "@/lib/utils";
import type { SpaceMeta } from "./lib/store";
import { accentFor, spaceInitial } from "./lib/spaceColor";

type Size = "sm" | "md";

const SIZES: Record<Size, string> = {
  sm: "size-5 rounded-[5px] text-[10px]",
  md: "size-7 rounded-md text-[12px]",
};

type Props = {
  space: Pick<SpaceMeta, "name" | "color">;
  size?: Size;
  active?: boolean;
  className?: string;
};

export function SpaceAvatar({ space, size = "sm", active, className }: Props) {
  const accent = accentFor(space);
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center font-semibold leading-none ring-1 ring-inset",
        SIZES[size],
        active ? "ring-transparent" : "ring-border/50 text-muted-foreground",
        className,
      )}
      style={
        active
          ? {
              color: accent,
              backgroundColor: `color-mix(in oklch, ${accent} 16%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${accent} 35%, transparent)`,
            }
          : undefined
      }
    >
      {spaceInitial(space.name)}
    </span>
  );
}
