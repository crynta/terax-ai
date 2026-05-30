import type { Terminal } from "@xterm/xterm";

/**
 * Detect if a line was hard-wrapped at the terminal column width.
 * A line is considered hard-wrapped if its trimmed length equals or exceeds
 * `cols`, AND the next line also has content (not a paragraph break).
 * This handles programs like Pi CLI that output text with explicit \n
 * at the terminal width instead of relying on the terminal's soft wrap.
 */
function isHardWrappedLine(
  parts: { text: string; wrapped: boolean }[],
  index: number,
  cols: number,
): boolean {
  if (cols <= 0) return false;
  const part = parts[index];
  // Only consider joining if the line is NOT soft-wrapped and fills the width
  if (part.wrapped || part.text.length < cols) return false;
  // Don't join if this is the last line
  if (index >= parts.length - 1) return false;
  // Don't join if the next line starts with common paragraph indicators
  // (blank line, list markers, etc.) — those are real breaks
  const next = parts[index + 1].text;
  if (next === "" || next.startsWith("  ") || next.startsWith("- ") || next.startsWith("* ")) {
    return false;
  }
  return true;
}

export function getSelectionText(term: Terminal): string | null {
  const pos = term.getSelectionPosition();
  if (!pos) return null;

  const { start, end } = pos;
  const buf = term.buffer.active;
  const cols = term.cols;

  const parts: { text: string; wrapped: boolean }[] = [];

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

    parts.push({ text, wrapped: line.isWrapped });
  }

  if (parts.length === 0) return null;

  let result = parts[0].text;
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].wrapped) {
      // Soft wrap: join without separator
      result += parts[i].text;
    } else if (isHardWrappedLine(parts, i - 1, cols)) {
      // Hard wrap at column width: join without separator
      result += parts[i].text;
    } else {
      // Real line break: preserve
      result += "\n" + parts[i].text;
    }
  }

  return result;
}