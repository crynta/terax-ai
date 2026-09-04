import type { PointerEvent as ReactPointerEvent } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { excludeNestedSources } from "./batchMove";

export type ExplorerPathDropTarget = {
  updateTarget: (clientX: number, clientY: number) => boolean;
  dropPath: (paths: string[], clientX: number, clientY: number) => boolean;
  clearTarget: () => void;
};

type Options = {
  rootPath: string;
  isDir: (path: string) => boolean | undefined;
  onMove: (from: string[], toDir: string) => void;
  getSelectedPaths: () => Set<string>;
  collapseSelectionTo: (path: string) => void;
  pathDropTarget?: ExplorerPathDropTarget;
};

const THRESHOLD = 5;

function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : path;
}

export function resolveExplorerMoveTarget(
  sources: string[],
  rootPath: string,
  hoveredPath: string | null,
  insideExplorer: boolean,
  isDir: (path: string) => boolean | undefined,
): string | null {
  if (!insideExplorer) return null;
  const target = hoveredPath
    ? isDir(hoveredPath)
      ? hoveredPath
      : parentDir(hoveredPath)
    : rootPath;
  const allAlreadyInTarget = sources.every(
    (source) => parentDir(source) === target,
  );
  if (allAlreadyInTarget) return null;
  for (const source of sources) {
    if (target === source || target.startsWith(`${source}/`)) return null;
  }
  return target;
}

export function finishExplorerDrag(
  commit: boolean,
  sources: string[],
  clientX: number,
  clientY: number,
  moveTarget: string | null,
  pathDropTarget: ExplorerPathDropTarget | undefined,
  onMove: (from: string[], toDir: string) => void,
): void {
  const handledByPathTarget =
    commit && (pathDropTarget?.dropPath(sources, clientX, clientY) ?? false);
  if (commit && !handledByPathTarget && moveTarget) {
    onMove(sources, moveTarget);
  }
  pathDropTarget?.clearTarget();
}

// Pointer-based, delegated on the container (no per-row handlers); sidesteps
// native HTML5 DnD which Tauri intercepts when dragDropEnabled is on. The ghost
// follows the cursor via direct DOM writes, so dragging re-renders only when the
// drop target changes, not on every move.
export function useExplorerDnd({
  rootPath,
  isDir,
  onMove,
  getSelectedPaths,
  collapseSelectionTo,
  pathDropTarget,
}: Options) {
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);

  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const dropTargetRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const optsRef = useRef({
    rootPath,
    isDir,
    onMove,
    getSelectedPaths,
    collapseSelectionTo,
    pathDropTarget,
  });
  // Committed-state snapshot for the pointer listeners below (they attach
  // once and read this ref on every move), so an in-flight drag can't pick up
  // options from a render React later discards.
  useLayoutEffect(() => {
    optsRef.current = {
      rootPath,
      isDir,
      onMove,
      getSelectedPaths,
      collapseSelectionTo,
      pathDropTarget,
    };
  }, [
    rootPath,
    isDir,
    onMove,
    getSelectedPaths,
    collapseSelectionTo,
    pathDropTarget,
  ]);

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
    const sx = e.clientX;
    const sy = e.clientY;
    let active = false;
    // Decided at drag-activation (not pointerdown), so a plain click that never
    // crosses the threshold never touches selection.
    let sources: string[] = [source];

    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
        active = true;
        lastPosRef.current = { x: ev.clientX, y: ev.clientY };
        const sel = optsRef.current.getSelectedPaths();
        if (sel.has(source) && sel.size > 1) {
          sources = excludeNestedSources([...sel]);
        } else {
          sources = [source];
          optsRef.current.collapseSelectionTo(source);
        }
        setDragLabel(
          sources.length > 1
            ? `${sources.length} items`
            : source.slice(source.lastIndexOf("/") + 1),
        );
      }
      placeGhost(ev.clientX, ev.clientY);
      const { rootPath, isDir, pathDropTarget } = optsRef.current;
      const element = document.elementFromPoint(ev.clientX, ev.clientY);
      const terminalTargeted =
        pathDropTarget?.updateTarget(ev.clientX, ev.clientY) ?? false;
      const hit = element?.closest<HTMLElement>("[data-fs-path]");
      const p = hit?.getAttribute("data-fs-path");
      const valid = terminalTargeted
        ? null
        : resolveExplorerMoveTarget(
            sources,
            rootPath,
            p ?? null,
            element?.closest("[data-explorer-drop]") != null,
            isDir,
          );
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
      const { x, y } = lastPosRef.current;
      finishExplorerDrag(
        commit,
        sources,
        x,
        y,
        dropTargetRef.current,
        optsRef.current.pathDropTarget,
        optsRef.current.onMove,
      );
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

  useEffect(
    () => () => {
      cleanupRef.current?.();
      optsRef.current.pathDropTarget?.clearTarget();
    },
    [],
  );

  return { ghostRef, dragLabel, dropTargetDir, onPointerDown, onClickCapture };
}
