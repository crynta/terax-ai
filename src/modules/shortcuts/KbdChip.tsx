import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** The one keybinding-chip style: hover reveals, search fields, toasts. */
export function KbdChip({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <kbd
      className={cn(
        "rounded border border-border/50 bg-card px-1 py-px font-sans text-[10px] font-medium leading-none whitespace-nowrap text-muted-foreground select-none",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
