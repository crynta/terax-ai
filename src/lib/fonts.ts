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

const registeredLocal = new Set<string>();

// macOS WKWebView won't expose a system-installed font to the canvas/WebGL
// glyph-atlas rasterizer unless it's a registered FontFace — only the DOM
// renderer can reach raw system fonts (see #820). Declaring an @font-face that
// points at the installed font via local() registers it in the FontFaceSet
// without bundling any file, so the WebGL renderer resolves it the same way it
// already resolves the bundled JetBrains Mono. Resolves once the faces have
// loaded, so callers can rebuild stale glyph atlases afterwards.
export function registerLocalFont(userInput: string): Promise<void> {
  const name = userInput.trim();
  // Blank = auto-detected font; a comma = a full stack — neither is a single
  // local family we can register.
  if (!name || name.includes(",")) return Promise.resolve();
  if (typeof document === "undefined" || !document.fonts?.load) {
    return Promise.resolve();
  }
  const family = name.replace(/['"]/g, "");
  if (!registeredLocal.has(family)) {
    registeredLocal.add(family);
    const STYLE_ID = "terax-local-fonts";
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.appendChild(
      document.createTextNode(
        `@font-face{font-family:"${family}";font-weight:400;src:local("${family}");}` +
          `@font-face{font-family:"${family}";font-weight:700;src:local("${family}");}`,
      ),
    );
  }
  // With an @font-face now backing the family, these actually load it into the
  // FontFaceSet (a no-op once cached).
  return Promise.allSettled([
    document.fonts.load(`400 14px "${family}"`),
    document.fonts.load(`700 14px "${family}"`),
  ]).then(() => undefined);
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
