import { IS_WINDOWS } from "./platform";

/** Characters a POSIX shell treats as syntax when a path is pasted unquoted. */
const POSIX_SHELL_SPECIAL = /([\\\s"'$`!&;|<>()[\]{}*?#~])/g;
/** Windows paths made only of these characters paste as-is in cmd/PowerShell. */
const WINDOWS_UNQUOTED_SAFE = /^[A-Za-z0-9_.:\\/~+-]+$/;

export function quoteShellArg(value: string, windows = IS_WINDOWS): string {
  if (windows) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Neutralize shell syntax in a path so it survives a paste into the terminal
 * as a single argument (`My Folder` would otherwise split into two).
 * POSIX shells take a backslash escape. Windows treats `\` as a separator, so
 * it gets a single-quoted literal instead: PowerShell is the default Windows
 * shell here and expands `$`/backtick inside double quotes, while a
 * single-quoted string is entirely literal apart from a doubled `'`.
 */
export function escapeForShell(
  path: string,
  isWindows: boolean = IS_WINDOWS,
): string {
  if (!path) return path;
  if (isWindows) {
    return WINDOWS_UNQUOTED_SAFE.test(path)
      ? path
      : `'${path.replace(/'/g, "''")}'`;
  }
  return path.replace(POSIX_SHELL_SPECIAL, "\\$1");
}

/**
 * Inverse of `escapeForShell` for text that was escaped a segment at a time
 * (path completion emits one escaped name per segment), so completion matches
 * the entry names on disk and reads the directory they actually name.
 */
export function unescapeForShell(
  text: string,
  isWindows: boolean = IS_WINDOWS,
): string {
  if (!text) return text;
  if (isWindows) {
    return text
      .split("/")
      .map((segment) => {
        if (!segment.startsWith("'")) return segment;
        // Completion in progress may still be missing the closing quote.
        const body = segment.endsWith("'")
          ? segment.slice(1, -1)
          : segment.slice(1);
        return body.replace(/''/g, "'");
      })
      .join("/");
  }
  return text.replace(/\\([\s\S])/g, "$1");
}
