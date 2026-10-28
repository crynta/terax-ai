import type { TerminalSelectionBounds } from "../selection/TerminalSelectionController";
import type { TerminalFontMetrics } from "./terminalVisuals";

const INT32_LIMIT = 0x3fff_ffff;

export type DecorationMetrics = {
  /** Underline band origin from the cell top, in device pixels. */
  readonly baseline: number;
  /** One decoration stroke, an integer number of device pixels. */
  readonly thickness: number;
  readonly strikeY: number;
};

export type CursorRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type SelectionUniform = {
  readonly active: boolean;
  readonly rectangular: boolean;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly left: number;
  readonly right: number;
};

export const NO_SELECTION: SelectionUniform = {
  active: false,
  rectangular: false,
  startLine: 0,
  startColumn: 0,
  endLine: 0,
  endColumn: 0,
  left: 0,
  right: 0,
};

export function decorationMetrics(
  metrics: TerminalFontMetrics,
): DecorationMetrics {
  return {
    baseline: metrics.deviceBaseline,
    thickness: strokeThickness(metrics.scale, 1),
    strikeY: Math.floor(metrics.deviceCellHeight * 0.52),
  };
}

/** Device pixel width of a cursor bar or underline. */
export function cursorThickness(scale: number): number {
  return strokeThickness(scale, 2);
}

export function cursorRect(
  cursor: { readonly x: number; readonly y: number },
  style: "block" | "underline" | "bar",
  metrics: TerminalFontMetrics,
): CursorRect {
  const { deviceCellWidth: width, deviceCellHeight: height } = metrics;
  const thickness = Math.min(
    cursorThickness(metrics.scale),
    style === "bar" ? width : height,
  );
  const x = cursor.x * width;
  const y = cursor.y * height;
  if (style === "bar") return { x, y, width: thickness, height };
  if (style === "underline") {
    return { x, y: y + height - thickness, width, height: thickness };
  }
  return { x, y, width, height };
}

/** Left glyph overhang tolerated before a differently coloured neighbour clips it. */
export function leftOverhangPadding(
  letterSpacing: number,
  scale: number,
): number {
  return Math.max(0, Math.floor((letterSpacing * scale) / 2));
}

/**
 * Viewport-relative selection range for the shader. Lines are relative to the
 * viewport origin so scrolling only changes this uniform; a selection that
 * lies wholly outside the viewport is inactive and costs nothing to draw.
 */
export function selectionUniform(
  bounds: TerminalSelectionBounds | null,
  viewportOriginLine: number,
  rows: number,
): SelectionUniform {
  if (!bounds) return NO_SELECTION;
  const startLine = bounds.startLine - viewportOriginLine;
  const endLine = bounds.endLine - viewportOriginLine;
  if (endLine < 0 || startLine >= rows) return NO_SELECTION;
  return {
    active: true,
    rectangular: bounds.rectangular,
    startLine: clampInt32(startLine),
    startColumn: clampInt32(bounds.startColumn),
    endLine: clampInt32(endLine),
    endColumn: clampInt32(bounds.endColumn),
    left: clampInt32(bounds.left),
    right: clampInt32(bounds.right),
  };
}

export function selectionUniformEqual(
  left: SelectionUniform,
  right: SelectionUniform,
): boolean {
  return (
    left.active === right.active &&
    left.rectangular === right.rectangular &&
    left.startLine === right.startLine &&
    left.startColumn === right.startColumn &&
    left.endLine === right.endLine &&
    left.endColumn === right.endColumn &&
    left.left === right.left &&
    left.right === right.right
  );
}

/**
 * CPU mirror of the shader's selection test. The shader evaluates this per
 * pixel; keeping an equivalent here pins the semantics in unit tests and lets
 * the shader be checked against the legacy `selectionBoundsContain` rules.
 */
export function selectionUniformContains(
  selection: SelectionUniform,
  row: number,
  column: number,
): boolean {
  if (!selection.active) return false;
  if (row < selection.startLine || row > selection.endLine) return false;
  if (selection.rectangular) {
    return column >= selection.left && column <= selection.right;
  }
  if (selection.startLine === selection.endLine) {
    return column >= selection.startColumn && column <= selection.endColumn;
  }
  if (row === selection.startLine) return column >= selection.startColumn;
  if (row === selection.endLine) return column <= selection.endColumn;
  return true;
}

function strokeThickness(scale: number, minimum: number): number {
  return Math.max(minimum, Math.round(scale));
}

function clampInt32(value: number): number {
  return Math.max(-INT32_LIMIT, Math.min(INT32_LIMIT, Math.trunc(value)));
}
