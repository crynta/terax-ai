import { describe, expect, it, vi } from "vitest";
import type { WorkflowAgentExecutor } from "./execution";
import { createWorkflowBrowserAutomationExecutor } from "./nativeBrowserAutomation";
import { createStarterWorkflowDocument, createWorkflowNode } from "./schema";

describe("native browser automation workflow executor", () => {
  it("routes browser automation through the Pi agent executor with a focused prompt", async () => {
    const agentExecutor: WorkflowAgentExecutor = vi.fn(async (input) => {
      input.reportOutput("navigating");
      return {
        text: `done: ${input.prompt}`,
        sessionId: "session_1",
        eventIds: ["event_1"],
      };
    });
    const reportOutput = vi.fn();
    const executor = createWorkflowBrowserAutomationExecutor(agentExecutor);

    const result = await executor({
      document: createStarterWorkflowDocument({ id: "wf", title: "Workflow" }),
      node: createWorkflowNode({
        id: "node_browser",
        type: "browserAutomation",
        position: { x: 0, y: 0 },
      }),
      url: "https://example.com",
      instructions: "Capture the title",
      reportOutput,
    });

    expect(agentExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("https://example.com"),
      }),
    );
    expect(agentExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Capture the title"),
      }),
    );
    expect(reportOutput).toHaveBeenCalledWith("navigating");
    expect(result).toMatchObject({
      sessionId: "session_1",
      eventIds: ["event_1"],
    });
    expect(result.text).toContain("Browser automation workflow node");
  });
});
