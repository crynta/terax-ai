import { IS_WINDOWS } from "@/lib/platform";

/** Shell-quote an absolute path for pasting into a live terminal prompt. */
export function quoteShellPath(p: string): string {
  if (IS_WINDOWS) return `"${p.replace(/"/g, '""')}"`;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/** Joined, shell-quoted paths with a trailing space so the cursor lands
 * ready for the next argument. */
export function formatDroppedPaths(paths: string[]): string {
  return `${paths.map(quoteShellPath).join(" ")} `;
}
