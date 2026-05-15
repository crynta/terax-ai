import {
  TERMINAL_FONT_FAMILY_CSS,
  type TerminalFontFamilyId,
} from "@/modules/settings/store";

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

let detected: string | null = null;
let monoReady: Promise<void> | null = null;

const loadedFonts = new Set<string>();

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

/** Loads a specific font family so that document.fonts.check() works reliably. */
export async function loadFontFamily(family: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  if (loadedFonts.has(family)) return;
  loadedFonts.add(family);
  try {
    await Promise.allSettled([
      document.fonts.load(`400 14px ${family}`),
      document.fonts.load(`700 14px ${family}`),
    ]);
  } catch {
    // Ignore font loading errors.
  }
}

export function detectMonoFontFamily(preference?: TerminalFontFamilyId): string {
  // Honor explicit preference
  if (preference && preference !== "auto") {
    const explicit = TERMINAL_FONT_FAMILY_CSS[preference];
    if (explicit) {
      return `${explicit}, ${FALLBACK_CHAIN}`;
    }
  }

  if (detected) return detected;
  if (typeof document === "undefined" || !document.fonts) {
    detected = FALLBACK_CHAIN;
    return detected;
  }
  for (const f of NERD_FONT_CANDIDATES) {
    try {
      if (document.fonts.check(`12px "${f}"`)) {
        detected = `"${f}", ${FALLBACK_CHAIN}`;
        return detected;
      }
    } catch {
      // Some browsers throw on invalid font shorthand; ignore.
    }
  }
  detected = FALLBACK_CHAIN;
  return detected;
}
