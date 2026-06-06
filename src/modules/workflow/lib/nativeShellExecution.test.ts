import { describe, expect, it } from "vitest";
import { createWorkflowNativeShellExecutor } from "./nativeShellExecution";
import { createWorkflowNode, type WorkflowDocument } from "./schema";

const document: WorkflowDocument = {
  id: "wf_native_shell",
  title: "Native shell",
  version: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  variables: [],
  artifacts: [],
  nodes: [],
  edges: [],
};
const node = createWorkflowNode({
  id: "node_shell",
  type: "shellCommand",
  position: { x: 0, y: 0 },
});

describe("native workflow shell executor", () => {
  it("streams background shell logs until the command exits", async () => {
    const chunks: string[] = [];
    const executor = createWorkflowNativeShellExecutor(
      {
        shellBgSpawn: async (command, cwd, policy) => {
          expect(command).toBe("printf hi");
          expect(cwd).toBe("/repo");
          expect(policy).toEqual({
            approved: true,
            documentId: "wf_native_shell",
            nodeId: "node_shell",
          });
          return 42;
        },
        shellBgLogs: async (_handle, sinceOffset) => {
          if (sinceOffset === 0) {
            return {
              bytes: "he",
              dropped: 0,
              exited: false,
              exit_code: null,
              next_offset: 2,
            };
          }
          return {
            bytes: "llo\n",
            dropped: 0,
            exited: true,
            exit_code: 0,
            next_offset: 6,
          };
        },
        shellBgKill: async () => {
          throw new Error("should not kill");
        },
      },
      { pollIntervalMs: 0, sleep: async () => {} },
    );

    const output = await executor({
      command: "printf hi",
      cwd: "/repo",
      document,
      node,
      reportOutput: (chunk) => chunks.push(chunk),
    });

    expect(chunks).toEqual(["he", "llo\n"]);
    expect(output).toEqual({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      truncated: false,
    });
  });

  it("kills the background process when the workflow signal aborts", async () => {
    const controller = new AbortController();
    const killed: number[] = [];
    const executor = createWorkflowNativeShellExecutor(
      {
        shellBgSpawn: async () => 7,
        shellBgLogs: async () => ({
          bytes: "working\n",
          dropped: 0,
          exited: false,
          exit_code: null,
          next_offset: 8,
        }),
        shellBgKill: async (handle) => {
          killed.push(handle);
        },
      },
      { pollIntervalMs: 0, sleep: async () => {} },
    );

    await expect(
      executor({
        command: "sleep 60",
        document,
        node,
        reportOutput: () => controller.abort(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(killed).toEqual([7]);
  });
});
