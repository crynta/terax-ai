import type { DirEntry } from "./useFileTree";

/** A dotfile is any entry whose name begins with a literal ".". */
export function isDotfile(entry: DirEntry): boolean {
  return entry.name.startsWith(".");
}

/**
 * Split a directory's entries into regular entries and dotfiles, preserving
 * the backend's original ordering within each list.
 */
export function partitionDotfiles(entries: DirEntry[]): {
  regular: DirEntry[];
  dotfiles: DirEntry[];
} {
  const regular: DirEntry[] = [];
  const dotfiles: DirEntry[] = [];
  for (const entry of entries) {
    (isDotfile(entry) ? dotfiles : regular).push(entry);
  }
  return { regular, dotfiles };
}

// A NUL byte cannot appear in a real filename on macOS / Linux / Windows, so a
// path ending in this segment can never collide with a real filesystem path.
const DOTFILES_GROUP_SEGMENT = "\0dotfiles";

/** The synthetic expand/collapse key for a directory's dotfiles group node. */
export function dotfilesGroupKey(parentPath: string): string {
  return parentPath.endsWith("/")
    ? `${parentPath}${DOTFILES_GROUP_SEGMENT}`
    : `${parentPath}/${DOTFILES_GROUP_SEGMENT}`;
}

/** True if `path` is a synthetic dotfiles-group key (not a real filesystem path). */
export function isDotfilesGroupKey(path: string): boolean {
  return path.endsWith(DOTFILES_GROUP_SEGMENT);
}
