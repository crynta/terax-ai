import { shellDialect, type ShellDialect } from "@/lib/shellQuote";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import { useTerminalDropStore } from "./dropStore";
import { formatDroppedPaths } from "./quoteShellPath";
import { pasteIntoSession, ptyIdForLeaf } from "./terminalSessionApi";

export type TerminalPathDropTarget = {
  updateTarget: (clientX: number, clientY: number) => boolean;
  dropPath: (paths: string[], clientX: number, clientY: number) => boolean;
  clearTarget: () => void;
};

type TerminalPathDropDeps = {
  leafIdAtPoint: (clientX: number, clientY: number) => number | null;
  paste: (leafId: number, text: string) => boolean;
  setTarget: (leafId: number | null) => void;
  dialect?: (
    leafId: number,
  ) => ShellDialect | null | Promise<ShellDialect | null>;
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
  // The Session Reader covers the pane: drops there belong to its composer,
  // never to the hidden terminal underneath.
  if (el?.closest("[data-terax-reader]")) return null;
  const leafEl = el?.closest<HTMLElement>("[data-pane-leaf]");
  if (!leafEl) return null;
  const id = Number(leafEl.dataset.paneLeaf);
  return Number.isFinite(id) ? id : null;
}

function dialectForLeaf(
  leafId: number,
): ShellDialect | null | Promise<ShellDialect | null> {
  const id = ptyIdForLeaf(leafId);
  if (id === null) return null;
  return invoke<string>("pty_session_shell", { id }).then((program) => {
    if (ptyIdForLeaf(leafId) !== id) return null;
    const dialect = shellDialect(program);
    if (dialect === null)
      throw new Error("File drops are unavailable for this shell.");
    return dialect;
  });
}

export function createTerminalPathDropTarget({
  leafIdAtPoint,
  paste,
  setTarget,
  dialect = dialectForLeaf,
}: TerminalPathDropDeps): TerminalPathDropTarget {
  return {
    updateTarget(clientX, clientY) {
      const leafId = leafIdAtPoint(clientX, clientY);
      setTarget(leafId);
      return leafId !== null;
    },
    dropPath(paths, clientX, clientY) {
      setTarget(null);
      const leafId = leafIdAtPoint(clientX, clientY);
      if (leafId === null) return false;
      const insert = (shell: ShellDialect | null) => {
        if (shell === null) return;
        try {
          paste(leafId, formatDroppedPaths(paths, shell));
        } catch (error) {
          toast.error(String(error));
        }
      };
      const shell = dialect(leafId);
      if (shell instanceof Promise)
        void shell.then(insert).catch((error) => toast.error(String(error)));
      else insert(shell);
      return true;
    },
    clearTarget() {
      setTarget(null);
    },
  };
}

const terminalPathDropTarget = createTerminalPathDropTarget({
  leafIdAtPoint: leafIdAt,
  paste: pasteIntoSession,
  setTarget: (leafId) => useTerminalDropStore.getState().setTarget(leafId),
});

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
          terminalPathDropTarget.dropPath(p.paths, p.position.x, p.position.y);
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
