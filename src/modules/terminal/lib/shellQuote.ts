import { IS_WINDOWS } from "@/lib/platform";

/** Chars that are always safe unquoted in both cmd/PowerShell and POSIX shells. */
const SAFE_CHARS = /^[A-Za-z0-9_\-+.,/:@=%]+$/;

/**
 * Shell-quote a single token (typically a filesystem path) so it pastes
 * cleanly into an interactive shell.
 *
 * POSIX: wraps in single quotes; embedded `'` is handled with the
 * classic `'\''` close-reopen trick.
 *
 * Windows: wraps in double quotes; embedded `"` is doubled, which is
 * what both cmd.exe and PowerShell accept for literal quotes inside a
 * double-quoted string.
 *
 * Tokens made exclusively of safe characters are returned as-is so
 * common paths like `/home/user/file.txt` don't gain visual noise.
 */
export function shellQuote(token: string, windows: boolean = IS_WINDOWS): string {
  if (!token) return windows ? '""' : "''";
  if (SAFE_CHARS.test(token)) return token;

  if (windows) {
    return `"${token.replace(/"/g, '""')}"`;
  }
  return `'${token.replace(/'/g, `'\\''`)}'`;
}

/** Quote a list of paths and join them with spaces. */
export function shellQuoteAll(tokens: readonly string[], windows: boolean = IS_WINDOWS): string {
  return tokens.map((t) => shellQuote(t, windows)).join(" ");
}
