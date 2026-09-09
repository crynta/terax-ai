import type { TerminalCursor } from "@/modules/terminal/backend/contracts";

const encoder = new TextEncoder();

export function clearTerminalBufferSequence(
  cursor: Pick<TerminalCursor, "x" | "y">,
): Uint8Array {
  const row = Math.max(0, Math.trunc(cursor.y));
  const column = Math.max(0, Math.trunc(cursor.x));
  const scroll = row > 0 ? `\x1b[${row}S` : "";
  return encoder.encode(
    `${scroll}\x1b[1;${column + 1}H\x1b[0J\x1b[3J`,
  );
}
