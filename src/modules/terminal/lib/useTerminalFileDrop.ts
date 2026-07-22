import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import { useTerminalDropStore } from "./dropStore";
import { formatDroppedPaths } from "./quoteShellPath";
import { pasteIntoLeaf } from "./rendererPool";

export type TerminalPathDropTarget = {
  updateTarget: (clientX: number, clientY: number) => boolean;
  dropPath: (path: string, clientX: number, clientY: number) => boolean;
  clearTarget: () => void;
};

// Tauri reports the drop point in physical pixels on some platforms and logical
// on others; only scale down when it overflows the logical viewport.
function leafIdAt(x: number, y: number): number | null {
  let lx = x;
  let ly = y;
  if (x > window.innerWidth || y > window.innerHeight) {
    const dpr = window.devicePixelRatio || 1;
    lx = x / dpr;
    ly = y / dpr;
  }
  const el = document.elementFromPoint(lx, ly);
  const leafEl = el?.closest<HTMLElement>("[data-pane-leaf]");
  if (!leafEl) return null;
  const id = Number(leafEl.dataset.paneLeaf);
  return Number.isFinite(id) ? id : null;
}

const terminalPathDropTarget: TerminalPathDropTarget = {
  updateTarget(clientX, clientY) {
    const leafId = leafIdAt(clientX, clientY);
    useTerminalDropStore.getState().setTarget(leafId);
    return leafId !== null;
  },
  dropPath(path, clientX, clientY) {
    useTerminalDropStore.getState().setTarget(null);
    const leafId = leafIdAt(clientX, clientY);
    if (leafId === null) return false;
    pasteIntoLeaf(leafId, formatDroppedPaths([path]));
    return true;
  },
  clearTarget() {
    useTerminalDropStore.getState().setTarget(null);
  },
};

/** Wires native OS file drops into the terminal pane under the cursor: shows a
 * drop overlay on that pane while dragging, and bracketed-pastes the
 * shell-quoted path(s) on drop. Drops outside any terminal leaf are ignored. */
export function useTerminalFileDrop(): TerminalPathDropTarget {
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

  return terminalPathDropTarget;
}
