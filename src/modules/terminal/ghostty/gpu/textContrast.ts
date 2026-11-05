/**
 * Optional DirectWrite-style contrast for grayscale antialiasing, in both renderers. The fragment shader
 * runs `DWrite_EnhanceContrast` (scaled by foreground lightness, as in Windows
 * Terminal's `DWrite_ApplyLightOnDarkContrastAdjustment`) and then blends
 * toward `DWrite_ApplyAlphaCorrection` with the 1.8 gamma ratios. Both stages
 * are uniform controlled; zero strength is a bit-exact pass-through.
 */

/** Windows Terminal's default gamma 1.8 ratios (`dwrite_helpers.hlsl`). */
export const DWRITE_GAMMA_RATIOS = [
  0.148054421, -0.89459455, 1.47590804, -0.324668258,
] as const;

export type TextContrast = {
  /** `k` in `a * (k + 1) / (a * k + 1)`, before the lightness multiplier. */
  readonly enhancedContrast: number;
  /** 0 keeps the raw coverage, 1 applies the full alpha correction. */
  readonly alphaCorrection: number;
};

export const NO_TEXT_CONTRAST: TextContrast = {
  enhancedContrast: 0,
  alphaCorrection: 0,
};

const FRACTIONAL_DISPLAY_CONTRAST: TextContrast = {
  enhancedContrast: 0.5,
  alphaCorrection: 0.5,
};

/**
 * The contrast for the current display: none unless `localStorage["terax:terminal-text-contrast"]`
 * (`override`: "off", "on" or a strength) asks for it, and then both renderers apply the same
 * curve. Without it they draw identical glyph pixels at every ratio (verified at 1, 1.25, 1.5 and
 * 2). Enabled by default the curve made WebGPU text heavier and softer than WebGL on Windows and on
 * 1x displays, so it is a tuning aid, not a default.
 */
export function textContrastFor(
  override: string | null | undefined,
): TextContrast {
  return parseOverride(override) ?? NO_TEXT_CONTRAST;
}

const TEXT_CONTRAST_STORAGE_KEY = "terax:terminal-text-contrast";

/** The contrast the user asked for through `localStorage`; both renderers apply it alike. */
export function currentTextContrast(): TextContrast {
  let override: string | null = null;
  try {
    override = window.localStorage?.getItem(TEXT_CONTRAST_STORAGE_KEY) ?? null;
  } catch {
    override = null;
  }
  return textContrastFor(override);
}

/** CPU mirror of the shader curve, used by tests and the lab. */
export function applyTextContrast(
  coverage: number,
  foreground: readonly [number, number, number],
  contrast: TextContrast,
): number {
  if (contrast.enhancedContrast === 0 && contrast.alphaCorrection === 0) {
    return coverage;
  }
  const [red, green, blue] = foreground;
  const lightness = red * 0.3 + green * 0.59 + blue * 0.11;
  const k = contrast.enhancedContrast * saturate(4 * (0.75 - lightness));
  const enhanced = (coverage * (k + 1)) / (coverage * k + 1);
  const intensity = red * 0.25 + green * 0.5 + blue * 0.25;
  const [g0, g1, g2, g3] = DWRITE_GAMMA_RATIOS;
  const corrected =
    enhanced +
    enhanced *
      (1 - enhanced) *
      ((g0 * intensity + g1) * enhanced + (g2 * intensity + g3));
  const mixed = enhanced + (corrected - enhanced) * contrast.alphaCorrection;
  return saturate(mixed);
}

function parseOverride(value: string | null | undefined): TextContrast | null {
  if (value === undefined || value === null || value === "") return null;
  if (value === "off" || value === "0") return NO_TEXT_CONTRAST;
  if (value === "on") return FRACTIONAL_DISPLAY_CONTRAST;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return {
    enhancedContrast: Math.min(amount, 4),
    alphaCorrection: FRACTIONAL_DISPLAY_CONTRAST.alphaCorrection,
  };
}

function saturate(value: number): number {
  return Math.max(0, Math.min(1, value));
}
