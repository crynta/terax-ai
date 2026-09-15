import type { TerminalFontMetrics } from "./terminalVisuals";

const MIN_COLUMNS = 2;
const MAX_COLUMNS = 512;
const MIN_ROWS = 1;
const MAX_ROWS = 256;
const LAYOUT_ROUNDING_TOLERANCE_PX = 0.01;

export type TerminalViewportFit = {
  readonly cols: number;
  readonly rows: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
};

/**
 * Converts a host content box into one canonical terminal viewport geometry.
 * Keeping this shared prevents the WebGPU and WebGL paths from disagreeing at
 * fractional layout sizes or non-integer device pixel ratios.
 */
export function fitTerminalViewport(
  hostWidth: number,
  hostHeight: number,
  metrics: TerminalFontMetrics,
  devicePixelRatio: number,
): TerminalViewportFit | null {
  const { cellWidth, cellHeight } = metrics;
  if (
    !isPositiveFinite(hostWidth) ||
    !isPositiveFinite(hostHeight) ||
    !isPositiveFinite(cellWidth) ||
    !isPositiveFinite(cellHeight) ||
    hostWidth + LAYOUT_ROUNDING_TOLERANCE_PX < MIN_COLUMNS * cellWidth ||
    hostHeight + LAYOUT_ROUNDING_TOLERANCE_PX < MIN_ROWS * cellHeight
  ) {
    return null;
  }

  const cols = clamp(
    Math.floor((hostWidth + LAYOUT_ROUNDING_TOLERANCE_PX) / cellWidth),
    MIN_COLUMNS,
    MAX_COLUMNS,
  );
  const rows = clamp(
    Math.floor((hostHeight + LAYOUT_ROUNDING_TOLERANCE_PX) / cellHeight),
    MIN_ROWS,
    MAX_ROWS,
  );
  const cssWidth = cols * cellWidth;
  const cssHeight = rows * cellHeight;
  const scale = isPositiveFinite(devicePixelRatio)
    ? Math.max(1, devicePixelRatio)
    : 1;

  return {
    cols,
    rows,
    cssWidth,
    cssHeight,
    pixelWidth: Math.max(1, Math.round(cssWidth * scale)),
    pixelHeight: Math.max(1, Math.round(cssHeight * scale)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
