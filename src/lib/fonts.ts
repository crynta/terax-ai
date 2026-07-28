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
const WEIGHTS = [400, 700] as const;

let detected: string | null = null;
let monoReady: Promise<void> | null = null;

function canLoadFonts(): boolean {
  return typeof document !== "undefined" && !!document.fonts?.load;
}

function loadFamilyWeights(family: string): Promise<void> {
  return Promise.allSettled(
    WEIGHTS.map((w) => document.fonts.load(`${w} 14px "${family}"`)),
  ).then(() => undefined);
}

// Blank = auto-detected font; a comma = a full stack — neither is a single
// local family. Otherwise strip quotes so a stray quote can't produce a
// malformed token.
function parseSingleFamily(userInput: string): string | null {
  const name = userInput.trim();
  if (!name || name.includes(",")) return null;
  return name.replace(/['"]/g, "");
}

export function ensureMonoFontsLoaded(): Promise<void> {
  if (monoReady) return monoReady;
  monoReady = canLoadFonts()
    ? loadFamilyWeights("JetBrains Mono")
    : Promise.resolve();
  return monoReady;
}

const registeredLocal = new Map<string, Promise<void>>();

// macOS WKWebView won't expose a system-installed font to the canvas/WebGL
// glyph-atlas rasterizer unless it's a registered FontFace — only the DOM
// renderer can reach raw system fonts (see #820). Declaring an @font-face that
// points at the installed font via local() registers it in the FontFaceSet
// without bundling any file, so the WebGL renderer resolves it the same way it
// already resolves the bundled JetBrains Mono. Resolves once the faces have
// loaded, so callers can rebuild stale glyph atlases afterwards.
export function registerLocalFont(userInput: string): Promise<void> {
  const family = parseSingleFamily(userInput);
  if (!family || !canLoadFonts()) return Promise.resolve();
  let ready = registeredLocal.get(family);
  if (!ready) {
    const STYLE_ID = "terax-local-fonts";
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent += WEIGHTS.map(
      (w) =>
        `@font-face{font-family:"${family}";font-weight:${w};src:local("${family}");}`,
    ).join("");
    // With an @font-face now backing the family, this actually loads it into
    // the FontFaceSet.
    ready = loadFamilyWeights(family);
    registeredLocal.set(family, ready);
  }
  return ready;
}

export function resolveFontFamily(userInput: string): string {
  const name = userInput.trim();
  if (!name) return detectMonoFontFamily();
  const single = parseSingleFamily(name);
  const head = single ? `"${single}"` : name;
  return `${head}, ${FALLBACK_CHAIN}`;
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
