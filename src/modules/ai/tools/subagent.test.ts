import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const runSubagentMock = vi.hoisted(() => vi.fn());

vi.mock("../agents/runSubagent", () => ({ runSubagent: runSubagentMock }));
vi.mock("../store/chatStore", () => ({
  useChatStore: {
    getState: () => ({
      apiKeys: {},
      selectedModelId: "model",
      patchAgentMeta: vi.fn(),
    }),
  },
}));

import { buildSubagentTools } from "./subagent";

const toolOptions: ToolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
};

function makeContext(): ToolContext {
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
    getSessionId: () => "session",
  } as unknown as ToolContext;
}

// biome-ignore lint/suspicious/noExplicitAny: tool results are heterogeneous.
type Result = Record<string, any>;

async function run(input: Record<string, unknown>): Promise<Result> {
  const execute = buildSubagentTools(makeContext()).run_subagent.execute;
  if (!execute) throw new Error("run_subagent has no execute");
  return (await execute(input as never, toolOptions)) as unknown as Result;
}

beforeEach(() => vi.clearAllMocks());

describe("run_subagent", () => {
  it("maps the subagent result fields on success", async () => {
    runSubagentMock.mockResolvedValue({
      summary: "done",
      stepCount: 4,
      durationMs: 1200,
    });
    const r = await run({
      type: "reviewer",
      prompt: "review it",
      description: "card",
    });
    expect(r).toEqual({
      type: "reviewer",
      description: "card",
      summary: "done",
      stepCount: 4,
      durationMs: 1200,
    });
  });

  it("returns an error result instead of throwing when the subagent fails", async () => {
    runSubagentMock.mockRejectedValue(new Error("boom"));
    const r = await run({ type: "reviewer", prompt: "review it" });
    expect(r.type).toBe("reviewer");
    expect(r.error).toContain("boom");
  });
});
