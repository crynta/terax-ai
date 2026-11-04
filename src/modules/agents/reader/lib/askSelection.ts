/**
 * "Ask Claude" on a selection in the Reader: turns the selected text into a
 * Markdown block for the composer and places the floating pill.
 */

export type SelectionSource = {
  text: string;
  /** Selected inside a code block or tool output. */
  code: boolean;
  /** The code block's language label, when known. */
  lang: string | null;
};

/** Shortest selection worth offering "Ask Claude" for. */
export const ASK_MIN_CHARS = 2;

/** Labels that carry no language for a fence. */
const PLAIN_LANGS = new Set([
  "",
  "text",
  "plain",
  "plaintext",
  "txt",
  "output",
]);

/** A fence longer than any backtick run in `text`, so the block can't close early. */
function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * The composer block for a selection: code as a fenced block (with its
 * language when known), anything else as a `> ` quote. Ends with a blank line
 * so the question can be typed straight after. Empty when too short.
 */
export function selectionToQuote(source: SelectionSource): string {
  const text = source.text.replace(/\r\n?/g, "\n").replace(/ /g, " ");
  if (text.trim().length < ASK_MIN_CHARS) return "";
  if (source.code) {
    const body = text.replace(/^\n+|\s+$/g, "");
    const fence = fenceFor(body);
    const lang = (source.lang ?? "").trim().toLowerCase();
    const info = PLAIN_LANGS.has(lang) ? "" : lang;
    return `${fence}${info}\n${body}\n${fence}\n\n`;
  }
  const lines = text
    .trim()
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""));
  const quoted: string[] = [];
  for (const line of lines) {
    const blank = line.trim() === "";
    // Collapse runs of blank lines to a single quoted gap.
    if (blank && quoted[quoted.length - 1] === ">") continue;
    quoted.push(blank ? ">" : `> ${line}`);
  }
  return `${quoted.join("\n")}\n\n`;
}

/** The draft with `block` appended after a blank line (or alone when empty). */
export function appendBlock(draft: string, block: string): string {
  if (!block) return draft;
  const trimmed = draft.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

export type Box = { left: number; top: number; right: number; bottom: number };

/** Gap between the selection and the pill, and the pill's margin from edges. */
const PILL_GAP = 8;
const PILL_MARGIN = 6;

/**
 * Where the pill goes (relative to `bounds`): centred above the end of the
 * selection, below it when there's no room above, always inside `bounds`.
 */
export function placeAskPill(
  selection: Box,
  bounds: Box,
  pill: { width: number; height: number },
): { left: number; top: number } {
  const centre = selection.right - pill.width / 2;
  const minLeft = bounds.left + PILL_MARGIN;
  const maxLeft = bounds.right - pill.width - PILL_MARGIN;
  const left = Math.max(minLeft, Math.min(maxLeft, centre));
  let top = selection.top - pill.height - PILL_GAP;
  if (top < bounds.top + PILL_MARGIN) top = selection.bottom + PILL_GAP;
  top = Math.min(top, bounds.bottom - pill.height - PILL_MARGIN);
  return { left: left - bounds.left, top: top - bounds.top };
}
