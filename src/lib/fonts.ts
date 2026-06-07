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

export function detectMonoFontFamily(): string {
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

/** Build the xterm/CSS `font-family` value for a user-entered custom font name.
 *  Quotes a bare family name (so multi-word names like "CaskaydiaCove Nerd Font
 *  Mono" resolve as one family) and appends the mono fallback chain so an
 *  unrecognized name still renders. Mirrors {@link detectMonoFontFamily}. */
export function resolveFontFamily(custom: string): string {
  const name = custom.trim();
  if (!name) return detectMonoFontFamily();
  if (name.includes(",")) return name;
  const quoted = name.startsWith('"') ? name : `"${name}"`;
  return `${quoted}, ${FALLBACK_CHAIN}`;
}

/** Force WebKit to load a custom (system-installed) family before xterm measures
 *  cell metrics. Without this, the first measurement uses fallback metrics: the
 *  glyph advance then mismatches the cell width and text renders mis-spaced. */
export function loadFontFamily(custom: string): Promise<void> {
  const name = custom.trim();
  if (
    !name ||
    name.includes(",") ||
    typeof document === "undefined" ||
    !document.fonts?.load
  ) {
    return Promise.resolve();
  }
  const family = name.startsWith('"') ? name : `"${name}"`;
  try {
    return Promise.allSettled([
      document.fonts.load(`400 14px ${family}`),
      document.fonts.load(`700 14px ${family}`),
    ]).then(() => undefined);
  } catch {
    return Promise.resolve();
  }
}
