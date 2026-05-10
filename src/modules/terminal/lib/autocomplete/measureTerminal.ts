import type { Terminal } from "@xterm/xterm";

export type CellMetrics = {
  cellW: number;
  cellH: number;
  padX: number;
  padY: number;
};

type CoreDims = {
  _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } };
};

/** Match xterm’s own cell metrics when available (WebGL/DOM); avoids grid vs. clientWidth drift. */
function tryCoreCellSize(term: Terminal): { w: number; h: number } | null {
  const core = (term as unknown as { _core?: CoreDims })._core;
  const cell = core?._renderService?.dimensions?.css?.cell;
  const w = cell?.width;
  const h = cell?.height;
  if (w != null && h != null && w > 0 && h > 0) {
    return { w, h };
  }
  return null;
}

/**
 * Map buffer cell (x,y) to pixels inside `layoutRoot` (the `position: relative` host for overlays).
 */
export function measureCellMetrics(
  term: Terminal,
  /** The element that wraps `term.element` (same as overlay offsetParent in normal layout). */
  layoutRoot: HTMLElement,
): CellMetrics {
  const el = term.element;
  if (!el) {
    return { cellW: 8, cellH: 16, padX: 0, padY: 0 };
  }

  const screen =
    (el.querySelector(".xterm-screen") as HTMLElement | null) ??
    (el.querySelector(".xterm-viewport") as HTMLElement | null) ??
    el;

  const cols = Math.max(1, term.cols);
  const rows = Math.max(1, term.rows);

  const coreCell = tryCoreCellSize(term);
  const cellW = coreCell?.w ?? screen.clientWidth / cols;
  const cellH = coreCell?.h ?? screen.clientHeight / rows;

  const rootRect = layoutRoot.getBoundingClientRect();
  const screenRect = screen.getBoundingClientRect();

  return {
    cellW,
    cellH,
    padX: screenRect.left - rootRect.left,
    padY: screenRect.top - rootRect.top,
  };
}

export function cursorPixelOffset(
  term: Terminal,
  m: CellMetrics,
): { left: number; top: number } {
  const buf = term.buffer.active;
  const x = Math.min(buf.cursorX, Math.max(0, term.cols - 1));
  const y = buf.cursorY;
  return {
    left: m.padX + x * m.cellW,
    top: m.padY + y * m.cellH,
  };
}
