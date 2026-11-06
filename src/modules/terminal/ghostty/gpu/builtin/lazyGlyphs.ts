/**
 * Procedural glyphs that terminal UIs rarely draw: geometric corner triangles,
 * sextants, octants and Symbols for Legacy Computing. Their drawing code
 * (`legacyComputing.ts`, about 2 kB gzipped) loads on first use so that it stays
 * out of the chunk every terminal needs. The code point ranges stay here, since
 * every glyph lookup asks for them.
 *
 * Until the code arrives a glyph is drawn blank; when it does, every terminal is
 * told to rebuild its glyph atlas (`notifySymbolFontsChanged`), the same
 * handshake as the lazily loaded icon face. If the code cannot load, the
 * characters fall back to the font.
 */
import { notifySymbolFontsChanged } from "@/lib/fonts";
import { SHADE_MEDIUM, fillBlock, fillFractions } from "./blockElements";
import {
  LINE_HEAVY,
  LINE_LIGHT,
  diagonalUpperLeftToLowerRight,
  diagonalUpperRightToLowerLeft,
  drawLines,
} from "./boxDrawing";
import { type SpriteMask, signedArea } from "./SpriteMask";
import type { SpriteSpec } from "./spriteSpec";

/** The eager drawing helpers the lazily loaded code builds on (`legacyComputing.ts`). */
export type BuiltinTools = {
  readonly SHADE_MEDIUM: typeof SHADE_MEDIUM;
  readonly LINE_HEAVY: typeof LINE_HEAVY;
  readonly LINE_LIGHT: typeof LINE_LIGHT;
  readonly fillBlock: typeof fillBlock;
  readonly fillFractions: typeof fillFractions;
  readonly drawLines: typeof drawLines;
  readonly diagonalUpperLeftToLowerRight: typeof diagonalUpperLeftToLowerRight;
  readonly diagonalUpperRightToLowerLeft: typeof diagonalUpperRightToLowerLeft;
  readonly signedArea: typeof signedArea;
};

export function isGeometricShape(codepoint: number): boolean {
  return (
    (codepoint >= 0x25e2 && codepoint <= 0x25e5) ||
    (codepoint >= 0x25f8 && codepoint <= 0x25fa) ||
    codepoint === 0x25ff
  );
}

export function isSextant(codepoint: number): boolean {
  return codepoint >= 0x1fb00 && codepoint <= 0x1fb3b;
}

export function isOctant(codepoint: number): boolean {
  return codepoint >= 0x1cd00 && codepoint <= 0x1cde5;
}

export function isLegacyComputing(codepoint: number): boolean {
  return (
    (codepoint >= 0x1fb3c && codepoint <= 0x1fbaf) ||
    (codepoint >= 0x1fbbd && codepoint <= 0x1fbbf) ||
    (codepoint >= 0x1fbce && codepoint <= 0x1fbef)
  );
}

/** Whether `codepoint` is drawn by the lazily loaded code. */
export function isLazyBuiltin(codepoint: number): boolean {
  return (
    isGeometricShape(codepoint) ||
    isSextant(codepoint) ||
    isLegacyComputing(codepoint) ||
    isOctant(codepoint)
  );
}

type Draw = (mask: SpriteMask, spec: SpriteSpec, codepoint: number) => void;

let draw: Draw | null = null;
let failed = false;
let loading: Promise<void> | null = null;

/** Loads the drawing code once and tells the terminals when it settles. */
export function loadLazyBuiltin(): Promise<void> {
  loading ??= import("./legacyComputing")
    .then(
      (module) => {
        module.bindBuiltinTools({
          SHADE_MEDIUM,
          LINE_HEAVY,
          LINE_LIGHT,
          fillBlock,
          fillFractions,
          drawLines,
          diagonalUpperLeftToLowerRight,
          diagonalUpperRightToLowerLeft,
          signedArea,
        });
        draw = (mask, spec, codepoint) => {
          if (isGeometricShape(codepoint)) {
            module.drawGeometricShape(mask, spec, codepoint);
          } else if (isSextant(codepoint)) {
            module.drawSextant(mask, spec, codepoint);
          } else if (isOctant(codepoint)) {
            module.drawOctant(mask, spec, codepoint);
          } else {
            module.drawLegacyComputing(mask, spec, codepoint);
          }
        };
      },
      () => {
        failed = true;
      },
    )
    .then(notifySymbolFontsChanged);
  return loading;
}

/** The drawing function once loaded, else null. */
export function lazyBuiltinDraw(): Draw | null {
  return draw;
}

export function lazyBuiltinFailed(): boolean {
  return failed;
}

/** True while the code is not usable yet; the first call starts loading it. */
export function lazyBuiltinPending(): boolean {
  if (draw || failed) return false;
  void loadLazyBuiltin();
  return true;
}
