import { describe, expect, it } from "vitest";
import {
  createWorkflowApprovalRequest,
  workflowNodeExecutionIntent,
} from "./approval";
import { approveWorkflowNode, executeWorkflowStep } from "./execution";
import {
  addWorkflowNode,
  createStarterWorkflowDocument,
  updateWorkflowNodeConfig,
} from "./schema";

describe("workflow approval scaffolding", () => {
  it("extracts shell commands and agent prompts from unsafe nodes", () => {
    const shell = updateWorkflowNodeConfig(
      addWorkflowNode(
        createStarterWorkflowDocument({ id: "wf_1", title: "A" }),
        {
          id: "node_shell_1",
          type: "shellCommand",
          position: { x: 0, y: 0 },
        },
      ),
      "node_shell_1",
      { command: "pnpm test" },
    ).nodes.find((node) => node.id === "node_shell_1");
    const agent = updateWorkflowNodeConfig(
      addWorkflowNode(
        createStarterWorkflowDocument({ id: "wf_2", title: "B" }),
        {
          id: "node_agent_1",
          type: "agent",
          position: { x: 0, y: 0 },
        },
      ),
      "node_agent_1",
      { prompt: "Review this diff" },
    ).nodes.find((node) => node.id === "node_agent_1");

    expect(shell && workflowNodeExecutionIntent(shell)).toEqual({
      kind: "shell",
      command: "pnpm test",
    });
    expect(agent && workflowNodeExecutionIntent(agent)).toEqual({
      kind: "agent",
      prompt: "Review this diff",
    });
  });

  it("extracts file and browser automation approval intents", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_auto",
      title: "Auto",
    });
    const file = updateWorkflowNodeConfig(
      addWorkflowNode(document, {
        id: "node_file_1",
        type: "fileOperation",
        position: { x: 0, y: 0 },
      }),
      "node_file_1",
      { operation: "write", path: "notes/out.md" },
    ).nodes.find((node) => node.id === "node_file_1");
    const browser = updateWorkflowNodeConfig(
      addWorkflowNode(document, {
        id: "node_browser_1",
        type: "browserAutomation",
        position: { x: 0, y: 0 },
      }),
      "node_browser_1",
      { url: "https://example.com", instructions: "Capture the title" },
    ).nodes.find((node) => node.id === "node_browser_1");

    expect(file && workflowNodeExecutionIntent(file)).toEqual({
      kind: "file",
      operation: "write",
      path: "notes/out.md",
    });
    expect(browser && workflowNodeExecutionIntent(browser)).toEqual({
      kind: "browser",
      url: "https://example.com",
      instructions: "Capture the title",
    });
  });

  it("creates deterministic approval requests only for waiting unsafe nodes", () => {
    const document = updateWorkflowNodeConfig(
      addWorkflowNode(
        createStarterWorkflowDocument({ id: "wf_1", title: "A" }),
        {
          id: "node_shell_1",
          type: "shellCommand",
          position: { x: 0, y: 0 },
        },
      ),
      "node_shell_1",
      { command: "pnpm build" },
    );
    const waiting = executeWorkflowStep(document);

    expect(
      createWorkflowApprovalRequest(waiting, "node_shell_1", {
        requestedAt: "2026-06-05T00:00:00.000Z",
      }),
    ).toEqual({
      id: "wf_1:node_shell_1:approval",
      workflowId: "wf_1",
      nodeId: "node_shell_1",
      nodeType: "shellCommand",
      title: "Shell Command",
      action: { kind: "shell", command: "pnpm build" },
      risk: "Shell commands can read, write, delete, or execute files.",
      audit: {
        workflowId: "wf_1",
        nodeId: "node_shell_1",
        requestedAt: "2026-06-05T00:00:00.000Z",
      },
    });
    expect(createWorkflowApprovalRequest(waiting, "node_prompt")).toBeNull();
  });

  it("records approval audit metadata on placeholder artifacts", () => {
    const document = updateWorkflowNodeConfig(
      addWorkflowNode(
        createStarterWorkflowDocument({ id: "wf_1", title: "A" }),
        {
          id: "node_agent_1",
          type: "agent",
          position: { x: 0, y: 0 },
        },
      ),
      "node_agent_1",
      { prompt: "Summarize the workflow" },
    );
    const waiting = executeWorkflowStep(document);
    const approved = approveWorkflowNode(waiting, "node_agent_1", {
      approvedAt: "2026-06-05T00:01:00.000Z",
      approver: "user",
    });

    expect(
      approved.artifacts.find((artifact) => artifact.nodeId === "node_agent_1"),
    ).toMatchObject({
      value: {
        approval: {
          workflowId: "wf_1",
          nodeId: "node_agent_1",
          action: { kind: "agent", prompt: "Summarize the workflow" },
          approvedAt: "2026-06-05T00:01:00.000Z",
          approver: "user",
        },
      },
    });
  });
});
