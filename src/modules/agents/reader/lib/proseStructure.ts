/**
 * Document structure for Claude's replies in the Reader: bold-only paragraphs
 * become section headings, and replies with several headings split into
 * sections. Only Markdown markup changes; the words are never rewritten.
 */

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
/** A paragraph that is nothing but one bold span, optionally ending in ":". */
const BOLD_ONLY = /^\s{0,3}(\*\*|__)(?=\S)((?:(?!\1).)+?)(?<=\S)\1\s*(:?)\s*$/;
const ATX_HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
/** Lines that start a new block, so a bold line before them stands alone. */
const BLOCK_START = /^\s{0,3}(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||`{3,}|~{3,})/;
const SECTION_LEVELS = new Set([2, 3]);

function blank(line: string | undefined): boolean {
  return line === undefined || line.trim() === "";
}

/** Indices of lines inside fenced code blocks (fence lines included). */
function fencedLines(lines: readonly string[]): Set<number> {
  const inside = new Set<number>();
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const match = FENCE.exec(line);
    if (fence) {
      inside.add(i);
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length)
        fence = null;
      return;
    }
    if (match) {
      fence = match[1];
      inside.add(i);
    }
  });
  return inside;
}

/**
 * The text of a pseudo-heading on `lines[i]`, or null. It must be its own
 * paragraph: a blank line (or a heading, or the start) before it, and a blank
 * line, the end, or a new block after it.
 */
export function pseudoHeadingAt(
  lines: readonly string[],
  i: number,
): string | null {
  const match = BOLD_ONLY.exec(lines[i] ?? "");
  if (!match) return null;
  const before = lines[i - 1];
  if (!blank(before) && !ATX_HEADING.test(before ?? "")) return null;
  const after = lines[i + 1];
  if (!blank(after) && !BLOCK_START.test(after ?? "")) return null;
  const text = `${match[2].trim()}${match[3]}`.replace(/:$/, "");
  return text || null;
}

/** `markdown` with bold-only paragraphs promoted to `###` headings. */
export function promoteBoldHeadings(markdown: string): string {
  const lines = markdown.split("\n");
  const fenced = fencedLines(lines);
  const out = lines.map((line, i) => {
    if (fenced.has(i)) return line;
    const heading = pseudoHeadingAt(lines, i);
    return heading ? `### ${heading}` : line;
  });
  // A promoted heading directly followed by a list still needs a blank line
  // in some renderers; add one so the list stays a list.
  const spaced: string[] = [];
  out.forEach((line, i) => {
    spaced.push(line);
    if (
      line.startsWith("### ") &&
      line !== lines[i] &&
      !blank(out[i + 1]) &&
      out[i + 1] !== undefined
    ) {
      spaced.push("");
    }
  });
  return spaced.join("\n");
}

export type ProseSection = { heading: string; body: string };

export type ProseStructure = {
  /** Markdown before the first section heading. */
  preamble: string;
  /** Empty unless the reply has at least two section headings. */
  sections: ProseSection[];
};

/**
 * Splits (already promoted) Markdown at its `##`/`###` headings. Replies with
 * fewer than two such headings stay whole, in `preamble`.
 */
export function splitSections(markdown: string): ProseStructure {
  const lines = markdown.split("\n");
  const fenced = fencedLines(lines);
  const starts: { line: number; heading: string }[] = [];
  lines.forEach((line, i) => {
    if (fenced.has(i)) return;
    const match = ATX_HEADING.exec(line);
    if (match && SECTION_LEVELS.has(match[1].length) && match[2]) {
      starts.push({ line: i, heading: match[2] });
    }
  });
  if (starts.length < 2) return { preamble: markdown.trim(), sections: [] };
  const sections = starts.map((start, n) => ({
    heading: start.heading,
    body: lines
      .slice(start.line + 1, starts[n + 1]?.line ?? lines.length)
      .join("\n")
      .trim(),
  }));
  return {
    preamble: lines.slice(0, starts[0].line).join("\n").trim(),
    sections,
  };
}

/** Promotes pseudo-headings, then splits into sections. */
export function proseStructure(markdown: string): ProseStructure {
  return splitSections(promoteBoldHeadings(markdown));
}

const WORDS_PER_MINUTE = 230;
export const READ_TIME_MIN_WORDS = 300;

/** Words outside fenced code. */
export function proseWordCount(markdown: string): number {
  const lines = markdown.split("\n");
  const fenced = fencedLines(lines);
  let words = 0;
  lines.forEach((line, i) => {
    if (fenced.has(i)) return;
    words += line.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  });
  return words;
}

/** "N min read" for replies long enough to need it, else null. */
export function readTimeLabel(markdown: string): string | null {
  const words = proseWordCount(markdown);
  if (words <= READ_TIME_MIN_WORDS) return null;
  return `${Math.max(1, Math.round(words / WORDS_PER_MINUTE))} min read`;
}
