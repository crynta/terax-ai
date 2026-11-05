import type { ShortcutId } from "@/modules/shortcuts";
import type { TerminalIcon } from "@hugeicons/core-free-icons";

type PaletteIcon = typeof TerminalIcon;

export type PaletteItem = {
  id: string;
  title: string;
  group: string;
  keywords?: string[];
  icon?: PaletteIcon;
  iconUrl?: string;
  shortcutId?: ShortcutId;
  trailing?: string;
  disabledReason?: string;
  run: () => void;
};

/** What a query without a sigil means. */
export type PaletteBase = "commands" | "files";
export type PaletteMode = PaletteBase | "history" | "content" | "help";
export type PaletteInitialMode = PaletteBase | "content";

/** How to open a file picked in the palette. */
export type OpenFileTarget = {
  line?: number;
  column?: number;
  /** Cmd/Ctrl+Enter. Hosts without side-by-side editors treat it as a plain open. */
  side?: boolean;
};
