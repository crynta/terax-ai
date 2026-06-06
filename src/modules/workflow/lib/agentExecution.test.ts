import { describe, expect, it } from "vitest";
import {
  executeWorkflowStep,
  startApprovedWorkflowNodeExecution,
} from "./execution";
import {
  addWorkflowNode,
  createStarterWorkflowDocument,
  updateWorkflowNodeConfig,
} from "./schema";

function waitingAgentWorkflow() {
  const document = updateWorkflowNodeConfig(
    addWorkflowNode(
      createStarterWorkflowDocument({ id: "wf_agent", title: "Agent" }),
      {
        id: "node_agent_1",
        type: "agent",
        position: { x: 360, y: 0 },
      },
    ),
    "node_agent_1",
    { prompt: "Review this workflow", cwd: "/repo" },
  );
  return executeWorkflowStep(document);
}

describe("approved agent workflow execution", () => {
  it("runs a waiting agent node only after explicit approval", async () => {
    const progress: string[] = [];
    const calls: Array<{ prompt: string; cwd?: string }> = [];
    const execution = startApprovedWorkflowNodeExecution(
      waitingAgentWorkflow(),
      "node_agent_1",
      {
        decision: {
          approvedAt: "2026-06-05T00:00:00.000Z",
          approver: "user",
        },
        executeAgent: async (input) => {
          calls.push({ prompt: input.prompt, cwd: input.cwd });
          input.reportOutput("Looks ");
          input.reportOutput("good");
          return {
            text: "Looks good",
            sessionId: "pi-session-1",
            eventIds: ["evt-1", "evt-2"],
          };
        },
        now: () => "2026-06-05T00:00:00.000Z",
        onProgress: (document) => {
          const agent = document.nodes.find(
            (node) => node.id === "node_agent_1",
          );
          if (agent?.runtimeState.message) {
            progress.push(agent.runtimeState.message);
          }
        },
      },
    );

    expect(
      execution.document.nodes.find((node) => node.id === "node_agent_1")
        ?.runtimeState,
    ).toMatchObject({
      status: "running",
      message: "Running approved agent prompt",
      logs: [
        {
          event: "running",
          message: "Running approved agent prompt",
          at: "2026-06-05T00:00:00.000Z",
        },
      ],
    });

    const finished = await execution.finished;

    expect(calls).toEqual([{ prompt: "Review this workflow", cwd: "/repo" }]);
    expect(progress).toEqual(["Looks", "good"]);
    expect(
      finished.nodes.find((node) => node.id === "node_agent_1")?.runtimeState,
    ).toMatchObject({
      status: "completed",
      message: "Agent result ready",
      artifactIds: ["wf_agent:node_agent_1:agent"],
      logs: expect.arrayContaining([
        {
          event: "completed",
          message: "Agent result ready",
          at: "2026-06-05T00:00:00.000Z",
        },
      ]),
    });
    expect(
      finished.artifacts.find(
        (artifact) => artifact.id === "wf_agent:node_agent_1:agent",
      ),
    ).toMatchObject({
      nodeId: "node_agent_1",
      type: "agent",
      preview: "Looks good",
      value: {
        approval: {
          workflowId: "wf_agent",
          nodeId: "node_agent_1",
          action: { kind: "agent", prompt: "Review this workflow" },
          approvedAt: "2026-06-05T00:00:00.000Z",
          approver: "user",
        },
        agent: {
          prompt: "Review this workflow",
          cwd: "/repo",
          response: "Looks good",
          sessionId: "pi-session-1",
          eventIds: ["evt-1", "evt-2"],
        },
      },
    });
  });

  it("cancels approved agent execution before calling the executor when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;

    const execution = startApprovedWorkflowNodeExecution(
      waitingAgentWorkflow(),
      "node_agent_1",
      {
        executeAgent: async () => {
          called = true;
          return { text: "done" };
        },
        signal: controller.signal,
        now: () => "2026-06-05T00:00:00.000Z",
      },
    );

    const finished = await execution.finished;

    expect(called).toBe(false);
    expect(
      finished.nodes.find((node) => node.id === "node_agent_1")?.runtimeState,
    ).toMatchObject({
      status: "cancelled",
      message: "Execution cancelled",
    });
    expect(
      finished.artifacts.some(
        (artifact) => artifact.id === "wf_agent:node_agent_1:agent",
      ),
    ).toBe(false);
  });
});
