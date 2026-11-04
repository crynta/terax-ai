import { toolKind } from "./readerView";
import {
  type DiffLine,
  lineDiff,
  type ReaderDocument,
  type ToolCall,
} from "./transcript";

/** Diff lines shown in the action card before it says "…N more". */
const PREVIEW_DIFF_LINES = 400;

/** What a pending tool call is about to do, for the action card. */
export type PendingDetails =
  | { kind: "command"; command: string; description: string | null }
  | { kind: "edit"; path: string | null; diff: DiffLine[]; more: number }
  | { kind: "other"; name: string; summary: string };

/** The newest tool call still waiting for its result, the one a permission prompt is about. */
export function pendingToolCall(doc: ReaderDocument): ToolCall | null {
  const turn = doc.turns[doc.turns.length - 1];
  if (!turn) return null;
  for (let i = turn.blocks.length - 1; i >= 0; i--) {
    const block = turn.blocks[i];
    if (block.kind !== "tool") continue;
    return block.call.status === "running" ? block.call : null;
  }
  return null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

function capped(diff: DiffLine[]): { diff: DiffLine[]; more: number } {
  return diff.length > PREVIEW_DIFF_LINES
    ? {
        diff: diff.slice(0, PREVIEW_DIFF_LINES),
        more: diff.length - PREVIEW_DIFF_LINES,
      }
    : { diff, more: 0 };
}

/** Details of `call` from its input: the command, the edit as a diff, or a short summary. */
export function pendingDetails(call: ToolCall): PendingDetails {
  const input = asRecord(call.input);
  const kind = toolKind(call.name);
  if (kind === "bash") {
    return {
      kind: "command",
      command: asString(input.command) ?? "",
      description: asString(input.description),
    };
  }
  const path = asString(input.file_path) ?? call.filePath;
  if (call.name === "Edit") {
    return {
      kind: "edit",
      path,
      ...capped(
        lineDiff(
          asString(input.old_string) ?? "",
          asString(input.new_string) ?? "",
        ),
      ),
    };
  }
  if (call.name === "MultiEdit" && Array.isArray(input.edits)) {
    const diff = input.edits.flatMap((edit) => {
      const e = asRecord(edit);
      return lineDiff(
        asString(e.old_string) ?? "",
        asString(e.new_string) ?? "",
      );
    });
    return { kind: "edit", path, ...capped(diff) };
  }
  if (call.name === "Write") {
    return {
      kind: "edit",
      path,
      ...capped(lineDiff("", asString(input.content) ?? "")),
    };
  }
  const summary = Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
  return { kind: "other", name: call.name, summary };
}
