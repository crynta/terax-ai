/**
 * A prompt split for display: plain text, pre-formatted blocks that must keep
 * their columns (a fenced block, a box diagram, an aligned table) and the
 * texts the user pasted.
 */
export type PromptSegment =
  | { kind: "text"; text: string }
  | { kind: "pre"; text: string }
  | { kind: "paste"; text: string; pre: boolean };

/** Box-drawing, block and geometric-shape glyphs: the marks of a diagram. */
const DIAGRAM_GLYPH = /[─-◿]/;
/** Two or more spaces between words: text lined up in columns. */
const ALIGNED = /\S {2,}\S/;
const FENCE = /^\s*(```|~~~)/;

/** True when `text` only reads right on a fixed grid. */
export function looksPreformatted(text: string): boolean {
  if (DIAGRAM_GLYPH.test(text)) return true;
  const lines = text.split("\n");
  return lines.filter((line) => ALIGNED.test(line)).length >= 2;
}

function pushText(out: PromptSegment[], text: string): void {
  const last = out[out.length - 1];
  if (last?.kind === "text") last.text = `${last.text}\n\n${text}`;
  else out.push({ kind: "text", text });
}

/** Splits text that holds no paste into text and pre-formatted blocks. */
function splitBlocks(chunk: string, out: PromptSegment[]): void {
  const lines = chunk.split("\n");
  let paragraph: string[] = [];
  const flush = () => {
    const text = paragraph.join("\n");
    paragraph = [];
    if (!text.trim()) return;
    if (looksPreformatted(text)) out.push({ kind: "pre", text });
    else pushText(out, text.trim());
  };
  for (let i = 0; i < lines.length; i++) {
    const fence = FENCE.exec(lines[i]);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) {
        body.push(lines[i]);
        i++;
      }
      if (body.join("").trim()) out.push({ kind: "pre", text: body.join("\n") });
      continue;
    }
    if (!lines[i].trim()) flush();
    else paragraph.push(lines[i]);
  }
  flush();
}

/** `prompt` as display segments; `pastes` are found in order, verbatim. */
export function promptSegments(
  prompt: string,
  pastes: readonly string[] = [],
): PromptSegment[] {
  const out: PromptSegment[] = [];
  let cursor = 0;
  for (const paste of pastes) {
    const at = prompt.indexOf(paste, cursor);
    if (at < 0) continue;
    splitBlocks(prompt.slice(cursor, at), out);
    out.push({ kind: "paste", text: paste, pre: looksPreformatted(paste) });
    cursor = at + paste.length;
  }
  splitBlocks(prompt.slice(cursor), out);
  return out;
}

/** Lines a cut pre-formatted block keeps, so a diagram is never a sliver. */
const MIN_PRE_LINES = 12;

/**
 * The segments that fit in about `budget` characters, cutting text mid-way
 * and pre-formatted blocks only at line ends; `clipped` when any was cut.
 */
export function clampSegments(
  segments: readonly PromptSegment[],
  budget: number,
): { shown: PromptSegment[]; clipped: boolean } {
  const shown: PromptSegment[] = [];
  let left = budget;
  for (const segment of segments) {
    if (left <= 0) return { shown, clipped: true };
    if (segment.text.length <= left) {
      shown.push(segment);
      left -= segment.text.length;
      continue;
    }
    if (segment.kind === "text") {
      shown.push({ kind: "text", text: `${segment.text.slice(0, left).trimEnd()}…` });
    } else {
      const lines = segment.text.split("\n");
      let keep = 0;
      let used = 0;
      while (keep < lines.length && used + lines[keep].length < left) {
        used += lines[keep].length + 1;
        keep++;
      }
      keep = Math.max(keep, Math.min(MIN_PRE_LINES, lines.length));
      shown.push({ ...segment, text: lines.slice(0, keep).join("\n") });
    }
    return { shown, clipped: true };
  }
  return { shown, clipped: false };
}

/** A prompt as Markdown: pre-formatted blocks fenced, so they keep their grid. */
export function promptMarkdown(
  prompt: string,
  pastes: readonly string[] = [],
): string {
  return promptSegments(prompt, pastes)
    .map((segment) =>
      segment.kind === "text" || (segment.kind === "paste" && !segment.pre)
        ? segment.text
        : `\`\`\`text\n${segment.text}\n\`\`\``,
    )
    .join("\n\n");
}
