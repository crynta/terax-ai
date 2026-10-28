/**
 * Geometry of panes inside the window canvas. A pane host is measured in CSS pixels relative to
 * the viewport; the shared canvas covers the terminal area, and each pane draws into a whole
 * device pixel rectangle of it. All of this is pure arithmetic on rectangles the layout
 * callbacks already measured, so no frame reads the DOM.
 */

/** A box in CSS pixels, in viewport coordinates (what `getBoundingClientRect` reports). */
export type CssRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/** A box in whole device pixels, relative to the canvas origin. */
export type DeviceRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * Device pixels of the pane that lie left of / above the canvas and are cut off (a pane laid
   * out partly outside the area). The rectangle is what remains, and the pane's own origin is
   * `x - clipX`, `y - clipY`. Absent means none.
   */
  readonly clipX?: number;
  readonly clipY?: number;
};

/**
 * The canvas origin on the device pixel grid: the nearest device pixel to the area's layout
 * origin. Panes are measured against this, and the canvas is translated onto it (see
 * `snapOffsetCss`), so a pane edge and the DOM next to it always meet on the same pixel.
 */
export function canvasOriginDevice(
  area: Pick<CssRect, "left" | "top">,
  scale: number,
): { readonly x: number; readonly y: number } {
  return {
    x: Math.round(finite(area.left) * scale),
    y: Math.round(finite(area.top) * scale),
  };
}

/**
 * A pane's rectangle in device pixels of the canvas. Both edges are rounded independently, like
 * the engine snaps box edges when painting, so two neighbours never overlap or leave a gap
 * wider than the DOM divider between them.
 */
export function snapPaneRect(
  pane: CssRect,
  area: Pick<CssRect, "left" | "top">,
  scale: number,
): DeviceRect {
  const origin = canvasOriginDevice(area, scale);
  const x0 = Math.round(finite(pane.left) * scale) - origin.x;
  const y0 = Math.round(finite(pane.top) * scale) - origin.y;
  const x1 =
    Math.round((finite(pane.left) + finite(pane.width)) * scale) - origin.x;
  const y1 =
    Math.round((finite(pane.top) + finite(pane.height)) * scale) - origin.y;
  return {
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  };
}

/**
 * The part of a rectangle that lies inside a canvas of the given size, or null when nothing is
 * left. WebGPU rejects a viewport or scissor rectangle that leaves the render target. What is
 * cut off at the left or top is reported (`clipX`, `clipY`), so the pane keeps its place and
 * is clipped rather than slid to the canvas edge.
 */
export function clampToCanvas(
  rect: DeviceRect,
  canvasWidth: number,
  canvasHeight: number,
): DeviceRect | null {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(canvasWidth, rect.x + rect.width);
  const y1 = Math.min(canvasHeight, rect.y + rect.height);
  if (x1 <= x0 || y1 <= y0) return null;
  const clipX = x0 - rect.x;
  const clipY = y0 - rect.y;
  const clamped = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  return clipX > 0 || clipY > 0 ? { ...clamped, clipX, clipY } : clamped;
}

export function deviceRectsEqual(
  a: DeviceRect | null,
  b: DeviceRect | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    (a.clipX ?? 0) === (b.clipX ?? 0) &&
    (a.clipY ?? 0) === (b.clipY ?? 0)
  );
}

export function cssRectsEqual(a: CssRect | null, b: CssRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
