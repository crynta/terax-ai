import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import { useTerminalDropStore } from "./dropStore";
import { formatDroppedPaths } from "./quoteShellPath";
import { pasteIntoLeaf } from "./rendererPool";

type Point = { x: number; y: number };
type ViewportLike = { devicePixelRatio?: number };

export function dragPointCandidates(
  x: number,
  y: number,
  viewport: ViewportLike = window,
): Point[] {
  const points: Point[] = [{ x, y }];
  const dpr = viewport.devicePixelRatio || 1;
  if (dpr !== 1) points.push({ x: x / dpr, y: y / dpr });
  return points;
}

function leafIdFromElement(el: Element | null): number | null {
  const leafEl = el?.closest<HTMLElement>("[data-pane-leaf]");
  if (!leafEl) return null;
  const id = Number(leafEl.dataset.paneLeaf);
  return Number.isFinite(id) ? id : null;
}

function leafIdFromRects(points: Point[]): number | null {
  for (const leaf of document.querySelectorAll<HTMLElement>("[data-pane-leaf]")) {
    const rect = leaf.getBoundingClientRect();
    for (const p of points) {
      if (
        p.x >= rect.left &&
        p.x <= rect.right &&
        p.y >= rect.top &&
        p.y <= rect.bottom
      ) {
        const id = Number(leaf.dataset.paneLeaf);
        return Number.isFinite(id) ? id : null;
      }
    }
  }
  return null;
}

function leafIdAt(x: number, y: number): number | null {
  const points = dragPointCandidates(x, y);
  for (const p of points) {
    const id = leafIdFromElement(document.elementFromPoint(p.x, p.y));
    if (id !== null) return id;
  }
  return leafIdFromRects(points);
}

/** Wires native OS file drops into the terminal pane under the cursor: shows a
 * drop overlay on that pane while dragging, and bracketed-pastes the
 * shell-quoted path(s) on drop. Drops outside any terminal leaf are ignored. */
export function useTerminalFileDrop(): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const setTarget = useTerminalDropStore.getState().setTarget;

    void getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") {
          setTarget(leafIdAt(p.position.x, p.position.y));
          return;
        }
        if (p.type === "leave") {
          setTarget(null);
          return;
        }
        if (p.type === "drop") {
          setTarget(null);
          if (!p.paths.length) return;
          const leafId = leafIdAt(p.position.x, p.position.y);
          if (leafId !== null) {
            pasteIntoLeaf(leafId, formatDroppedPaths(p.paths));
          }
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((err) => console.error("[terax] drag-drop listen failed:", err));

    return () => {
      disposed = true;
      setTarget(null);
      unlisten?.();
    };
  }, []);
}
