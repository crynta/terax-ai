import { readTerminalTokens } from "@/styles/tokens";
import type { Rgb } from "../core/packedCells";

export type TerminalFontSpec = {
  readonly family: string;
  readonly size: number;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly weight: string;
};

/**
 * Cell geometry for one font at one device pixel ratio. The device fields are
 * the authoritative integer sizes every renderer draws with; the CSS fields are
 * the same sizes divided by `scale` and are used for fit, hit-testing,
 * selection, links and block overlays.
 */
export type TerminalFontMetrics = {
  readonly font: TerminalFontSpec;
  readonly scale: number;
  readonly deviceCellWidth: number;
  readonly deviceCellHeight: number;
  readonly deviceBaseline: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly baseline: number;
};

export type RawFontMeasurement = {
  readonly advance: number;
  readonly ascent: number;
  readonly descent: number;
};

export type TerminalGpuTheme = {
  readonly background: Rgb;
  readonly foreground: Rgb;
  readonly cursor: Rgb;
  readonly selection: {
    readonly color: Rgb;
    readonly alpha: number;
  };
  readonly palette: readonly Rgb[];
};

let colorCanvas: HTMLCanvasElement | null = null;
let colorContext: CanvasRenderingContext2D | null = null;
let measureCanvas: HTMLCanvasElement | null = null;

export function devicePixelScale(): number {
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? Math.max(1, ratio) : 1;
}

/**
 * Pure derivation of integer device cells from a measurement taken at
 * `font.size * scale`. The epsilon keeps floating-point noise at an exact
 * integer advance from costing a whole extra device pixel.
 */
export function deriveFontMetrics(
  font: TerminalFontSpec,
  scale: number,
  raw: RawFontMeasurement,
): TerminalFontMetrics {
  const deviceCellWidth = Math.max(
    1,
    ceilDevice(raw.advance + font.letterSpacing * scale),
  );
  const measuredHeight = ceilDevice(raw.ascent + raw.descent);
  const deviceCellHeight = Math.max(
    measuredHeight + 2,
    ceilDevice(font.size * scale * font.lineHeight),
  );
  const verticalPadding = Math.max(
    0,
    deviceCellHeight - raw.ascent - raw.descent,
  );
  const deviceBaseline = ceilDevice(verticalPadding / 2 + raw.ascent);
  return {
    font,
    scale,
    deviceCellWidth,
    deviceCellHeight,
    deviceBaseline,
    cellWidth: deviceCellWidth / scale,
    cellHeight: deviceCellHeight / scale,
    baseline: deviceBaseline / scale,
  };
}

/** Fonts must already be loaded; the session awaits `document.fonts` first. */
export function measureTerminalFontSync(
  font: TerminalFontSpec,
  scale = devicePixelScale(),
): TerminalFontMetrics {
  measureCanvas ??= document.createElement("canvas");
  const context = measureCanvas.getContext("2d");
  if (!context) throw new Error("Canvas font measurement is unavailable");
  context.font = fontCss({ ...font, size: font.size * scale }, false, false);
  const sample = context.measureText("M");
  return deriveFontMetrics(font, scale, {
    advance: sample.width,
    ascent: sample.actualBoundingBoxAscent || font.size * scale * 0.8,
    descent: sample.actualBoundingBoxDescent || font.size * scale * 0.2,
  });
}

export async function measureTerminalFont(
  font: TerminalFontSpec,
  scale = devicePixelScale(),
): Promise<TerminalFontMetrics> {
  await document.fonts.load(fontCss(font, false, false)).catch(() => undefined);
  return measureTerminalFontSync(font, scale);
}

/** Metrics for `scale`, reusing `metrics` when it was already measured there. */
export function metricsForScale(
  metrics: TerminalFontMetrics,
  scale: number,
): TerminalFontMetrics {
  return metrics.scale === scale &&
    Number.isInteger(metrics.deviceCellWidth) &&
    Number.isInteger(metrics.deviceCellHeight)
    ? metrics
    : measureTerminalFontSync(metrics.font, scale);
}

/** Same font, same device cells: nothing downstream needs to react. */
export function metricsEqual(
  left: TerminalFontMetrics,
  right: TerminalFontMetrics,
): boolean {
  return (
    left.scale === right.scale &&
    left.deviceCellWidth === right.deviceCellWidth &&
    left.deviceCellHeight === right.deviceCellHeight &&
    left.deviceBaseline === right.deviceBaseline &&
    fontSpecKey(left.font) === fontSpecKey(right.font)
  );
}

function fontSpecKey(font: TerminalFontSpec): string {
  return [
    font.family,
    font.size,
    font.lineHeight,
    font.letterSpacing,
    font.weight,
  ].join("|");
}

function ceilDevice(value: number): number {
  return Math.ceil(value - 0.001);
}

export function fontCss(
  font: TerminalFontSpec,
  bold: boolean,
  italic: boolean,
): string {
  const weight = bold ? "700" : font.weight;
  return `${italic ? "italic " : ""}${weight} ${font.size}px ${font.family}`;
}

export function readTerminalGpuTheme(): TerminalGpuTheme {
  const tokens = readTerminalTokens();
  const selection = cssColorToRgba(tokens.selection);
  return {
    background: cssColorToRgb(tokens.background),
    foreground: cssColorToRgb(tokens.foreground),
    cursor: cssColorToRgb(tokens.cursor),
    selection: {
      color: [selection[0], selection[1], selection[2]],
      alpha: selection[3],
    },
    palette: [
      tokens.ansiBlack,
      tokens.ansiRed,
      tokens.ansiGreen,
      tokens.ansiYellow,
      tokens.ansiBlue,
      tokens.ansiMagenta,
      tokens.ansiCyan,
      tokens.ansiWhite,
      tokens.ansiBrightBlack,
      tokens.ansiBrightRed,
      tokens.ansiBrightGreen,
      tokens.ansiBrightYellow,
      tokens.ansiBrightBlue,
      tokens.ansiBrightMagenta,
      tokens.ansiBrightCyan,
      tokens.ansiBrightWhite,
    ].map(cssColorToRgb),
  };
}

export function rgbToInt(color: Rgb): number {
  return (color[0] << 16) | (color[1] << 8) | color[2];
}

export function rgbToCss(color: Rgb): string {
  return `rgb(${color[0]} ${color[1]} ${color[2]})`;
}

function cssColorToRgb(value: string): Rgb {
  const rgba = cssColorToRgba(value);
  return [rgba[0], rgba[1], rgba[2]];
}

function cssColorToRgba(
  value: string,
): readonly [red: number, green: number, blue: number, alpha: number] {
  colorCanvas ??= document.createElement("canvas");
  colorCanvas.width = 1;
  colorCanvas.height = 1;
  colorContext ??= colorCanvas.getContext("2d", { willReadFrequently: true });
  if (!colorContext) throw new Error("Canvas color conversion is unavailable");

  colorContext.clearRect(0, 0, 1, 1);
  colorContext.fillStyle = value;
  colorContext.fillRect(0, 0, 1, 1);
  const pixel = colorContext.getImageData(0, 0, 1, 1).data;
  return [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
}
