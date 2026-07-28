import type { ToolExecutionOptions } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

type Managed = {
  leafId: number;
  phase: string;
  rounds: number;
  maxRounds: number;
};

const storeMock = vi.hoisted(() => ({
  getBySessionId: vi.fn(),
  remove: vi.fn(),
  bumpRound: vi.fn(),
  get: vi.fn(),
}));

const terminalMock = vi.hoisted(() => ({ writeToSession: vi.fn(() => true) }));

vi.mock("@/modules/agents/store/managedAgentsStore", () => ({
  useManagedAgentsStore: {
    getState: () => ({
      getBySessionId: storeMock.getBySessionId,
      remove: storeMock.remove,
      bumpRound: storeMock.bumpRound,
      get: storeMock.get,
    }),
  },
}));

vi.mock("@/modules/terminal", () => ({
  writeToSession: terminalMock.writeToSession,
}));

import { buildManagedAgentTools } from "./agent";

const toolOptions: ToolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
};

type Ctx = {
  sessionId?: string | null;
  spawnAgent?: (prompt: string) => { tabId: number } | null;
  readAgentOutput?: (leafId: number) => string | null;
};

function makeContext(over: Ctx = {}): ToolContext {
  return {
    getCwd: () => "/workspace",
    getWorkspaceRoot: () => "/workspace",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: over.spawnAgent ?? (() => ({ tabId: 42 })),
    readAgentOutput: over.readAgentOutput ?? (() => null),
    readCache: new Map(),
    getSessionId: () =>
      over.sessionId === undefined ? "session" : over.sessionId,
  } as unknown as ToolContext;
}

// biome-ignore lint/suspicious/noExplicitAny: tool results are heterogeneous.
type Result = Record<string, any>;

async function run(
  toolName: "spawn_coding_agent" | "send_to_agent" | "read_agent_output",
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<Result> {
  const execute = buildManagedAgentTools(ctx)[toolName].execute;
  if (!execute) throw new Error(`${toolName} has no execute`);
  return (await execute(input as never, toolOptions)) as unknown as Result;
}

const AGENT: Managed = {
  leafId: 3,
  phase: "working",
  rounds: 1,
  maxRounds: 20,
};

beforeEach(() => {
  vi.clearAllMocks();
  storeMock.getBySessionId.mockReturnValue(undefined);
  terminalMock.writeToSession.mockReturnValue(true);
});

describe("spawn_coding_agent", () => {
  it("errors when there is no active chat session", async () => {
    const r = await run(
      "spawn_coding_agent",
      makeContext({ sessionId: null }),
      {
        prompt: "do it",
      },
    );
    expect(r.error).toContain("no active chat session");
  });

  it("refuses to spawn a second agent in the same session", async () => {
    storeMock.getBySessionId.mockReturnValue(AGENT);
    const r = await run("spawn_coding_agent", makeContext(), {
      prompt: "do it",
    });
    expect(r.error).toContain("already active");
  });

  it("spawns and returns the tab id", async () => {
    const spawnAgent = vi.fn(() => ({ tabId: 42 }));
    const r = await run("spawn_coding_agent", makeContext({ spawnAgent }), {
      prompt: "do it",
    });
    expect(r.ok).toBe(true);
    expect(r.tab_id).toBe(42);
    expect(spawnAgent).toHaveBeenCalledWith("do it");
  });

  it("reports when the spawn fails", async () => {
    const r = await run(
      "spawn_coding_agent",
      makeContext({ spawnAgent: () => null }),
      { prompt: "do it" },
    );
    expect(r.error).toContain("could not spawn");
  });
});

describe("send_to_agent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("errors when no agent is active", async () => {
    const r = await run("send_to_agent", makeContext(), {
      instruction: "fix it",
    });
    expect(r.error).toContain("no Claude Code agent is active");
  });

  it("collapses the instruction to one line and writes it", async () => {
    storeMock.getBySessionId.mockReturnValue(AGENT);
    storeMock.get.mockReturnValue({ ...AGENT, rounds: 2 });
    const r = await run("send_to_agent", makeContext(), {
      instruction: "line one\n  line two",
    });
    expect(r.ok).toBe(true);
    expect(r.sent).toBe("line one line two");
    expect(terminalMock.writeToSession).toHaveBeenCalledWith(
      3,
      "line one line two",
    );
    expect(storeMock.bumpRound).toHaveBeenCalledWith(3);
  });

  it("rejects an instruction with control characters", async () => {
    storeMock.getBySessionId.mockReturnValue(AGENT);
    const r = await run("send_to_agent", makeContext(), {
      instruction: "bad\x07bell",
    });
    expect(r.error).toContain("control characters");
    expect(terminalMock.writeToSession).not.toHaveBeenCalled();
  });

  it("removes the agent when its terminal is gone", async () => {
    storeMock.getBySessionId.mockReturnValue(AGENT);
    terminalMock.writeToSession.mockReturnValue(false);
    const r = await run("send_to_agent", makeContext(), {
      instruction: "fix it",
    });
    expect(r.error).toContain("no longer available");
    expect(storeMock.remove).toHaveBeenCalledWith(3);
  });
});

describe("read_agent_output", () => {
  it("reports inactive when no agent is in the session", async () => {
    const r = await run("read_agent_output", makeContext(), {});
    expect(r).toEqual({ active: false });
  });

  it("returns the agent status and tail of output", async () => {
    storeMock.getBySessionId.mockReturnValue(AGENT);
    const readAgentOutput = vi.fn(() => "l1\nl2\nl3");
    const r = await run("read_agent_output", makeContext({ readAgentOutput }), {
      lines: 2,
    });
    expect(r.active).toBe(true);
    expect(r.phase).toBe("working");
    expect(r.rounds).toBe(1);
    expect(r.output).toBe("l2\nl3");
    expect(readAgentOutput).toHaveBeenCalledWith(3);
  });
});
