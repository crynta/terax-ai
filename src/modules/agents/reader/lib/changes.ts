/**
 * The Reader's "Changes" panel: every file Claude edited in this chat, with
 * line counts and the combined diff, plus helpers to review or revert them.
 */
import { diffStats, displayPath } from "./readerView";
import type {
  DiffLine,
  ReaderBlock,
  ReaderDocument,
  ToolCall,
} from "./transcript";

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

export type ChangedFile = {
  path: string;
  added: number;
  removed: number;
  /** Successful edit/write calls on the file. */
  edits: number;
  lastAt: string | null;
  /** The chat created the file (its first change was a Write). */
  created: boolean;
  /** A later `rm` removed it. */
  deleted: boolean;
  /** One diff per edit, oldest first. */
  diffs: DiffLine[][];
};

function allCalls(doc: ReaderDocument): ToolCall[] {
  const calls: ToolCall[] = [];
  const visit = (blocks: readonly ReaderBlock[]) => {
    for (const block of blocks) {
      if (block.kind !== "tool") continue;
      calls.push(block.call);
      visit(block.call.children);
    }
  };
  for (const turn of doc.turns) visit(turn.blocks);
  return calls;
}

function inputPath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  for (const key of ["file_path", "notebook_path", "path"]) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function absolute(path: string, cwd: string | null): string {
  if (path.startsWith("/") || !cwd) return path;
  return `${cwd.replace(/\/+$/, "")}/${path.replace(/^\.\//, "")}`;
}

/**
 * Paths a plain `rm` command removes, resolved against `cwd`. Commands with
 * globs, variables, pipes or chains are ignored rather than guessed.
 */
export function removedPaths(command: string, cwd: string | null): string[] {
  const match = command.trim().match(/^rm\s+(.+)$/);
  if (!match || /[*?$`|;&<>(){}]/.test(match[1])) return [];
  const paths: string[] = [];
  for (const raw of match[1].split(/\s+/)) {
    const token = raw.replace(/^['"]|['"]$/g, "");
    if (!token || token.startsWith("-")) continue;
    paths.push(absolute(token, cwd));
  }
  return paths;
}

/** Files changed in `doc`, most recently changed first. */
export function changedFiles(
  doc: ReaderDocument,
  cwd: string | null,
): ChangedFile[] {
  const files = new Map<string, ChangedFile>();
  const entry = (path: string): ChangedFile => {
    let file = files.get(path);
    if (!file) {
      file = {
        path,
        added: 0,
        removed: 0,
        edits: 0,
        lastAt: null,
        created: false,
        deleted: false,
        diffs: [],
      };
      files.set(path, file);
    }
    return file;
  };
  for (const call of allCalls(doc)) {
    if (call.status === "error" || call.status === "running") continue;
    if (EDIT_TOOLS.has(call.name)) {
      const raw = call.filePath ?? inputPath(call.input);
      if (!raw) continue;
      const path = absolute(raw, cwd);
      const known = files.has(path);
      const file = entry(path);
      if (!known && call.name === "Write") file.created = true;
      file.deleted = false;
      file.edits += 1;
      file.lastAt = call.timestamp ?? file.lastAt;
      if (call.diff) {
        const stats = diffStats(call.diff);
        file.added += stats.added;
        file.removed += stats.removed;
        file.diffs.push(call.diff);
      }
    } else if (call.name === "Bash") {
      const command = (call.input as { command?: unknown } | null)?.command;
      if (typeof command !== "string") continue;
      for (const path of removedPaths(command, cwd)) {
        const file = files.get(path);
        if (!file) continue;
        file.deleted = true;
        file.lastAt = call.timestamp ?? file.lastAt;
      }
    }
  }
  return [...files.values()].sort((a, b) =>
    (b.lastAt ?? "").localeCompare(a.lastAt ?? ""),
  );
}

/** All of a file's edit diffs as one, separated by a marker line. */
export function combinedDiff(file: Pick<ChangedFile, "diffs">): DiffLine[] {
  const out: DiffLine[] = [];
  file.diffs.forEach((diff, i) => {
    if (i > 0) out.push({ kind: "context", text: "⋯" });
    out.push(...diff);
  });
  return out;
}

/** `path` relative to `repoRoot`, or null when it lies outside it. */
export function repoRelative(path: string, repoRoot: string): string | null {
  const root = repoRoot.replace(/\/+$/, "");
  if (!path.startsWith(`${root}/`)) return null;
  const rel = path.slice(root.length + 1);
  return rel && !rel.split("/").some((part) => part === ".." || part === ".")
    ? rel
    : null;
}

/** The prompt "Ask Claude to review these changes" queues. */
export function reviewPrompt(
  files: readonly ChangedFile[],
  cwd: string | null,
  home: string | null = null,
): string {
  const list = files
    .filter((f) => !f.deleted)
    .map((f) => `- ${displayPath(f.path, cwd, home)}`)
    .join("\n");
  return [
    "Please review the changes you made in this chat for bugs, edge cases and anything left unfinished. Files changed:",
    list,
    "Report problems first, most serious first, and say which you would fix.",
  ].join("\n\n");
}

/** A short Markdown summary of the changes, for "Copy summary". */
export function changesSummary(
  files: readonly ChangedFile[],
  cwd: string | null,
  home: string | null = null,
): string {
  const lines = files.map((f) => {
    const tag = f.deleted ? " (deleted)" : f.created ? " (new)" : "";
    return `- \`${displayPath(f.path, cwd, home)}\`${tag} +${f.added} −${f.removed}`;
  });
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  return [
    `${files.length} file${files.length === 1 ? "" : "s"} changed, +${added} −${removed}`,
    "",
    ...lines,
  ].join("\n");
}

/** Diff lines of a `git diff` for one file, headers dropped and hunks separated. */
export function parseUnifiedDiff(text: string): DiffLine[] {
  const out: DiffLine[] = [];
  let inHunk = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("@@")) {
      if (out.length > 0) out.push({ kind: "context", text: "⋯" });
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("\\")) continue;
    if (line.startsWith("+")) out.push({ kind: "add", text: line.slice(1) });
    else if (line.startsWith("-"))
      out.push({ kind: "remove", text: line.slice(1) });
    else if (line.startsWith(" "))
      out.push({ kind: "context", text: line.slice(1) });
    else if (line.startsWith("diff --git")) inHunk = false;
  }
  return out;
}
