import { IS_WINDOWS } from "@/lib/platform";

/**
 * A shell word ends at whitespace, except where shell syntax that belongs to
 * the name keeps it together: a backslash escape (`My\ Folder`) as completion
 * writes it on POSIX, or a quoted run (`'My Folder'`) as it does on Windows.
 * Without this a just-completed `My\ Folder/` would be re-read as `Folder/`.
 */
export const SHELL_WORD_RE = IS_WINDOWS
  ? /(?:[\w./+-]|\\[\s\S]|'[^'\n]*'?|"[^"\n]*"?)*/
  : /(?:[\w./+-]|\\[\s\S])*/;
