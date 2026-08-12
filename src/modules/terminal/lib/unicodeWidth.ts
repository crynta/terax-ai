import { Unicode11Addon } from "@xterm/addon-unicode11";
import type { Terminal } from "@xterm/xterm";

// xterm defaults to Unicode 6 widths, which undercount modern wide emoji
// (colored circles/squares U+1F7E0..1F7EB, etc.) as one cell and shear the row.
export function activateUnicode11(
  term: Pick<Terminal, "loadAddon" | "unicode">,
): void {
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
}
