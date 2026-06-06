import { describe, expect, it, vi } from "vitest";
import {
  agentComparePathWithinRoot,
  buildReadOnlyAgentTools,
  probeModelCompareModel,
  runModelComparePane,
} from "./runModelCompare";

vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    canonicalize: vi.fn(async (path: string) => path),
  },
}));

describe("runModelComparePane", () => {
  it("streams text deltas and returns latency/usage metrics", async () => {
    const deltas: string[] = [];
    const result = await runModelComparePane({
      prompt: "Say hi",
      modelId: "fake-model",
      keys: {},
      local: {},
      now: (() => {
        const times = [100, 250];
        return () => times.shift() ?? 250;
      })(),
      buildModel: async () => ({ id: "fake-language-model" }),
      streamText: () => ({
        textStream: (async function* () {
          yield "Hel";
          yield "lo";
        })(),
        usage: Promise.resolve({
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
          inputTokenDetails: { cacheReadTokens: 1 },
        }),
      }),
      onDelta: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(["Hel", "lo"]);
    expect(result.response).toBe("Hello");
    expect(result.metrics).toMatchObject({
      startedAt: 100,
      completedAt: 250,
      latencyMs: 150,
      inputTokens: 3,
      outputTokens: 2,
      cachedInputTokens: 1,
    });
  });

  it("probes a model with a tiny tool-free OK prompt", async () => {
    const result = await probeModelCompareModel({
      modelId: "fake-model",
      keys: {},
      local: {},
      now: (() => {
        const times = [10, 42];
        return () => times.shift() ?? 42;
      })(),
      buildModel: async () => ({ id: "fake-language-model" }),
      streamText: ({ prompt }) => {
        expect(prompt).toContain("OK");
        return {
          textStream: (async function* () {
            yield "OK";
          })(),
          usage: { inputTokens: 4, outputTokens: 1 },
        };
      },
    });

    expect(result).toMatchObject({
      modelId: "fake-model",
      status: "ok",
      latencyMs: 32,
      response: "OK",
      error: null,
    });
  });

  it("runs explicit agent compare with read-only workspace tools", async () => {
    const streamCalls: Array<{
      system: string;
      tools?: Record<string, unknown>;
      stopWhen?: unknown;
    }> = [];

    const result = await runModelComparePane({
      prompt: "Inspect the project and propose a fix.",
      mode: "agent",
      modelId: "fake-model",
      keys: {},
      local: {},
      now: (() => {
        const times = [10, 110];
        return () => times.shift() ?? 110;
      })(),
      agentContext: {
        activeCwd: "/repo",
        workspaceRoot: "/repo",
      },
      buildModel: async () => ({ id: "fake-language-model" }),
      streamText: (args) => {
        streamCalls.push(args);
        return {
          textStream: (async function* () {
            yield "Read-only plan";
          })(),
          usage: { inputTokens: 10, outputTokens: 4 },
        };
      },
    });

    const streamArgs = streamCalls[0]!;
    expect(result.response).toBe("Read-only plan");
    expect(streamArgs.system).toContain("read-only agent comparison");
    expect(Object.keys(streamArgs.tools ?? {}).sort()).toEqual([
      "glob",
      "grep",
      "list_directory",
      "read_file",
    ]);
    expect(streamArgs.stopWhen).toBeDefined();
  });

  it("scopes agent compare read-only tools to the workspace", async () => {
    expect(agentComparePathWithinRoot("/repo/src/index.ts", "/repo")).toBe(
      true,
    );
    expect(agentComparePathWithinRoot("/repo-other/index.ts", "/repo")).toBe(
      false,
    );

    const tools = buildReadOnlyAgentTools({
      activeCwd: "/repo/src",
      workspaceRoot: "/repo",
    }) as Record<string, { execute: (input: Record<string, unknown>) => Promise<unknown> }>;

    await expect(tools.read_file.execute({ path: "/tmp/outside.txt" })).resolves
      .toMatchObject({
        error: expect.stringContaining("scoped to the current workspace"),
        workspaceRoot: "/repo",
      });
  });

  it("reports probe failures without throwing", async () => {
    const result = await probeModelCompareModel({
      modelId: "bad-model",
      keys: {},
      local: {},
      now: () => 5,
      buildModel: async () => {
        throw new Error("missing key");
      },
      streamText: () => {
        throw new Error("should not stream");
      },
    });

    expect(result).toEqual({
      modelId: "bad-model",
      status: "failed",
      latencyMs: null,
      response: "",
      error: "missing key",
    });
  });
});
