/**
 * The session's working plan for the Reader's pinned panel: Claude's latest
 * to-do list (TodoWrite, or TaskCreate/TaskUpdate) and its latest plan
 * (ExitPlanMode).
 */
import { type TodoItem, todoItems } from "./readerView";
import type { ReaderBlock, ReaderDocument, ToolCall } from "./transcript";

export type SessionTodos = {
  items: TodoItem[];
  done: number;
  total: number;
  /** Index of the item in progress, or -1. */
  active: number;
  /** The call that produced this state. */
  sourceId: string;
};

function mainCalls(doc: ReaderDocument): ToolCall[] {
  const calls: ToolCall[] = [];
  const visit = (blocks: readonly ReaderBlock[]) => {
    for (const block of blocks)
      if (block.kind === "tool") calls.push(block.call);
  };
  for (const turn of doc.turns) visit(turn.blocks);
  return calls;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

function status(value: unknown): TodoItem["status"] | "deleted" {
  if (value === "in_progress" || value === "completed" || value === "deleted")
    return value;
  return "pending";
}

function summarise(items: TodoItem[], sourceId: string): SessionTodos | null {
  if (items.length === 0) return null;
  return {
    items,
    done: items.filter((i) => i.status === "completed").length,
    total: items.length,
    active: items.findIndex((i) => i.status === "in_progress"),
    sourceId,
  };
}

/**
 * The newest to-do state of the main thread. TodoWrite replaces the list
 * wholesale; TaskCreate/TaskUpdate calls after it build on a task list keyed
 * by the id in TaskCreate's result ("Task #3 created …").
 */
export function latestTodos(doc: ReaderDocument): SessionTodos | null {
  const calls = mainCalls(doc);
  let lastWrite = -1;
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].name === "TodoWrite") {
      lastWrite = i;
      break;
    }
  }
  const tasks = new Map<string, TodoItem>();
  let lastTask: ToolCall | null = null;
  for (let i = lastWrite + 1; i < calls.length; i++) {
    const call = calls[i];
    const input = asRecord(call.input);
    if (call.name === "TaskCreate" && call.status !== "error") {
      const id =
        call.result?.match(/#(\d+)/)?.[1] ??
        asText(input.taskId) ??
        String(tasks.size + 1);
      const content = asText(input.subject) ?? asText(input.description);
      if (content) tasks.set(id, { content, status: "pending" });
      lastTask = call;
    } else if (call.name === "TaskUpdate" && call.status !== "error") {
      const id = asText(input.taskId) ?? String(input.taskId ?? "");
      const task = tasks.get(id);
      if (!task) continue;
      const next = status(input.status);
      if (next === "deleted") tasks.delete(id);
      else
        tasks.set(id, {
          content: asText(input.subject) ?? task.content,
          status: input.status === undefined ? task.status : next,
        });
      lastTask = call;
    }
  }
  if (lastTask) return summarise([...tasks.values()], lastTask.id);
  if (lastWrite < 0) return null;
  const write = calls[lastWrite];
  return summarise(todoItems(write.input), write.id);
}

export type SessionPlan = {
  id: string;
  markdown: string;
  /** "running" while Claude waits for approval; "done" once answered. */
  status: ToolCall["status"];
  /** The user rejected it (Claude was told to keep planning). */
  rejected: boolean;
};

/** The newest ExitPlanMode plan of the main thread. */
export function latestPlan(doc: ReaderDocument): SessionPlan | null {
  const calls = mainCalls(doc);
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i];
    if (call.name !== "ExitPlanMode") continue;
    const markdown = asText(asRecord(call.input).plan);
    if (!markdown) return null;
    return {
      id: call.id,
      markdown,
      status: call.status,
      rejected:
        call.status === "error" ||
        /doesn't want to proceed|rejected|keep planning/i.test(
          call.result ?? "",
        ),
    };
  }
  return null;
}

/** The option of a plan-approval dialog that keeps Claude planning: "No…" or the Esc one. */
export function keepPlanningOption(
  options: readonly { n: number; label: string; escape: boolean }[],
): number | null {
  const no = options.find((o) => /^no\b|keep planning/i.test(o.label));
  return (no ?? options.find((o) => o.escape))?.n ?? null;
}
