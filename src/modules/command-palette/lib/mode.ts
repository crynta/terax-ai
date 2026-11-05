import type { PaletteBase, PaletteMode } from "../types";

export type ParsedQuery = {
  mode: PaletteMode;
  term: string;
  raw: string;
};

const PREFIXES: ReadonlyArray<{
  sigil: string;
  mode: PaletteMode;
  bases: readonly PaletteBase[];
}> = [
  { sigil: ">", mode: "history", bases: ["commands", "files"] },
  { sigil: "#", mode: "content", bases: ["commands", "files"] },
  { sigil: "?", mode: "help", bases: ["commands", "files"] },
  { sigil: "/", mode: "files", bases: ["commands"] },
];

/**
 * `base` is what a query without a sigil means: Cmd+Shift+P opens the palette
 * on commands, Cmd+P on files. A sigil switches mode in either.
 */
export function parseQuery(
  raw: string,
  base: PaletteBase = "commands",
): ParsedQuery {
  for (const { sigil, mode, bases } of PREFIXES) {
    if (raw.startsWith(sigil) && bases.includes(base)) {
      return { mode, term: raw.slice(sigil.length).trim(), raw };
    }
  }
  return { mode: base, term: raw.trim(), raw };
}

export const MODE_HINTS: ReadonlyArray<{
  sigil: string;
  label: string;
  bases: readonly PaletteBase[];
}> = [
  { sigil: "/", label: "Go to file", bases: ["commands"] },
  { sigil: ">", label: "Search command history", bases: ["commands", "files"] },
  { sigil: "#", label: "Find text in files", bases: ["commands", "files"] },
];
