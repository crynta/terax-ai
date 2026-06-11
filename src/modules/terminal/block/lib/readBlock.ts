import type { Terminal } from "@xterm/xterm";

export function readRangeText(
  term: Terminal,
  startLine: number,
  endLine: number,
): string {
  const buf = term.buffer.active;
  const last = Math.min(endLine, buf.length - 1);
  const lines: string[] = [];
  for (let i = Math.max(0, startLine); i <= last; i++) {
    lines.push(buf.getLine(i)?.translateToString(true) ?? "");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
