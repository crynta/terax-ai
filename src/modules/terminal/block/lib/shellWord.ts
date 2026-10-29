/** How far back a word may start, matching CodeMirror's own match window. */
const MAX_WORD_SCAN = 250;
/** Characters completion treats as part of a word; the rest separate words. */
const WORD_CHAR = /[\w./+-]/;

export type ShellWord = { start: number; text: string };

/**
 * The shell word the cursor sits in, given the text from the start of the line
 * up to the cursor. A word ends at whitespace or shell punctuation unless a
 * backslash escape keeps it together (`My\ Folder`). On Windows completion
 * writes quoted names instead (`'My Folder'/`), so a quoted run concatenates
 * into the word exactly as the shell reads it — a closed run plus the tail
 * after it, or a still-open run that reaches the cursor.
 */
export function shellWordBefore(
  lineBeforeCursor: string,
  windows: boolean,
): ShellWord {
  const from = Math.max(0, lineBeforeCursor.length - MAX_WORD_SCAN);
  let start = from;
  let quote: string | null = null;
  for (let i = from; i < lineBeforeCursor.length; i++) {
    const c = lineBeforeCursor[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "\\") {
      i++; // the escaped character belongs to this word
      continue;
    }
    if (windows && (c === "'" || c === '"')) {
      quote = c;
      continue;
    }
    if (WORD_CHAR.test(c)) continue;
    start = i + 1;
  }
  return { start, text: lineBeforeCursor.slice(start) };
}
