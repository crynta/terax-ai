/**
 * A filesystem path written two ways can name one file: `D:\a\b` from the
 * native side, `d:/a/b` from a decoded file:// URI. Tabs, dedupe and hit
 * reuse must not multiply tabs over the spelling, so comparisons go through
 * this canonical form — separators to `/`, drive letter uppercased. The rest
 * of the path keeps its case: only the drive letter is case-insensitive by
 * convention, not the filesystem.
 */
export function normalizeFsPath(path: string): string {
  const p = path.replace(/\\/g, "/");
  return /^[a-z]:\//.test(p) ? p[0].toUpperCase() + p.slice(1) : p;
}

export function sameFsPath(a: string, b: string): boolean {
  return normalizeFsPath(a) === normalizeFsPath(b);
}
