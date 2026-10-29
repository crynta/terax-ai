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
    // Decode quoted runs before splitting on separators. Splitting first
    // breaks quotes that span a separator (`'My Folder/sub'`) and leaves a
    // stray apostrophe behind; decoding whole runs first unescapes the name
    // intact. Completion in progress may still be missing the closing quote,
    // so a still-open run keeps everything after its opening quote.
    const segments: string[] = [];
    let segment = "";
    let quote: string | null = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) {
          if (text[i + 1] === quote) {
            // Escaped quote inside a quoted literal.
            segment += quote;
            i++;
          } else {
            quote = null;
          }
        } else {
          segment += c;
        }
        continue;
      }
      if (c === "'") {
        quote = "'";
        continue;
      }
      if (c === "/") {
        segments.push(segment);
        segment = "";
        continue;
      }
      segment += c;
    }
    segments.push(segment);
    return segments.join("/");
  }
  return text.replace(/\\([\s\S])/g, "$1");
}
