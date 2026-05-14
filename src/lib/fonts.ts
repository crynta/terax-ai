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

export const TERMINAL_FONT_FACES = [
  "jetbrains-mono",
  "fira-code",
  "roboto-mono",
] as const;
export type TerminalFontFaceId = (typeof TERMINAL_FONT_FACES)[number];

export const TERMINAL_FONT_FACE_LABELS: Record<TerminalFontFaceId, string> = {
  "jetbrains-mono": "JetBrains Mono",
  "fira-code": "Fira Code",
  "roboto-mono": "Roboto Mono",
};

const TERMINAL_FONT_FACE_FAMILIES: Record<TerminalFontFaceId, string> = {
  "jetbrains-mono": '"JetBrains Mono", monospace',
  "fira-code": '"Fira Code", monospace',
  "roboto-mono": '"Roboto Mono", monospace',
};

export const TERMINAL_FONT_FACE_DEFAULT: TerminalFontFaceId = "jetbrains-mono";

export function terminalFontFamily(face: TerminalFontFaceId): string {
  return (
    TERMINAL_FONT_FACE_FAMILIES[face] ??
    TERMINAL_FONT_FACE_FAMILIES[TERMINAL_FONT_FACE_DEFAULT]
  );
}

let detected: string | null = null;

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
