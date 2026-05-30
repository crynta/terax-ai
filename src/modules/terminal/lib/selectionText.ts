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

/**
 * Strong signal: the last cell has actual content (not a space).
 * Means the program wrote characters all the way to the column boundary.
 * Also catches wide-char continuation cells (width=0).
 */
function lastCellIsContent(line: IBufferLine, cols: number): boolean {
  if (cols <= 0) return false;
  const cell = line.getCell(cols - 1);
  if (!cell) return false;
  return cell.getCode() > 32 || cell.getWidth() === 0;
}

/**
 * Soft signal: the trimmed text fills most of the terminal width.
 * Catches word-boundary wraps where trailing spaces were trimmed by
 * translateToString(true). Threshold at ~60% to allow for significant
 * trailing whitespace while rejecting short lines.
 */
function lineMostlyFillsCols(cw: number, cols: number): boolean {
  return cols > 0 && cw >= cols * 0.6;
}

export function getSelectionText(term: Terminal): string | null {
  const pos = term.getSelectionPosition();
  if (!pos) return null;

  const { start, end } = pos;
  const buf = term.buffer.active;
  const cols = term.cols;

  const parts: {
    text: string;
    wrapped: boolean;
    fullCw: number;
    lastCellContent: boolean;
    rawText: string;
  }[] = [];

  for (let y = start.y; y <= end.y; y++) {
    const line = buf.getLine(y);
    if (!line) continue;

    let text: string;
    let rawText: string;
    if (y === start.y && y === end.y) {
      text = line.translateToString(true, start.x, end.x);
      rawText = line.translateToString(false, start.x, end.x);
    } else if (y === start.y) {
      text = line.translateToString(true, start.x);
      rawText = line.translateToString(false, start.x);
    } else if (y === end.y) {
      text = line.translateToString(true, 0, end.x);
      rawText = line.translateToString(false, 0, end.x);
    } else {
      text = line.translateToString(true);
      rawText = line.translateToString(false);
    }

    const fullLineText = line.translateToString(true);
    parts.push({
      text,
      wrapped: line.isWrapped,
      fullCw: cellWidth(fullLineText),
      lastCellContent: lastCellIsContent(line, cols),
      rawText,
    });
  }

  if (parts.length === 0) return null;

  let result = parts[0].text;
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1];
    const curr = parts[i];

    if (curr.wrapped) {
      result += curr.text;
    } else if (
      !prev.wrapped &&
      (prev.lastCellContent || lineMostlyFillsCols(prev.fullCw, cols)) &&
      curr.text !== "" &&
      !curr.text.startsWith("- ") &&
      !curr.text.startsWith("* ") &&
      !curr.text.startsWith("\u2022 ")
    ) {
      const trimmedPrev = result.trimEnd();
      const trimmedNext = curr.text.trimStart();
      result = trimmedPrev + " " + trimmedNext;
    } else {
      result += "\n" + curr.text;
    }
  }

  return result;
}