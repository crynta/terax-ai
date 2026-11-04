/**
 * The Reader's full-file diff: the whole current file with every change
 * against its base (`HEAD`, or the file before this chat's edits) interleaved.
 */
import { displayPath } from "./readerView";
import {
  lineDiff,
  type ReaderBlock,
  type ReaderDocument,
  type ToolCall,
} from "./transcript";

export type FullRow = {
  kind: "add" | "remove" | "context";
  oldNo: number | null;
  newNo: number | null;
  text: string;
};

/** Rows rendered before "Show all" is offered. */
export const MAX_RENDER_ROWS = 5000;

/** A file's lines; a trailing newline doesn't add an empty last line. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * The whole working file with a `git diff HEAD` patch's hunks interleaved.
 * Null when the patch has no hunks (nothing to interleave).
 */
export function fullViewFromPatch(
  working: string,
  patch: string,
): FullRow[] | null {
  const lines = splitLines(working);
  const rows: FullRow[] = [];
  let newPos = 1;
  let oldPos = 1;
  let sawHunk = false;
  const contextUntil = (newStart: number) => {
    while (newPos < newStart && newPos <= lines.length) {
      rows.push({
        kind: "context",
        oldNo: oldPos++,
        newNo: newPos,
        text: lines[newPos - 1],
      });
      newPos++;
    }
  };
  for (const line of patch.split("\n")) {
    const header = HUNK.exec(line);
    if (header) {
      sawHunk = true;
      const oldStart = Number(header[1]);
      const newStart = Number(header[3]);
      const newLen = header[4] === undefined ? 1 : Number(header[4]);
      // A pure deletion reports the line *before* it as its new start.
      contextUntil(newLen === 0 ? newStart + 1 : newStart);
      oldPos = Number(header[2]) === 0 ? oldStart + 1 : oldStart;
      continue;
    }
    if (!sawHunk || line.startsWith("\\")) continue;
    if (line.startsWith("+")) {
      rows.push({
        kind: "add",
        oldNo: null,
        newNo: newPos++,
        text: line.slice(1),
      });
    } else if (line.startsWith("-")) {
      rows.push({
        kind: "remove",
        oldNo: oldPos++,
        newNo: null,
        text: line.slice(1),
      });
    } else if (line.startsWith(" ")) {
      rows.push({
        kind: "context",
        oldNo: oldPos++,
        newNo: newPos,
        text: lines[newPos - 1] ?? line.slice(1),
      });
      newPos++;
    } else if (line.startsWith("diff --git")) {
      break;
    }
  }
  if (!sawHunk) return null;
  contextUntil(lines.length + 1);
  return rows;
}

/** The whole file from its two versions; either may be missing. */
export function fullViewFromVersions(
  base: string | null,
  working: string | null,
): FullRow[] {
  const before = splitLines(base ?? "").join("\n");
  const after = splitLines(working ?? "").join("\n");
  let oldNo = 0;
  let newNo = 0;
  return lineDiff(before, after).map((line) => {
    if (line.kind === "add") return { ...line, oldNo: null, newNo: ++newNo };
    if (line.kind === "remove") return { ...line, oldNo: ++oldNo, newNo: null };
    return { ...line, oldNo: ++oldNo, newNo: ++newNo };
  });
}

/** Indexes of the first row of each run of added or removed rows. */
export function changeStarts(rows: readonly FullRow[]): number[] {
  const starts: number[] = [];
  rows.forEach((row, i) => {
    if (row.kind === "context") return;
    if (i === 0 || rows[i - 1].kind === "context") starts.push(i);
  });
  return starts;
}

/** The change to move to from `current` (a position in `starts`, or -1). */
export function stepChange(
  count: number,
  current: number,
  direction: 1 | -1,
): number {
  if (count === 0) return -1;
  if (current < 0) return direction === 1 ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, current + direction));
}

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
