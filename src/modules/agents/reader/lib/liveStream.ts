/**
 * What the Reader's live "working" card shows for the turn Claude is in: the
 * tool still running (subagent work included) and the steps already done.
 */
import { displayPath, toolKind, toolTitle } from "./readerView";
import type { ReaderDocument, ReaderTurn, ToolCall } from "./transcript";

export type InFlight = {
  call: ToolCall;
  /** The running step inside a subagent, when `call` is one. */
  nested: ToolCall | null;
};

function lastRunning(calls: readonly ToolCall[]): ToolCall | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].status === "running") return calls[i];
  }
  return null;
}

function topLevelCalls(turn: ReaderTurn): ToolCall[] {
  return turn.blocks.flatMap((b) => (b.kind === "tool" ? [b.call] : []));
}

function childCalls(call: ToolCall): ToolCall[] {
  return call.children.flatMap((b) => (b.kind === "tool" ? [b.call] : []));
}

/** The newest tool call of the last turn still waiting for its result. */
export function inFlightCall(doc: ReaderDocument): InFlight | null {
  const turn = doc.turns[doc.turns.length - 1];
  if (!turn) return null;
  const call = lastRunning(topLevelCalls(turn));
  if (!call) return null;
  return { call, nested: lastRunning(childCalls(call)) };
}

export type LiveTitle = {
  /** Present-tense verb: "Running", "Editing", "Searching"… */
  verb: string;
  detail: string | null;
  mono: boolean;
};

const VERB: Record<ReturnType<typeof toolKind>, string> = {
  bash: "Running",
  read: "Reading",
  edit: "Editing",
  write: "Writing",
  search: "Searching",
  web: "Fetching",
  task: "Subagent",
  todo: "Updating to-dos",
  mcp: "Calling",
  other: "Using",
};

/** "Running: pnpm test", "Editing reader.css", "Searching 'foo'", "Subagent: Explore …". */
export function liveTitle(
  call: Pick<ToolCall, "name" | "input" | "filePath">,
  cwd: string | null,
  home: string | null = null,
): LiveTitle {
  const kind = toolKind(call.name);
  const title = toolTitle(call, cwd, home);
  switch (kind) {
    case "bash":
      return { verb: "Running", detail: title.detail, mono: true };
    case "read":
    case "edit":
    case "write": {
      const path = title.path;
      const name = path ? (path.split("/").pop() ?? path) : null;
      return { verb: VERB[kind], detail: name, mono: true };
    }
    case "search": {
      const pattern =
        call.input && typeof call.input === "object"
          ? (call.input as Record<string, unknown>).pattern
          : null;
      return {
        verb: "Searching",
        detail: typeof pattern === "string" ? `'${pattern}'` : title.detail,
        mono: true,
      };
    }
    case "web":
      return {
        verb: call.name === "WebSearch" ? "Searching the web" : "Fetching",
        detail: title.detail,
        mono: false,
      };
    case "task":
      return { verb: "Subagent", detail: title.detail, mono: false };
    case "todo":
      return { verb: VERB.todo, detail: null, mono: false };
    case "mcp":
      return { verb: title.label, detail: title.detail, mono: false };
    default:
      return {
        verb: call.name,
        detail: title.path ? displayPath(title.path, cwd, home) : null,
        mono: false,
      };
  }
}

/** One finished step of the live turn, for the card's collapsed step list. */
export type LiveStep = {
  id: string;
  label: string;
  detail: string | null;
  mono: boolean;
  error: boolean;
};

/** The top-level tool calls of `turn` that have finished, oldest first. */
export function turnSteps(
  turn: ReaderTurn,
  cwd: string | null,
  home: string | null = null,
): LiveStep[] {
  return topLevelCalls(turn)
    .filter((call) => call.status !== "running")
    .map((call) => {
      const title = toolTitle(call, cwd, home);
      return {
        id: call.id,
        label: title.label,
        detail: title.detail,
        mono: title.mono,
        error: call.status === "error",
      };
    });
}
