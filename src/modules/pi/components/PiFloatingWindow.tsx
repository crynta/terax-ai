import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon";
import FullscreenIcon from "@hugeicons/core-free-icons/FullscreenIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "motion/react";
import { type ReactNode, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ResizeDir } from "@/modules/ai/lib/miniWindowGeometry";
import { useMiniWindowGeometry } from "@/modules/ai/lib/useMiniWindowGeometry";

const CODE_WINDOW_GEOMETRY_KEY = "terax-code-mini-window-geom";

const RESIZE_HANDLE_CLASS: Record<ResizeDir, string> = {
  n: "top-0 left-3 right-3 h-1.5 cursor-ns-resize",
  s: "bottom-0 left-3 right-3 h-1.5 cursor-ns-resize",
  w: "top-3 bottom-3 left-0 w-1.5 cursor-ew-resize",
  e: "top-3 bottom-3 right-0 w-1.5 cursor-ew-resize",
  nw: "top-0 left-0 size-3 cursor-nwse-resize",
  ne: "top-0 right-0 size-3 cursor-nesw-resize",
  sw: "bottom-0 left-0 size-3 cursor-nesw-resize",
  se: "bottom-0 right-0 size-3 cursor-nwse-resize",
};

const RESIZE_DIRS: ResizeDir[] = ["n", "s", "w", "e", "nw", "ne", "sw", "se"];

type PiFloatingWindowProps = {
  children: ReactNode;
  onClose: () => void;
  onOpenWorkspace: () => void;
};

export function PiFloatingWindow({
  children,
  onClose,
  onOpenWorkspace,
}: PiFloatingWindowProps) {
  const { ref, onHeaderPointerDown, startResize } = useMiniWindowGeometry(
    CODE_WINDOW_GEOMETRY_KEY,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target?.closest('[contenteditable="true"]')
      ) {
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      data-code-floating-window
      className={cn(
        "no-scrollbar-deep fixed z-40 flex flex-col overflow-hidden",
        "rounded-2xl border border-border/60 bg-card text-[12px]",
        "shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_24px_48px_-12px_rgba(0,0,0,0.45),0_8px_16px_-8px_rgba(0,0,0,0.3)]",
        "ring-1 ring-black/5 dark:ring-white/5",
      )}
    >
      {RESIZE_DIRS.map((dir) => (
        <div
          key={dir}
          data-no-drag
          onPointerDown={startResize(dir)}
          className={cn(
            "absolute z-50 touch-none select-none",
            RESIZE_HANDLE_CLASS[dir],
          )}
        />
      ))}
      <div
        onPointerDown={onHeaderPointerDown}
        className="relative flex h-10 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-border/60 px-3 active:cursor-grabbing"
      >
        <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-foreground">
          <HugeiconsIcon
            icon={CodeIcon}
            size={13}
            strokeWidth={1.9}
            className="shrink-0 text-muted-foreground"
          />
          <span className="truncate">Code</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onOpenWorkspace}
            className="size-5"
            aria-label="Open Code chat in workspace"
            title="Open Code chat in workspace"
          >
            <HugeiconsIcon icon={FullscreenIcon} size={11} strokeWidth={1.75} />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClose}
            className="size-5"
            aria-label="Close Code pop-out"
            title="Close"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={1.75} />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </motion.div>
  );
}
