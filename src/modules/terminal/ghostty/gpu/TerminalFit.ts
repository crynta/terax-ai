import type { TerminalFontMetrics } from "./terminalVisuals";

const MIN_COLUMNS = 2;
const MAX_COLUMNS = 512;
const MIN_ROWS = 1;
const MAX_ROWS = 256;
const DEVICE_ROUNDING_TOLERANCE_PX = 0.02;

export type TerminalDeviceBounds = {
  readonly width: number;
  readonly height: number;
};

export type TerminalViewportFit = {
  readonly cols: number;
  readonly rows: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
};

/**
 * Fits whole integer device cells into a host box. `deviceBounds` is the exact
 * device-pixel content box from `ResizeObserver` when the engine reports it;
 * otherwise the CSS size is converted and rounded. The CSS size of the result
 * is the device size divided by the ratio, so a canvas styled with it maps
 * 1:1 onto the device pixel grid.
 */
export function fitTerminalViewport(
  hostWidth: number,
  hostHeight: number,
  metrics: TerminalFontMetrics,
  deviceBounds?: TerminalDeviceBounds | null,
): TerminalViewportFit | null {
  const { deviceCellWidth, deviceCellHeight, scale } = metrics;
  if (
    !isPositiveFinite(hostWidth) ||
    !isPositiveFinite(hostHeight) ||
    !isPositiveFinite(deviceCellWidth) ||
    !isPositiveFinite(deviceCellHeight) ||
    !isPositiveFinite(scale)
  ) {
    return null;
  }
  const deviceWidth = deviceBounds?.width ?? hostWidth * scale;
  const deviceHeight = deviceBounds?.height ?? hostHeight * scale;
  if (
    deviceWidth + DEVICE_ROUNDING_TOLERANCE_PX <
      MIN_COLUMNS * deviceCellWidth ||
    deviceHeight + DEVICE_ROUNDING_TOLERANCE_PX < MIN_ROWS * deviceCellHeight
  ) {
    return null;
  }

  const cols = clamp(
    Math.floor((deviceWidth + DEVICE_ROUNDING_TOLERANCE_PX) / deviceCellWidth),
    MIN_COLUMNS,
    MAX_COLUMNS,
  );
  const rows = clamp(
    Math.floor(
      (deviceHeight + DEVICE_ROUNDING_TOLERANCE_PX) / deviceCellHeight,
    ),
    MIN_ROWS,
    MAX_ROWS,
  );
  const pixelWidth = cols * deviceCellWidth;
  const pixelHeight = rows * deviceCellHeight;
  return {
    cols,
    rows,
    cssWidth: pixelWidth / scale,
    cssHeight: pixelHeight / scale,
    pixelWidth,
    pixelHeight,
  };
}

/**
 * CSS translation that moves an element whose layout origin is `left`/`top`
 * onto the nearest device pixel boundary. Zero when already aligned.
 */
export function snapOffsetCss(
  left: number,
  top: number,
  scale: number,
): { readonly x: number; readonly y: number } {
  return { x: snapAxis(left, scale), y: snapAxis(top, scale) };
}

function snapAxis(origin: number, scale: number): number {
  if (!Number.isFinite(origin) || !isPositiveFinite(scale)) return 0;
  const device = origin * scale;
  const offset = (Math.round(device) - device) / scale;
  return Math.abs(offset * scale) < 1e-6 ? 0 : offset;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
