import { readTerminalTokens } from "@/styles/tokens";
import type { Rgb } from "../core/packedCells";

export type TerminalFontSpec = {
  readonly family: string;
  readonly size: number;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly weight: string;
};

export type TerminalFontMetrics = {
  readonly font: TerminalFontSpec;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly baseline: number;
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

export async function measureTerminalFont(
  font: TerminalFontSpec,
): Promise<TerminalFontMetrics> {
  await document.fonts.load(fontCss(font, false, false)).catch(() => undefined);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas font measurement is unavailable");
  context.font = fontCss(font, false, false);
  const sample = context.measureText("M");
  const ascent = sample.actualBoundingBoxAscent || font.size * 0.8;
  const descent = sample.actualBoundingBoxDescent || font.size * 0.2;
  const measuredHeight = Math.ceil(ascent + descent);
  const cellHeight = Math.max(
    measuredHeight + 2,
    Math.ceil(font.size * font.lineHeight),
  );
  const verticalPadding = Math.max(0, cellHeight - ascent - descent);

  return {
    font,
    cellWidth: Math.max(1, Math.ceil(sample.width + font.letterSpacing)),
    cellHeight,
    baseline: Math.ceil(verticalPadding / 2 + ascent),
  };
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
