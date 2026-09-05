const NERD_FONT_CANDIDATES = [
  "JetBrainsMono Nerd Font",
  "JetBrainsMono Nerd Font Mono",
  "JetBrainsMonoNL Nerd Font",
  "FiraCode Nerd Font",
  "FiraCode Nerd Font Mono",
  "MesloLGS NF",
  "MesloLGM Nerd Font",
  "Hack Nerd Font",
  "Hack Nerd Font Mono",
  "CaskaydiaCove Nerd Font",
  "CaskaydiaMono Nerd Font",
  "Iosevka Nerd Font",
  "Iosevka Term Nerd Font",
  "SauceCodePro Nerd Font",
  "Hasklug Nerd Font",
];

const FALLBACK_CHAIN = '"JetBrains Mono", SFMono-Regular, Menlo, monospace';

/** Probe text whose width differs across most mono families vs generic monospace. */
const CANVAS_PROBE = "mmmmmmmmmmlliABCDEF@#$%Ww";

let detected: string | null = null;
let monoReady: Promise<void> | null = null;

export function ensureMonoFontsLoaded(): Promise<void> {
  if (monoReady) return monoReady;
  if (typeof document === "undefined" || !document.fonts?.load) {
    monoReady = Promise.resolve();
    return monoReady;
  }
  monoReady = Promise.allSettled([
    document.fonts.load('400 14px "JetBrains Mono"'),
    document.fonts.load('700 14px "JetBrains Mono"'),
  ]).then(() => undefined);
  return monoReady;
}

export function resolveFontFamily(userInput: string): string {
  const name = userInput.trim();
  if (!name) return detectMonoFontFamily();
  // A comma means the user gave a full stack; otherwise quote the single family.
  // Strip any quotes first so a stray quote can't produce a malformed token.
  const head = name.includes(",")
    ? name
    : `"${name.replace(/['"]/g, "")}"`;
  return `${head}, ${FALLBACK_CHAIN}`;
}

/**
 * WKWebView's `document.fonts.check()` returns false for OS-installed fonts that
 * are not `@font-face`-registered (#820). Canvas `measureText` still sees them:
 * compare `"Family", monospace` vs bare `monospace` — a real install shifts width.
 */
function canvasFontInstalled(family: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.font = `72px monospace`;
    const baseline = ctx.measureText(CANVAS_PROBE).width;
    ctx.font = `72px "${family}", monospace`;
    const withFamily = ctx.measureText(CANVAS_PROBE).width;
    return withFamily !== baseline;
  } catch {
    return false;
  }
}

function fontsCheckInstalled(family: string): boolean {
  if (typeof document === "undefined" || !document.fonts?.check) return false;
  try {
    return document.fonts.check(`12px "${family}"`);
  } catch {
    return false;
  }
}

/** True when the family is available to the renderer (FontFaceSet or canvas). */
export function isMonoFontInstalled(family: string): boolean {
  if (fontsCheckInstalled(family)) return true;
  return canvasFontInstalled(family);
}

export function detectMonoFontFamily(): string {
  if (detected) return detected;
  if (typeof document === "undefined") {
    detected = FALLBACK_CHAIN;
    return detected;
  }
  for (const f of NERD_FONT_CANDIDATES) {
    if (isMonoFontInstalled(f)) {
      detected = `"${f}", ${FALLBACK_CHAIN}`;
      return detected;
    }
  }
  detected = FALLBACK_CHAIN;
  return detected;
}

/** Test-only: clear the memoized auto-detect result. */
export function resetDetectedMonoFontFamily(): void {
  detected = null;
}