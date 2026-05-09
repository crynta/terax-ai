export const DEFAULT_CODE_FONT_FAMILY =
  '"JetBrainsMono Nerd Font", "JetBrainsMono Nerd Font Mono", "JetBrains Mono", SFMono-Regular, Menlo, monospace';

export function getFontLoadFamilies(fontFamily: string): string[] {
  const families = fontFamily
    .split(",")
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)
    .filter((name) => !["monospace", "serif", "sans-serif", "system-ui"].includes(name.toLowerCase()));
  return [...new Set(families)];
}
