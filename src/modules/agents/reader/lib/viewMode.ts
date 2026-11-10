/**
 * The Reader's Compact / Detailed view. Compact hides thinking and folds each
 * run of tool calls into one "N steps" line, keeping Claude's prose.
 */
import type { ReaderBlock, ToolCall } from "./transcript";

export type ReaderViewMode = "detailed" | "compact";

const STORAGE_KEY = "terax:reader-view-mode";

export function readViewMode(): ReaderViewMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "compact"
      ? "compact"
      : "detailed";
  } catch {
    return "detailed";
  }
}

export function writeViewMode(mode: ReaderViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private windows and blocked storage: the choice just isn't remembered.
  }
}

export type CompactItem =
  | { kind: "block"; block: ReaderBlock }
  | { kind: "steps"; id: string; calls: ToolCall[] };

/** Compact items for a turn: no thinking, consecutive tool calls folded into one steps item. */
export function compactItems(blocks: readonly ReaderBlock[]): CompactItem[] {
  const items: CompactItem[] = [];
  let run: ToolCall[] = [];
  const flush = () => {
    if (run.length > 0) {
      items.push({ kind: "steps", id: `steps-${run[0].id}`, calls: run });
    }
    run = [];
  };
  for (const block of blocks) {
    if (block.kind === "thinking") continue;
    if (block.kind === "tool") {
      run.push(block.call);
      continue;
    }
    flush();
    items.push({ kind: "block", block });
  }
  flush();
  return items;
}
