import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback } from "react";

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const DIR_MAP: Record<
  ResizeDir,
  "North" | "South" | "East" | "West" | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest"
> = {
  n: "North",
  s: "South",
  e: "East",
  w: "West",
  ne: "NorthEast",
  nw: "NorthWest",
  se: "SouthEast",
  sw: "SouthWest",
};

const HANDLE_CLASS: Record<ResizeDir, string> = {
  n: "top-0 left-2 right-2 h-1 cursor-ns-resize",
  s: "bottom-0 left-2 right-2 h-1 cursor-ns-resize",
  w: "top-2 bottom-2 left-0 w-1 cursor-ew-resize",
  e: "top-2 bottom-2 right-0 w-1 cursor-ew-resize",
  nw: "top-0 left-0 size-2 cursor-nwse-resize",
  ne: "top-0 right-0 size-2 cursor-nesw-resize",
  sw: "bottom-0 left-0 size-2 cursor-nesw-resize",
  se: "bottom-0 right-0 size-2 cursor-nwse-resize",
};

const DIRS: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export function WindowResizeHandles() {
  const startResize = useCallback((dir: ResizeDir) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void getCurrentWindow().startResizeDragging(DIR_MAP[dir]);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {DIRS.map((dir) => (
        <div
          key={dir}
          onPointerDown={startResize(dir)}
          className={`pointer-events-auto absolute ${HANDLE_CLASS[dir]}`}
        />
      ))}
    </div>
  );
}
