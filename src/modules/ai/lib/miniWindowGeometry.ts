export type Geom = { x: number; y: number; w: number; h: number };
export type Viewport = { vw: number; vh: number };
export type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const MIN_W = 400;
export const MIN_H = 280;

const MARGIN_X = 16;
const BOTTOM_GAP = 96;
const TOP_GAP = 16;

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export function defaultGeom(vp: Viewport): Geom {
  const w = Math.max(MIN_W, Math.min(500, vp.vw - MARGIN_X * 2));
  const h = Math.max(MIN_H, Math.min(600, vp.vh - BOTTOM_GAP - TOP_GAP));
  return clampGeom(
    { x: vp.vw - w - MARGIN_X, y: vp.vh - h - BOTTOM_GAP, w, h },
    vp,
  );
}

export function clampGeom(g: Geom, vp: Viewport): Geom {
  const w = clamp(g.w, MIN_W, Math.max(MIN_W, vp.vw));
  const h = clamp(g.h, MIN_H, Math.max(MIN_H, vp.vh));
  return {
    w,
    h,
    x: clamp(g.x, 0, Math.max(0, vp.vw - w)),
    y: clamp(g.y, 0, Math.max(0, vp.vh - h)),
  };
}

export function applyDrag(
  start: Geom,
  dx: number,
  dy: number,
  vp: Viewport,
): Geom {
  return clampGeom({ ...start, x: start.x + dx, y: start.y + dy }, vp);
}

export function applyResize(
  start: Geom,
  dir: ResizeDir,
  dx: number,
  dy: number,
  vp: Viewport,
): Geom {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;

  const movesW = dir.includes("w");
  const movesE = dir.includes("e");
  const movesN = dir.includes("n");
  const movesS = dir.includes("s");

  if (movesE) right += dx;
  if (movesW) left += dx;
  if (movesS) bottom += dy;
  if (movesN) top += dy;

  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(vp.vw, right);
  bottom = Math.min(vp.vh, bottom);

  if (right - left < MIN_W) {
    if (movesW) left = right - MIN_W;
    else right = left + MIN_W;
  }
  if (bottom - top < MIN_H) {
    if (movesN) top = bottom - MIN_H;
    else bottom = top + MIN_H;
  }

  return clampGeom({ x: left, y: top, w: right - left, h: bottom - top }, vp);
}
