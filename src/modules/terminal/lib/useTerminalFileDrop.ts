import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import { formatDroppedPaths } from "./quoteShellPath";
import { pasteIntoLeaf } from "./rendererPool";

/** Wires native OS file drops into the terminal pane under the cursor.
 * Drops outside any terminal leaf (editor, file explorer, AI input bar,
 * tabbar, etc.) are intentionally ignored. */
export function useTerminalFileDrop(): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type !== "drop") return;
        const paths = e.payload.paths;
        if (!paths.length) return;

        // Tauri reports PhysicalPosition; elementFromPoint expects CSS px.
        const dpr = window.devicePixelRatio || 1;
        const x = e.payload.position.x / dpr;
        const y = e.payload.position.y / dpr;
        const el = document.elementFromPoint(x, y);
        const leafEl = el?.closest<HTMLElement>("[data-pane-leaf]");
        if (!leafEl) return;

        const leafId = Number(leafEl.dataset.paneLeaf);
        if (!Number.isFinite(leafId)) return;

        pasteIntoLeaf(leafId, formatDroppedPaths(paths));
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((err) => console.error("[terax] drag-drop listen failed:", err));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
