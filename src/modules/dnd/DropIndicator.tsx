import { cn } from "@/lib/utils";

export type Edge = "top" | "bottom" | "left" | "right";

/** Thin accent line marking where a dragged item will land. Pure CSS. */
export function DropIndicator({ edge }: { edge: Edge }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-10 rounded-full bg-primary",
        edge === "top" && "inset-x-1 top-0 h-0.5 -translate-y-1/2",
        edge === "bottom" && "inset-x-1 bottom-0 h-0.5 translate-y-1/2",
        edge === "left" && "inset-y-1 left-0 w-0.5 -translate-x-1/2",
        edge === "right" && "inset-y-1 right-0 w-0.5 translate-x-1/2",
      )}
    />
  );
}
