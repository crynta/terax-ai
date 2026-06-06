import { describe, expect, it } from "vitest";
import {
  executeWorkflowStep,
  startApprovedWorkflowNodeExecution,
  type WorkflowShellCommandInput,
} from "./execution";
import {
  addWorkflowNode,
  createStarterWorkflowDocument,
  updateWorkflowNodeConfig,
} from "./schema";

function waitingShellWorkflow() {
  const document = updateWorkflowNodeConfig(
    addWorkflowNode(
      createStarterWorkflowDocument({ id: "wf_shell", title: "Shell" }),
      {
        id: "node_shell_1",
        type: "shellCommand",
        position: { x: 360, y: 0 },
      },
    ),
    "node_shell_1",
    { command: "printf 'hello\\n'", cwd: "/repo", timeoutSecs: 5 },
  );
  return executeWorkflowStep(document);
}

describe("approved shell workflow execution", () => {
  it("runs a waiting shell node only after explicit approval", async () => {
    const progress: string[] = [];
    const calls: WorkflowShellCommandInput[] = [];
    const execution = startApprovedWorkflowNodeExecution(
      waitingShellWorkflow(),
      "node_shell_1",
      {
        decision: {
          approvedAt: "2026-06-05T00:00:00.000Z",
          approver: "user",
        },
        executeShellCommand: async (input) => {
          calls.push(input);
          input.reportOutput("hello\n");
          return {
            stdout: "hello\n",
            stderr: "",
            exitCode: 0,
            timedOut: false,
            truncated: false,
          };
        },
        now: () => "2026-06-05T00:00:00.000Z",
        onProgress: (document) => {
          const shell = document.nodes.find(
            (node) => node.id === "node_shell_1",
          );
          if (shell?.runtimeState.message) {
            progress.push(shell.runtimeState.message);
          }
        },
      },
    );

    expect(
      execution.document.nodes.find((node) => node.id === "node_shell_1")
        ?.runtimeState,
    ).toMatchObject({
      status: "running",
      message: "Running approved shell command",
      logs: [
        {
          event: "running",
          message: "Running approved shell command",
          at: "2026-06-05T00:00:00.000Z",
        },
      ],
    });

    const finished = await execution.finished;

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: "printf 'hello\\n'",
      cwd: "/repo",
      timeoutSecs: 5,
    });
    expect(progress).toContain("hello");
    expect(
      finished.nodes.find((node) => node.id === "node_shell_1")?.runtimeState,
    ).toMatchObject({
      status: "completed",
      message: "Shell command completed",
      artifactIds: ["wf_shell:node_shell_1:text"],
      logs: expect.arrayContaining([
        {
          event: "completed",
          message: "Shell command completed",
          at: "2026-06-05T00:00:00.000Z",
        },
      ]),
    });
    expect(
      finished.artifacts.find(
        (artifact) => artifact.id === "wf_shell:node_shell_1:text",
      ),
    ).toMatchObject({
      nodeId: "node_shell_1",
      type: "text",
      preview: "hello",
      value: {
        approval: {
          workflowId: "wf_shell",
          nodeId: "node_shell_1",
          action: { kind: "shell", command: "printf 'hello\\n'" },
          approvedAt: "2026-06-05T00:00:00.000Z",
          approver: "user",
        },
        shell: {
          command: "printf 'hello\\n'",
          cwd: "/repo",
          timeoutSecs: 5,
          stdout: "hello\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          truncated: false,
        },
      },
    });
  });

  it("fails non-zero shell exits while preserving output for audit", async () => {
    const execution = startApprovedWorkflowNodeExecution(
      waitingShellWorkflow(),
      "node_shell_1",
      {
        executeShellCommand: async () => ({
          stdout: "partial\n",
          stderr: "boom\n",
          exitCode: 2,
          timedOut: false,
          truncated: false,
        }),
        now: () => "2026-06-05T00:00:00.000Z",
      },
    );

    const finished = await execution.finished;

    expect(
      finished.nodes.find((node) => node.id === "node_shell_1")?.runtimeState,
    ).toMatchObject({
      status: "failed",
      message: "Shell command exited with code 2",
      errorCode: "unknown",
      artifactIds: ["wf_shell:node_shell_1:text"],
    });
    expect(
      finished.artifacts.find(
        (artifact) => artifact.id === "wf_shell:node_shell_1:text",
      ),
    ).toMatchObject({
      preview: "stdout:\npartial\nstderr:\nboom",
      value: {
        shell: {
          stdout: "partial\n",
          stderr: "boom\n",
          exitCode: 2,
        },
      },
    });
  });

  it("cancels approved shell execution without calling the executor when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;

    const execution = startApprovedWorkflowNodeExecution(
      waitingShellWorkflow(),
      "node_shell_1",
      {
        executeShellCommand: async () => {
          called = true;
          return { stdout: "", exitCode: 0 };
        },
        signal: controller.signal,
        now: () => "2026-06-05T00:00:00.000Z",
      },
    );

    const finished = await execution.finished;

    expect(called).toBe(false);
    expect(
      finished.nodes.find((node) => node.id === "node_shell_1")?.runtimeState,
    ).toMatchObject({
      status: "cancelled",
      message: "Execution cancelled",
    });
    expect(
      finished.artifacts.some(
        (artifact) => artifact.id === "wf_shell:node_shell_1:text",
      ),
    ).toBe(false);
  });
});
