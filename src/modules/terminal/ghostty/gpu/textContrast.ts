/**
 * DirectWrite-style contrast for grayscale antialiasing. The fragment shader
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

export type TextContrastEnvironment = {
  readonly platform: "windows" | "linux" | "mac" | "other";
  readonly scale: number;
  /** `localStorage["terax:terminal-text-contrast"]`: "off", "on" or a number. */
  readonly override?: string | null;
};

/**
 * Chooses the contrast for the current display. Windows and Linux render
 * grayscale glyphs without the system's gamma-aware blending, and any display
 * below 2x leaves thin strokes that look washed out. macOS Retina stays as it
 * was unless explicitly overridden.
 */
export function textContrastFor(env: TextContrastEnvironment): TextContrast {
  const override = parseOverride(env.override);
  if (override) return override;
  const enabled =
    env.platform === "windows" || env.platform === "linux" || env.scale < 2;
  return enabled ? FRACTIONAL_DISPLAY_CONTRAST : NO_TEXT_CONTRAST;
}

export function detectPlatform(
  userAgent: string,
): TextContrastEnvironment["platform"] {
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Android|Linux|X11|CrOS/i.test(userAgent)) return "linux";
  if (/Mac|iPhone|iPad/i.test(userAgent)) return "mac";
  return "other";
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
