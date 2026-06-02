import type { Terminal, IBufferLine } from "@xterm/xterm";

export function cellWidth(s: string): number {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i)!;
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2329 && cp <= 0x232a) ||
      (cp >= 0x2e80 && cp <= 0x303e) ||
      (cp >= 0x3040 && cp <= 0x3247) ||
      (cp >= 0x3250 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xa000 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff01 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x20000 && cp <= 0x2fffd) ||
      (cp >= 0x30000 && cp <= 0x3fffd)
    ) {
      w += 2;
      if (cp > 0xffff) i++;
    } else {
      w += 1;
    }
  }
  return w;
}

function lineActualWidth(line: IBufferLine): number {
  const text = line.translateToString(true);
  return cellWidth(text);
}

function isParagraphStart(text: string): boolean {
  const t = text.trimStart();
  if (t.startsWith("- ")) return true;
  if (t.startsWith("* ")) return true;
  if (t.startsWith("\u2022 ")) return true;
  if (/^\d+\.\s/.test(t)) return true;
  return false;
}

/**
 * Infer the wrap column W from the selected lines themselves.
 * Soft-wrapped lines end at the same column W (the content area's
 * right edge). Real line breaks end at random columns.
 *
 * Strategy: find the mode width across non-empty lines. The mode
 * must appear at least twice AND be close to cols. Fall back to
 * max width if it equals cols / cols-1 (single very long line).
 *
 * Returns null if no wrap column can be detected (e.g., code blocks
 * with random line lengths). In that case, all line breaks are
 * preserved as real breaks.
 */
export function detectWrapColumn(widths: number[], cols: number): number | null {
  const nonEmpty = widths.filter((w) => w > 0);
  if (nonEmpty.length === 0) return null;

  const counts = new Map<number, number>();
  for (const w of nonEmpty) {
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }

  let modeWidth = 0;
  let modeCount = 0;
  for (const [w, c] of counts) {
    if (c > modeCount || (c === modeCount && w > modeWidth)) {
      modeWidth = w;
      modeCount = c;
    }
  }

  // Mode found: must appear in >= 2 lines and be close to cols
  if (modeCount >= 2 && modeWidth >= cols - 2) {
    return modeWidth;
  }

  // Fallback: max width if a line fills the terminal exactly
  const maxWidth = Math.max(...nonEmpty);
  if (maxWidth >= cols - 1) {
    return maxWidth;
  }

  return null;
}

export function getSelectionText(term: Terminal): string | null {
  const pos = term.getSelectionPosition();
  if (!pos) return null;

  const { start, end } = pos;
  const buf = term.buffer.active;
  const cols = term.cols;

  const parts: {
    text: string;
    fullWidth: number;
    wrapped: boolean;
  }[] = [];

  for (let y = start.y; y <= end.y; y++) {
    const line = buf.getLine(y);
    if (!line) continue;

    let text: string;
    if (y === start.y && y === end.y) {
      text = line.translateToString(true, start.x, end.x);
    } else if (y === start.y) {
      text = line.translateToString(true, start.x);
    } else if (y === end.y) {
      text = line.translateToString(true, 0, end.x);
    } else {
      text = line.translateToString(true);
    }

    parts.push({
      text,
      fullWidth: lineActualWidth(line),
      wrapped: line.isWrapped,
    });
  }

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0].text;

  const W = detectWrapColumn(
    parts.map((p) => p.fullWidth),
    cols,
  );

  let result = parts[0].text;
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1];
    const curr = parts[i];

    if (curr.wrapped) {
      result += curr.text;
    } else if (
      W !== null &&
      prev.fullWidth === W &&
      curr.text.trim() !== "" &&
      !isParagraphStart(curr.text)
    ) {
      result = result.trimEnd() + " " + curr.text.trimStart();
    } else {
      result += "\n" + curr.text;
    }
  }

  return result;
}
