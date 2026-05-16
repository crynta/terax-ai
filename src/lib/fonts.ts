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

export const MONO_FONT_FAMILIES = [
  { value: "", label: "Default (auto-detected)" },
  { value: "JetBrains Mono", label: "JetBrains Mono" },
  { value: "Fira Code", label: "Fira Code" },
  { value: "Fira Code Retina", label: "Fira Code Retina" },
  { value: "Source Code Pro", label: "Source Code Pro" },
  { value: "Hack", label: "Hack" },
  { value: "Iosevka", label: "Iosevka" },
  { value: "Iosevka Term", label: "Iosevka Term" },
  { value: "MesloLGS NF", label: "MesloLGS NF" },
  { value: "Cascadia Code", label: "Cascadia Code" },
  { value: "Cascadia Mono", label: "Cascadia Mono" },
  { value: "Inconsolata", label: "Inconsolata" },
  { value: "Monaspace Neon", label: "Monaspace Neon" },
  { value: "Monaspace Argon", label: "Monaspace Argon" },
  { value: "Monaspace Xenon", label: "Monaspace Xenon" },
  { value: "Monaspace Radon", label: "Monaspace Radon" },
  { value: "Monaspace Krypton", label: "Monaspace Krypton" },
  { value: "SFMono-Regular", label: "SF Mono" },
  { value: "Menlo", label: "Menlo" },
  { value: "monospace", label: "monospace" },
];

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
