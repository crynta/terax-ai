import { IS_WINDOWS } from "@/lib/platform";

// Quote only when needed, so a clean path stays verbatim for bracketed paste
// (Claude resolves an image path to "[Image #N]"); spaced/special paths quote.
const SAFE_PATH = /^[A-Za-z0-9_@%+=:,./\\-]+$/;

export function quoteShellPath(p: string): string {
  if (SAFE_PATH.test(p)) return p;
  if (IS_WINDOWS) return `"${p.replace(/"/g, '""')}"`;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

export function formatDroppedPaths(paths: string[]): string {
  return `${paths.map(quoteShellPath).join(" ")} `;
}
