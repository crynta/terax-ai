import { describe, expect, it } from "vitest";
import { createStarterWorkflowDocument } from "./schema";
import {
  shouldMountTerminalSurface,
  workflowTerminalLeafId,
  workflowTerminalLeafIds,
} from "./terminalNode";

describe("workflow terminal nodes", () => {
  const terminalNode = createStarterWorkflowDocument({
    id: "wf_1",
    title: "Workflow",
  }).nodes.find((node) => node.type === "terminal")!;

  it("uses a stable leaf id outside normal tab allocation", () => {
    expect(workflowTerminalLeafId("wf_1", "node_terminal")).toBe(
      workflowTerminalLeafId("wf_1", "node_terminal"),
    );
    expect(workflowTerminalLeafId("wf_1", "node_terminal")).toBeGreaterThan(
      1_000_000,
    );
  });

  it("separates terminal sessions across workflow documents", () => {
    expect(workflowTerminalLeafId("wf_1", "node_terminal")).not.toBe(
      workflowTerminalLeafId("wf_2", "node_terminal"),
    );
  });

  it("lists terminal leaf ids that need disposal", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Workflow",
    });

    expect(workflowTerminalLeafIds(document)).toEqual([
      workflowTerminalLeafId("wf_1", "node_terminal"),
    ]);
  });

  it("mounts xterm only for visible expanded terminal nodes", () => {
    expect(shouldMountTerminalSurface(terminalNode, true)).toBe(false);
    expect(
      shouldMountTerminalSurface(
        { ...terminalNode, uiState: { expanded: true } },
        true,
      ),
    ).toBe(true);
    expect(
      shouldMountTerminalSurface(
        { ...terminalNode, uiState: { expanded: true } },
        false,
      ),
    ).toBe(false);
  });
});
