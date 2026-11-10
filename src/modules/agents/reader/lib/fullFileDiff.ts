/**
 * What the file review needs from the transcript: the file before this chat's
 * edits (when it isn't in git) and how to show its path.
 */
import { displayPath } from "./readerView";
import type { ReaderBlock, ReaderDocument, ToolCall } from "./transcript";

export type EditOp =
  | { kind: "edit"; oldString: string; newString: string; replaceAll: boolean }
  | { kind: "write"; content: string; created: boolean };

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function editOps(call: ToolCall, created: boolean): EditOp[] {
  const input = (call.input ?? {}) as Record<string, unknown>;
  if (call.name === "Write") {
    const content = asString(input.content);
    return content === null ? [] : [{ kind: "write", content, created }];
  }
  const one = (raw: Record<string, unknown>): EditOp | null => {
    const oldString = asString(raw.old_string);
    const newString = asString(raw.new_string);
    if (oldString === null || newString === null) return null;
    return {
      kind: "edit",
      oldString,
      newString,
      replaceAll: raw.replace_all === true,
    };
  };
  if (call.name === "MultiEdit" && Array.isArray(input.edits)) {
    return input.edits
      .map((e) =>
        e && typeof e === "object" ? one(e as Record<string, unknown>) : null,
      )
      .filter((e): e is EditOp => e !== null);
  }
  const single = one(input);
  return single ? [single] : [];
}

function sameFile(raw: string, path: string, cwd: string | null): boolean {
  if (raw === path) return true;
  if (raw.startsWith("/") || !cwd) return false;
  return `${cwd.replace(/\/+$/, "")}/${raw.replace(/^\.\//, "")}` === path;
}

/** This chat's successful edits to `path`, oldest first. */
export function sessionEdits(
  doc: ReaderDocument,
  path: string,
  cwd: string | null,
): EditOp[] {
  const ops: EditOp[] = [];
  let seen = false;
  const visit = (blocks: readonly ReaderBlock[]) => {
    for (const block of blocks) {
      if (block.kind !== "tool") continue;
      const call = block.call;
      const input = (call.input ?? {}) as Record<string, unknown>;
      const raw = call.filePath ?? asString(input.file_path);
      if (
        raw &&
        call.status === "done" &&
        ["Edit", "MultiEdit", "Write"].includes(call.name) &&
        sameFile(raw, path, cwd)
      ) {
        ops.push(...editOps(call, !seen && call.name === "Write"));
        seen = true;
      }
      visit(call.children);
    }
  };
  for (const turn of doc.turns) visit(turn.blocks);
  return ops;
}

/**
 * The file as it was before this chat's edits, undoing them newest first. A
 * Write that created the file means the base was empty; any other Write
 * stops the undo there (what came before it isn't known).
 */
export function reverseApplyEdits(
  current: string,
  ops: readonly EditOp[],
): string {
  let text = current;
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    if (op.kind === "write") return op.created ? "" : op.content;
    if (!op.newString || !text.includes(op.newString)) continue;
    text = op.replaceAll
      ? text.split(op.newString).join(op.oldString)
      : text.replace(op.newString, () => op.oldString);
  }
  return text;
}

/** A file's name and its folder, shown relative to `cwd` (or with `~`). */
export function splitDisplayPath(
  path: string,
  cwd: string | null,
  home: string | null = null,
): { name: string; dir: string } {
  const shown = displayPath(path, cwd, home);
  const slash = shown.lastIndexOf("/");
  if (slash < 0) return { name: shown, dir: "" };
  return { name: shown.slice(slash + 1), dir: shown.slice(0, slash) };
}
