import type { Terminal, IBufferLine } from "@xterm/xterm";

/**
 * Check whether a buffer line fills the terminal width.
 * Uses the cell-level API: if the last cell was written to by the program
 * (non-null code, or a wide-character continuation cell), the line was
 * hard-wrapped at the column boundary.
 */
function lineFillsCols(line: IBufferLine, cols: number): boolean {
  if (cols <= 0) return false;
  const cell = line.getCell(cols - 1);
  if (!cell) return false;
  // code=0 && width>0 → empty cell, never written to → line is short
  // code>0 → content or space written by program → line fills width
  // width=0 → continuation of wide char in previous cell → line fills width
  return cell.getCode() !== 0 || cell.getWidth() === 0;
}

export function getSelectionText(term: Terminal): string | null {
  const pos = term.getSelectionPosition();
  if (!pos) return null;

  const { start, end } = pos;
  const buf = term.buffer.active;
  const cols = term.cols;

  const parts: { text: string; wrapped: boolean; fillsCols: boolean; rawText: string }[] = [];

  for (let y = start.y; y <= end.y; y++) {
    const line = buf.getLine(y);
    if (!line) continue;

    let text: string;
    let rawFullText: string;
    if (y === start.y && y === end.y) {
      text = line.translateToString(true, start.x, end.x);
      rawFullText = line.translateToString(false, start.x, end.x);
    } else if (y === start.y) {
      text = line.translateToString(true, start.x);
      rawFullText = line.translateToString(false, start.x);
    } else if (y === end.y) {
      text = line.translateToString(true, 0, end.x);
      rawFullText = line.translateToString(false, 0, end.x);
    } else {
      text = line.translateToString(true);
      rawFullText = line.translateToString(false);
    }

    parts.push({
      text,
      wrapped: line.isWrapped,
      fillsCols: lineFillsCols(line, cols),
      rawText: rawFullText,
    });
  }

  if (parts.length === 0) return null;

  let result = parts[0].text;
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].wrapped) {
      result += parts[i].text;
    } else if (
      !parts[i - 1].wrapped &&
      parts[i - 1].fillsCols &&
      parts[i].text !== "" &&
      !parts[i].text.startsWith("- ") &&
      !parts[i].text.startsWith("* ") &&
      !parts[i].text.startsWith("\u2022 ")
    ) {
      const trimmedPrev = result.trimEnd();
      const trimmedNext = parts[i].text.trimStart();
      // Check original texts for spaces (trimRight removes them)
      const prevHadTrailingSpace =
        parts[i - 1].rawText.trimEnd().length < parts[i - 1].rawText.length;
      const currHadLeadingSpace =
        parts[i].rawText.trimStart().length < parts[i].rawText.length;
      result =
        trimmedPrev +
        (prevHadTrailingSpace || currHadLeadingSpace ? " " : "") +
        trimmedNext;
    } else {
      result += "\n" + parts[i].text;
    }
  }

  return result;
}