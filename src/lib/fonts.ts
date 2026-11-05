const NERD_FONT_CANDIDATES = [
  "JetBrainsMono Nerd Font",
  "JetBrainsMono Nerd Font Mono",
  "JetBrainsMonoNL Nerd Font",
  "FiraCode Nerd Font",
  "FiraCode Nerd Font Mono",
  "FiraMono Nerd Font",
  "MesloLGS NF",
  "MesloLGS Nerd Font",
  "MesloLGS Nerd Font Mono",
  "MesloLGM Nerd Font",
  "MesloLGM Nerd Font Mono",
  "Hack Nerd Font",
  "Hack Nerd Font Mono",
  "CaskaydiaCove Nerd Font",
  "CaskaydiaCove Nerd Font Mono",
  "CaskaydiaMono Nerd Font",
  "Iosevka Nerd Font",
  "Iosevka Term Nerd Font",
  "SauceCodePro Nerd Font",
  "SauceCodePro Nerd Font Mono",
  "SourceCodePro Nerd Font",
  "RobotoMono Nerd Font",
  "UbuntuMono Nerd Font",
  "DejaVuSansM Nerd Font",
  "Hasklug Nerd Font",
];

const SYMBOLS_FAMILY = "Terax Terminal Symbols";
const EXTENDED_SYMBOLS_FAMILY = "Terax Terminal Symbols MDI";

/**
 * Per codepoint, the first face that has the glyph wins. The installed Symbols Nerd
 * Font (complete) outranks the bundled subsets, which guarantee Powerline, Devicons,
 * Font Awesome, Codicons and Material Design icons without any installed font.
 */
const FALLBACK_CHAIN = `"JetBrains Mono", "Symbols Nerd Font Mono", "Symbols Nerd Font", "${SYMBOLS_FAMILY}", "${EXTENDED_SYMBOLS_FAMILY}", SFMono-Regular, Menlo, monospace`;

const PROBE_SAMPLES = ["mmmmmmmmmmlli", "Wim0123\ue0a0\ue718\u{f024b}"];
const PROBE_BASELINES = ["monospace", "serif", "sans-serif"];
const PROBE_SIZE = 72;

let detected: string | null = null;
let monoReady: Promise<void> | null = null;
let probeContext: CanvasRenderingContext2D | null | undefined;
const baselineWidths = new Map<string, number>();
const availability = new Map<string, boolean>();

export function ensureMonoFontsLoaded(): Promise<void> {
  if (monoReady) return monoReady;
  if (typeof document === "undefined" || !document.fonts?.load) {
    monoReady = Promise.resolve();
    return monoReady;
  }
  monoReady = Promise.allSettled([
    document.fonts.load('400 14px "JetBrains Mono"'),
    document.fonts.load('700 14px "JetBrains Mono"'),
    document.fonts.load(`400 14px "${SYMBOLS_FAMILY}"`, "\ue0a0\ue718"),
  ]).then(() => undefined);
  return monoReady;
}

let symbolEpoch = 0;
const symbolListeners = new Set<() => void>();
let extendedSymbols: "idle" | "loading" | "settled" = "idle";

/** Increments each time a lazily loaded symbol face arrives (`useSyncExternalStore` snapshot). */
export function symbolFontEpoch(): number {
  return symbolEpoch;
}

export function subscribeSymbolFonts(listener: () => void): () => void {
  symbolListeners.add(listener);
  return () => symbolListeners.delete(listener);
}

/**
 * True while the Material Design icon face is not yet usable, and starts loading it on
 * the first call. The face is a separate ~350 KB file that only a prompt or tool using
 * those icons ever needs, so it is fetched on demand; consumers draw nothing for such a
 * glyph meanwhile and are told to rebuild their atlases when it arrives (`symbolFontEpoch`).
 * A face that cannot load settles too, so the glyph falls back to the system.
 */
export function extendedSymbolsPending(): boolean {
  if (extendedSymbols === "settled") return false;
  if (extendedSymbols === "loading") return true;
  if (typeof document === "undefined" || !document.fonts?.load) {
    extendedSymbols = "settled";
    return false;
  }
  extendedSymbols = "loading";
  const settle = () => {
    extendedSymbols = "settled";
    symbolEpoch += 1;
    for (const listener of [...symbolListeners]) listener();
  };
  document.fonts
    .load(`400 14px "${EXTENDED_SYMBOLS_FAMILY}"`, "\u{f024b}")
    .then(settle, settle);
  return true;
}

export function resolveFontFamily(userInput: string): string {
  const name = userInput.trim();
  if (!name) return detectMonoFontFamily();
  // A comma means the user gave a full stack; otherwise quote the single family.
  // Strip any quotes first so a stray quote can't produce a malformed token.
  const head = name.includes(",") ? name : quoteFamily(name);
  return `${head}, ${FALLBACK_CHAIN}`;
}

function quoteFamily(name: string): string {
  return `"${name.replace(/['"]/g, "")}"`;
}

/**
 * Whether the canvas can use an installed family. `document.fonts.check` only knows
 * fonts declared with `@font-face` (WKWebView reports false for installed ones), so the
 * family is detected by its effect: any probe string that measures differently from the
 * generic family alone means the family exists. Several probes and baselines keep a font
 * whose metrics happen to equal one generic family from being missed.
 */
export function isFontAvailable(family: string): boolean {
  const name = family.trim();
  if (!name) return false;
  const known = availability.get(name);
  if (known !== undefined) return known;
  const context = measurementContext();
  if (!context) return false;
  let available = false;
  const quoted = name.includes(",") ? name : quoteFamily(name);
  for (const baseline of PROBE_BASELINES) {
    for (const sample of PROBE_SAMPLES) {
      const key = `${baseline}|${sample}`;
      let base = baselineWidths.get(key);
      if (base === undefined) {
        context.font = `${PROBE_SIZE}px ${baseline}`;
        base = context.measureText(sample).width;
        baselineWidths.set(key, base);
      }
      context.font = `${PROBE_SIZE}px ${quoted}, ${baseline}`;
      if (context.measureText(sample).width !== base) {
        available = true;
        break;
      }
    }
    if (available) break;
  }
  availability.set(name, available);
  return available;
}

export function detectMonoFontFamily(): string {
  if (detected) return detected;
  if (typeof document === "undefined") {
    detected = FALLBACK_CHAIN;
    return detected;
  }
  const font = NERD_FONT_CANDIDATES.find(isFontAvailable);
  detected = font ? `"${font}", ${FALLBACK_CHAIN}` : FALLBACK_CHAIN;
  return detected;
}

function measurementContext(): CanvasRenderingContext2D | null {
  if (probeContext !== undefined) return probeContext;
  probeContext =
    typeof document === "undefined"
      ? null
      : document.createElement("canvas").getContext("2d");
  return probeContext;
}
