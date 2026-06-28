import { beforeEach, describe, expect, it, vi } from "vitest";

// Spy on the two model builders so we can assert which path a model id takes.
const { buildConfigured, buildPlain } = vi.hoisted(() => ({
  buildConfigured: vi.fn(async () => ({}) as never),
  buildPlain: vi.fn(async () => ({}) as never),
}));

vi.mock("../lib/agent", () => ({
  buildConfiguredLanguageModel: buildConfigured,
  buildLanguageModel: buildPlain,
}));

// Stub the AI SDK: tool() is used when building the subagent's read-only tools;
// generateText must not actually call a model.
vi.mock("ai", () => ({
  tool: (def: unknown) => def,
  stepCountIs: () => ({}),
  generateText: vi.fn(async () => ({ text: "ok", steps: [] })),
}));

import { DEFAULT_MODEL_ID } from "../config";
import type { ToolContext } from "../tools/context";
import { runSubagent } from "./runSubagent";

const ctx = {
  getCwd: () => null,
  getWorkspaceRoot: () => null,
  getTerminalContext: () => null,
  isActiveTerminalPrivate: () => false,
  injectIntoActivePty: () => false,
  openPreview: () => false,
  spawnAgent: () => null,
  readAgentOutput: () => null,
  readCache: new Map(),
  getSessionId: () => "session-1",
} as ToolContext;

beforeEach(() => {
  buildConfigured.mockClear();
  buildPlain.mockClear();
});

// Regression lock: a compat-* model selected as the chat default persists into
// selectedModelId and flows here. getModel() throws on compat ids, so the
// compat case must go through the endpoint-aware builder instead.
describe("runSubagent model routing", () => {
  it("routes a compat-* model through the compat-aware builder, never getModel", async () => {
    await runSubagent({
      type: "explore",
      prompt: "x",
      keys: {} as never,
      modelId: "compat-abc12345",
      toolContext: ctx,
      customEndpoints: [
        {
          id: "abc12345",
          name: "EP",
          baseURL: "http://x/v1",
          modelId: "m",
          contextLimit: 1,
        },
      ],
      customEndpointKeys: { abc12345: "k" },
    });
    expect(buildConfigured).toHaveBeenCalledTimes(1);
    expect(buildConfigured).toHaveBeenCalledWith(
      "compat-abc12345",
      expect.anything(),
      expect.objectContaining({ customEndpoints: expect.any(Array) }),
    );
    expect(buildPlain).not.toHaveBeenCalled();
  });

  it("routes a built-in model through buildLanguageModel", async () => {
    await runSubagent({
      type: "explore",
      prompt: "x",
      keys: {} as never,
      modelId: DEFAULT_MODEL_ID,
      toolContext: ctx,
    });
    expect(buildPlain).toHaveBeenCalledTimes(1);
    expect(buildConfigured).not.toHaveBeenCalled();
  });
});
