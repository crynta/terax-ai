import type { ComponentProps } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export function SidebarPanelFrame({
  className,
  ...props
}: ComponentProps<"aside">) {
  return (
    <aside
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card/80 backdrop-blur [contain:layout_style]",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarPanelBody({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarPanelScrollRegion({
  className,
  viewportClassName,
  ...props
}: ComponentProps<typeof ScrollArea>) {
  return (
    <ScrollArea
      className={cn("min-h-0 min-w-0 overscroll-contain", className)}
      viewportClassName={cn(
        "overflow-x-hidden overscroll-contain",
        viewportClassName,
      )}
      {...props}
    />
  );
}
