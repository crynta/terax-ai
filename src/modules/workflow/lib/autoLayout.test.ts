import { describe, expect, it } from "vitest";
import { autoLayoutWorkflow } from "./autoLayout";
import {
  createStarterWorkflowDocument,
  addWorkflowNode,
  type WorkflowDocument,
} from "./schema";

describe("workflow auto-layout", () => {
  it("repositions nodes into a clean left-to-right layout", () => {
    const base = createStarterWorkflowDocument({
      id: "wf_layout",
      title: "Layout",
    });
    const withOutput = addWorkflowNode(base, {
      id: "node_output",
      type: "output",
      position: { x: 0, y: 0 },
    });
    const connected: WorkflowDocument = {
      ...withOutput,
      edges: [
        {
          id: "edge_prompt_output",
          sourceNodeId: "node_prompt",
          sourcePortId: "text",
          targetNodeId: "node_output",
          targetPortId: "text",
        },
      ],
    };
    const laid = autoLayoutWorkflow(connected);
    expect(laid.nodes.length).toBe(connected.nodes.length);
    expect(laid.edges.length).toBe(connected.edges.length);
    // The prompt node should be to the left of the output node
    const prompt = laid.nodes.find((n) => n.id === "node_prompt");
    const output = laid.nodes.find((n) => n.id === "node_output");
    expect(prompt).toBeDefined();
    expect(output).toBeDefined();
    expect(prompt!.position.x).toBeLessThan(output!.position.x);
  });

  it("preserves document identity and all fields", () => {
    const doc = createStarterWorkflowDocument({
      id: "wf_preserve",
      title: "Preserve",
    });
    const laid = autoLayoutWorkflow(doc);
    expect(laid.id).toBe(doc.id);
    expect(laid.title).toBe(doc.title);
    expect(laid.version).toBe(doc.version);
    expect(laid.artifacts).toEqual(doc.artifacts);
    expect(laid.variables).toEqual(doc.variables);
  });

  it("supports top-to-bottom direction", () => {
    const base = createStarterWorkflowDocument({
      id: "wf_tb",
      title: "Top-Bottom",
    });
    const laid = autoLayoutWorkflow(base, { direction: "TB" });
    expect(laid.nodes.length).toBe(base.nodes.length);
  });
});
