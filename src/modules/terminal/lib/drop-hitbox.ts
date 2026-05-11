export type DropPoint = { x: number; y: number };
export type DropRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type DropViewport = { width: number; height: number };

export function isDropPointInsideRect(
  point: DropPoint,
  rect: DropRect,
  viewport: DropViewport,
  scaleFactor: number,
): boolean {
  const logical = normalizeDropPoint(point, viewport, scaleFactor);
  return (
    logical.x >= rect.left &&
    logical.x <= rect.right &&
    logical.y >= rect.top &&
    logical.y <= rect.bottom
  );
}

function normalizeDropPoint(
  point: DropPoint,
  viewport: DropViewport,
  scaleFactor: number,
): DropPoint {
  if (point.x <= viewport.width && point.y <= viewport.height) return point;
  const scale = scaleFactor > 0 ? scaleFactor : 1;
  return { x: point.x / scale, y: point.y / scale };
}
