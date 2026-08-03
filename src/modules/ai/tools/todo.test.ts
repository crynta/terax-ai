import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const storeMock = vi.hoisted(() => ({ setTodos: vi.fn() }));

vi.mock("../store/todoStore", () => ({
  useTodosStore: { getState: () => ({ setTodos: storeMock.setTodos }) },
}));

import { buildTodoTools } from "./todo";

const toolOptions: ToolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
};

function makeContext(sessionId: string | null = "session"): ToolContext {
  return {
    getCwd: () => "/workspace",
    getWorkspaceRoot: () => "/workspace",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => sessionId,
  } as unknown as ToolContext;
}

// biome-ignore lint/suspicious/noExplicitAny: tool results are heterogeneous.
type Result = Record<string, any>;

async function run(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<Result> {
  const execute = buildTodoTools(ctx).todo_write.execute;
  if (!execute) throw new Error("todo_write has no execute");
  return (await execute(input as never, toolOptions)) as unknown as Result;
}

beforeEach(() => vi.clearAllMocks());

describe("todo_write", () => {
  it("errors when there is no active session", async () => {
    const r = await run(makeContext(null), { todos: [] });
    expect(r.error).toContain("no active session");
    expect(storeMock.setTodos).not.toHaveBeenCalled();
  });

  it("persists todos and reports the count and current item", async () => {
    const r = await run(makeContext(), {
      todos: [
        { id: "a", title: "first", status: "in_progress" },
        { id: "b", title: "second", status: "pending" },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2);
    expect(r.inProgress).toBe("first");
    expect(storeMock.setTodos).toHaveBeenCalledWith(
      "session",
      expect.any(Array),
    );
  });

  it("assigns an id to a todo that lacks one", async () => {
    await run(makeContext(), {
      todos: [{ title: "no id yet", status: "pending" }],
    });
    const persisted = storeMock.setTodos.mock.calls[0][1];
    expect(persisted[0].id).toBeTruthy();
  });

  it("rejects an invalid batch without persisting", async () => {
    const r = await run(makeContext(), {
      todos: [
        { id: "a", title: "x", status: "in_progress" },
        { id: "b", title: "y", status: "in_progress" },
      ],
    });
    expect(r.error).toContain("in_progress");
    expect(storeMock.setTodos).not.toHaveBeenCalled();
  });
});
