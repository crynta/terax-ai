type WheelDelta = Pick<
  WheelEvent,
  "deltaMode" | "deltaX" | "deltaY" | "ctrlKey" | "metaKey"
>;

const LINE_PIXELS = 16;

/** Remap vertical wheel motion without taking over horizontal or zoom gestures. */
export function tabWheelPixels(
  event: WheelDelta,
  viewportWidth: number,
): number {
  const { deltaMode, deltaX, deltaY, ctrlKey, metaKey } = event;
  if (ctrlKey || metaKey || Math.abs(deltaY) <= Math.abs(deltaX)) return 0;
  const pixels =
    deltaY *
    (deltaMode === 1 ? LINE_PIXELS : deltaMode === 2 ? viewportWidth : 1);
  return Number.isFinite(pixels) ? pixels : 0;
}
