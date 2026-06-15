import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type Options = {
  rootPath: string;
  isDir: (path: string) => boolean | undefined;
  onMove: (from: string, toDir: string) => void;
};

const THRESHOLD = 5;

function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : path;
}

// Pointer-based, delegated on the container (no per-row handlers); sidesteps
// native HTML5 DnD which Tauri intercepts when dragDropEnabled is on. The ghost
// follows the cursor via direct DOM writes, so dragging re-renders only when the
// drop target changes, not on every move.
export function useExplorerDnd({ rootPath, isDir, onMove }: Options) {
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);

  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const dropTargetRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const optsRef = useRef({ rootPath, isDir, onMove });
  optsRef.current = { rootPath, isDir, onMove };

  const placeGhost = (x: number, y: number) => {
    lastPosRef.current = { x, y };
    const g = ghostElRef.current;
    if (g) {
      g.style.left = `${x + 12}px`;
      g.style.top = `${y + 8}px`;
    }
  };

  const ghostRef = useCallback((el: HTMLDivElement | null) => {
    ghostElRef.current = el;
    if (el) placeGhost(lastPosRef.current.x, lastPosRef.current.y);
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-fs-path]");
    const source = el?.getAttribute("data-fs-path");
    if (!source) return;
    const name = source.slice(source.lastIndexOf("/") + 1);
    const sx = e.clientX;
    const sy = e.clientY;
    let active = false;

    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
        active = true;
        lastPosRef.current = { x: ev.clientX, y: ev.clientY };
        setDragLabel(name);
      }
      placeGhost(ev.clientX, ev.clientY);
      const { rootPath, isDir } = optsRef.current;
      const hit = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>("[data-fs-path]");
      const p = hit?.getAttribute("data-fs-path");
      const t = p ? (isDir(p) ? p : parentDir(p)) : rootPath;
      const valid =
        t !== source && !t.startsWith(`${source}/`) && parentDir(source) !== t
          ? t
          : null;
      if (dropTargetRef.current !== valid) {
        dropTargetRef.current = valid;
        setDropTargetDir(valid);
      }
    };
    const detach = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      cleanupRef.current = null;
    };
    const end = (commit: boolean) => {
      detach();
      if (!active) return;
      if (commit && dropTargetRef.current)
        optsRef.current.onMove(source, dropTargetRef.current);
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      dropTargetRef.current = null;
      setDragLabel(null);
      setDropTargetDir(null);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    cleanupRef.current = detach;
  }, []);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  useEffect(() => () => cleanupRef.current?.(), []);

  return { ghostRef, dragLabel, dropTargetDir, onPointerDown, onClickCapture };
}
