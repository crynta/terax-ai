/**
 * Behavioral test for the agent tool approval boundary wiring.
 *
 * Asserts that the tools handed to the Pi Agent enforce the approval contract:
 * a denied gate never reaches the Rust verified executor, and an approved gate
 * records a single-use grant (keyed by the native tool name) before executing.
 * Rust independently enforces policy and the grant (see agent_tools.rs); this
 * test locks the frontend half of the boundary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const agentCtorArg = vi.fn();
vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    state: Record<string, unknown> = {};
    constructor(cfg: unknown) {
      agentCtorArg(cfg);
    }
  },
  DEFAULT_COMPACTION_SETTINGS: { reserveTokens: 1000 },
  estimateContextTokens: () => ({ tokens: 0 }),
  estimateTokens: () => 0,
  generateSummary: async () => ({ ok: true, value: "" }),
  shouldCompact: () => false,
}));
vi.mock("@earendil-works/pi-ai", () => ({
  getModel: () => ({ provider: "anthropic", contextWindow: 200000 }),
  streamSimple: () => ({ result: () => Promise.resolve() }),
  Type: {
    Object: (shape: unknown) => ({ kind: "object", shape }),
    String: (opts?: unknown) => ({ kind: "string", opts }),
    Array: (item: unknown) => ({ kind: "array", item }),
    Optional: (inner: unknown) => inner,
    Boolean: () => ({ kind: "boolean" }),
  },
}));
vi.mock("@/modules/pi/lib/native", () => ({
  piNative: { mcpTools: async () => [] },
}));
vi.mock("./pi-env", () => ({
  piEnv: { getApiKeyForProvider: async () => "key" },
}));
vi.mock("./pi-http", () => ({
  installProxiedFetch: () => {},
  uninstallProxiedFetch: () => {},
}));
vi.mock("@/modules/pi/lib/question-registry", () => ({
  formatQuestionAnswers: () => "",
}));

const mockExecute = vi.fn();
const mockGrant = vi.fn();
vi.mock("./pi-tools", () => ({
  executeAgentTool: (...args: unknown[]) => mockExecute(...args),
  grantAgentTool: (...args: unknown[]) => mockGrant(...args),
}));

import { createTauriAgent } from "./pi-session";

type WrappedTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
  ) => Promise<{ details?: { denied?: boolean } }>;
};

async function buildTools(
  approvalGate: (
    toolName: string,
    toolCallId: string,
    input: unknown,
  ) => Promise<boolean>,
): Promise<WrappedTool[]> {
  agentCtorArg.mockClear();
  await createTauriAgent({
    cwd: "/work",
    sessionId: "s1",
    provider: "anthropic",
    modelId: "claude",
    approvalGate,
  });
  return agentCtorArg.mock.calls[0][0].initialState.tools as WrappedTool[];
}

describe("agent tool approval boundary", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    mockGrant.mockReset();
    mockGrant.mockResolvedValue(undefined);
  });

  it("a denied gate never reaches the executor and records no grant", async () => {
    const tools = await buildTools(async () => false);
    const write = tools.find((t) => t.name === "write_file")!;

    const result = await write.execute("c1", { path: "a.txt", content: "x" });

    expect(result.details?.denied).toBe(true);
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("an approved gate records a grant for the native tool name, then executes", async () => {
    const tools = await buildTools(async () => true);
    const write = tools.find((t) => t.name === "write_file")!;

    await write.execute("c1", { path: "a.txt", content: "x" });

    // write_file maps to the native dispatcher tool name "write".
    expect(mockGrant).toHaveBeenCalledWith("s1", "c1", "write");
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const order =
      mockGrant.mock.invocationCallOrder[0] <
      mockExecute.mock.invocationCallOrder[0];
    expect(order).toBe(true);
    const [req] = mockExecute.mock.calls[0];
    expect(req).toMatchObject({
      sessionId: "s1",
      toolCallId: "c1",
      toolName: "write",
      cwd: "/work",
    });
  });

  it("read-only tools route through the executor with their native name", async () => {
    const tools = await buildTools(async () => true);
    const read = tools.find((t) => t.name === "read_file")!;

    await read.execute("c2", { path: "a.txt" });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [req] = mockExecute.mock.calls[0];
    expect(req).toMatchObject({ toolName: "read", toolCallId: "c2" });
  });
});
