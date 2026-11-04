/**
 * Pure presentation helpers for the Session Reader: which card a tool call
 * gets, its one-line title, diff numbering and stats, and the grouping of
 * runs of file exploration into a single "Explored" card.
 */
import type { DiffLine, ReaderBlock, ReaderTurn, ToolCall } from "./transcript";

export type ToolKind =
  | "bash"
  | "read"
  | "edit"
  | "write"
  | "search"
  | "web"
  | "task"
  | "todo"
  | "mcp"
  | "other";

const KIND_BY_NAME: Record<string, ToolKind> = {
  Bash: "bash",
  BashOutput: "bash",
  KillShell: "bash",
  KillBash: "bash",
  Read: "read",
  NotebookRead: "read",
  Edit: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Write: "write",
  Grep: "search",
  Glob: "search",
  LS: "search",
  WebFetch: "web",
  WebSearch: "web",
  Task: "task",
  Agent: "task",
  TodoWrite: "todo",
};

export function toolKind(name: string): ToolKind {
  if (name.startsWith("mcp__")) return "mcp";
  return KIND_BY_NAME[name] ?? "other";
}

/** `mcp__plugin_ucl_ucl__github_search_code` → server "ucl", tool "github search code". */
export function mcpName(name: string): { server: string; tool: string } {
  const parts = name.replace(/^mcp__/, "").split("__");
  const rawServer = parts.length > 1 ? parts[0] : "mcp";
  const rawTool = parts.length > 1 ? parts.slice(1).join(" ") : parts[0];
  const serverParts = rawServer.split("_").filter(Boolean);
  const server = serverParts[serverParts.length - 1] ?? rawServer;
  return { server, tool: rawTool.replace(/[_-]+/g, " ").trim() };
}

/** `path` shown relative to `cwd` when it sits inside it, else with `~` for home. */
export function displayPath(
  path: string,
  cwd: string | null,
  home: string | null = null,
): string {
  const clean = path.replace(/\\/g, "/");
  const base = cwd?.replace(/\\/g, "/").replace(/\/+$/, "");
  if (base && clean.startsWith(`${base}/`)) return clean.slice(base.length + 1);
  const h = home?.replace(/\\/g, "/").replace(/\/+$/, "");
  if (h && clean.startsWith(`${h}/`)) return `~/${clean.slice(h.length + 1)}`;
  return clean;
}

export type ToolTitle = {
  /** Short verb shown in the card's label, e.g. "Ran", "Read", "Edited". */
  label: string;
  /** The interesting argument: command, path, pattern, description or URL. */
  detail: string | null;
  /** Whether `detail` reads best in monospace (commands, patterns). */
  mono: boolean;
  /** `detail` is a file path the card can open. */
  path: string | null;
};

function field(input: unknown, key: string): string | null {
  if (!input || typeof input !== "object") return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return text.trim().includes("\n") ? `${line} …` : line;
}

export function toolTitle(
  call: Pick<ToolCall, "name" | "input" | "filePath">,
  cwd: string | null,
  home: string | null = null,
): ToolTitle {
  const kind = toolKind(call.name);
  const path = call.filePath ?? field(call.input, "path");
  const shown = path ? displayPath(path, cwd, home) : null;
  switch (kind) {
    case "bash": {
      const command = field(call.input, "command");
      return {
        label: call.name === "Bash" ? "Ran" : call.name,
        detail: command ? firstLine(command) : null,
        mono: true,
        path: null,
      };
    }
    case "read":
      return { label: "Read", detail: shown, mono: true, path };
    case "edit":
      return { label: "Edited", detail: shown, mono: true, path };
    case "write":
      return { label: "Wrote", detail: shown, mono: true, path };
    case "search": {
      const pattern = field(call.input, "pattern");
      const where = path ? ` in ${shown}` : "";
      return {
        label: call.name === "Glob" ? "Found files" : "Searched",
        detail: pattern ? `${pattern}${where}` : shown,
        mono: true,
        path: null,
      };
    }
    case "web":
      return {
        label: call.name === "WebSearch" ? "Searched the web" : "Fetched",
        detail: field(call.input, "query") ?? field(call.input, "url"),
        mono: false,
        path: null,
      };
    case "task":
      return {
        label: "Subagent",
        detail:
          field(call.input, "description") ??
          field(call.input, "subagent_type"),
        mono: false,
        path: null,
      };
    case "todo":
      return { label: "Updated plan", detail: null, mono: false, path: null };
    case "mcp": {
      const { server, tool } = mcpName(call.name);
      return { label: server, detail: tool, mono: false, path: null };
    }
    default:
      return { label: call.name, detail: shown, mono: false, path };
  }
}

export type NumberedDiffLine = DiffLine & {
  oldNo: number | null;
  newNo: number | null;
};

/** Line numbers for each side of a diff, starting at 1. */
export function numberDiff(diff: readonly DiffLine[]): NumberedDiffLine[] {
  let oldNo = 0;
  let newNo = 0;
  return diff.map((line) => {
    if (line.kind === "add") return { ...line, oldNo: null, newNo: ++newNo };
    if (line.kind === "remove") return { ...line, oldNo: ++oldNo, newNo: null };
    return { ...line, oldNo: ++oldNo, newNo: ++newNo };
  });
}

export function diffStats(diff: readonly DiffLine[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.kind === "add") added += 1;
    else if (line.kind === "remove") removed += 1;
  }
  return { added, removed };
}

/**
 * Keeps changed lines plus `context` lines around them, collapsing the rest
 * into gaps so a one-line edit in a long file stays a short card.
 */
export function compactDiff(
  diff: readonly NumberedDiffLine[],
  context = 3,
): (NumberedDiffLine | { kind: "gap"; hidden: number })[] {
  const keep = new Array<boolean>(diff.length).fill(false);
  diff.forEach((line, index) => {
    if (line.kind === "context") return;
    for (
      let i = Math.max(0, index - context);
      i <= Math.min(diff.length - 1, index + context);
      i++
    ) {
      keep[i] = true;
    }
  });
  if (!keep.some(Boolean)) return [...diff];
  const out: (NumberedDiffLine | { kind: "gap"; hidden: number })[] = [];
  let hidden = 0;
  diff.forEach((line, index) => {
    if (keep[index]) {
      if (hidden > 0) out.push({ kind: "gap", hidden });
      hidden = 0;
      out.push(line);
    } else {
      hidden += 1;
    }
  });
  if (hidden > 0) out.push({ kind: "gap", hidden });
  return out;
}

export type ReaderItem =
  | { kind: "block"; block: ReaderBlock }
  | { kind: "explore"; id: string; calls: ToolCall[] };

const EXPLORE_KINDS = new Set<ToolKind>(["read", "search"]);
export const EXPLORE_GROUP_MIN = 3;

/** Folds runs of {@link EXPLORE_GROUP_MIN}+ consecutive Read/Grep/Glob calls into one item. */
export function groupReaderBlocks(
  blocks: readonly ReaderBlock[],
): ReaderItem[] {
  const items: ReaderItem[] = [];
  let run: ToolCall[] = [];
  const flush = () => {
    if (run.length >= EXPLORE_GROUP_MIN) {
      items.push({ kind: "explore", id: `explore-${run[0].id}`, calls: run });
    } else {
      for (const call of run) {
        items.push({
          kind: "block",
          block: { kind: "tool", id: call.id, call },
        });
      }
    }
    run = [];
  };
  for (const block of blocks) {
    if (block.kind === "tool" && EXPLORE_KINDS.has(toolKind(block.call.name))) {
      run.push(block.call);
      continue;
    }
    // Empty thinking between explore calls should not split the group.
    if (block.kind === "thinking" && !block.text.trim() && run.length > 0) {
      continue;
    }
    flush();
    items.push({ kind: "block", block });
  }
  flush();
  return items;
}

export type TurnOutcome = "running" | "error" | "done";

export function turnOutcome(turn: ReaderTurn): TurnOutcome {
  let error = false;
  const visit = (blocks: readonly ReaderBlock[]): boolean => {
    for (const block of blocks) {
      if (block.kind !== "tool") continue;
      if (block.call.status === "running") return true;
      if (block.call.status === "error") error = true;
      if (visit(block.call.children)) return true;
    }
    return false;
  };
  if (visit(turn.blocks)) return "running";
  return error ? "error" : "done";
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${Math.max(seconds, ms > 0 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

export function formatClock(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Time between two ISO stamps, or null when either is missing. */
export function spanMs(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export type TodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed";
};

export function todoItems(input: unknown): TodoItem[] {
  if (!input || typeof input !== "object") return [];
  const todos = (input as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return [];
  const out: TodoItem[] = [];
  for (const todo of todos) {
    if (!todo || typeof todo !== "object") continue;
    const record = todo as Record<string, unknown>;
    const content =
      typeof record.content === "string" ? record.content : record.activeForm;
    if (typeof content !== "string" || !content.trim()) continue;
    const status =
      record.status === "in_progress" || record.status === "completed"
        ? record.status
        : "pending";
    out.push({ content, status });
  }
  return out;
}

/** The shell output a Bash card shows: structured stdout/stderr, else the raw result. */
export function bashOutput(
  call: Pick<ToolCall, "stdout" | "stderr" | "result">,
): {
  stdout: string;
  stderr: string;
} {
  if (call.stdout !== null || call.stderr !== null) {
    return { stdout: call.stdout ?? "", stderr: call.stderr ?? "" };
  }
  return { stdout: call.result ?? "", stderr: "" };
}
